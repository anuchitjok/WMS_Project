import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import request from 'supertest';
import { PrismaClient, StockItem, StockStatus, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../../src/prisma/prisma.service';

// Integration harness: a real Postgres engine (PGlite, in-process, throwaway) with
// this branch's schema, the full AppModule, real JWTs, guards and validation.
// It never touches a configured database — DATABASE_URL is always overwritten
// with the local PGlite socket before the app is created.

const BACKEND = join(__dirname, '..', '..');

function schemaSql(): string {
  const schemaPath = join(BACKEND, 'prisma', 'schema.prisma');
  const hash = createHash('sha1').update(readFileSync(schemaPath)).digest('hex').slice(0, 12);
  const cache = join(tmpdir(), `wms-integration-schema-${hash}.sql`);
  if (!existsSync(cache)) {
    const sql = execSync(`npx prisma migrate diff --from-empty --to-schema "${schemaPath}" --script`, {
      cwd: BACKEND,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:9/offline' },
    });
    writeFileSync(cache, sql);
  }
  return readFileSync(cache, 'utf8');
}

// Permission sets from prisma/seed-rbac.ts
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: [],
  WAREHOUSE_MANAGER: ['inventory.read', 'inventory.create', 'inventory.adjust', 'inventory.transfer',
    'request.read', 'request.approve', 'request.cancel', 'receiving.manage', 'putaway.manage',
    'fulfillment.manage', 'rma.manage', 'rtv.manage', 'product.manage', 'warehouse.manage',
    'report.read', 'audit.read', 'dataio.manage'],
  PICKER: ['inventory.read', 'request.read', 'putaway.manage', 'fulfillment.manage', 'receiving.manage'],
  REQUESTER: ['inventory.read', 'request.read', 'request.create', 'request.cancel', 'rma.manage'],
};

export interface TestUser { id: string; username: string; role: UserRole }

export class Fixture {
  readonly http: ReturnType<typeof request>;
  private seq = 0;

  private constructor(
    readonly app: INestApplication,
    readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly stopDb: () => Promise<void>,
  ) {
    this.http = request(app.getHttpServer());
  }

  static async start(): Promise<Fixture> {
    const db = await PGlite.create();
    await db.exec(schemaSql());
    const server = new PGLiteSocketServer({ db, port: 0, maxConnections: 50 });
    await server.start();

    process.env.DATABASE_URL = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;
    process.env.JWT_SECRET = 'integration-test-jwt-secret-0123456789';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-0123456789';
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_UNIFIED_RESERVATION = 'false';
    process.env.ENABLE_APPROVAL_ENGINE = 'false';
    if (!process.env.DATABASE_URL.includes('127.0.0.1')) throw new Error('Refusing to run against a non-local database');

    // Loaded only after the environment points at PGlite.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { AppModule } = require('../../src/app.module');
    const { PrismaService } = require('../../src/prisma/prisma.service');
    const { createValidationPipe } = require('../../src/common/validation');
    /* eslint-enable @typescript-eslint/no-require-imports */

    // One pooled connection: PGlite's socket server serializes individual protocol
    // messages, so two connections would interleave their prepared statements.
    // Concurrent API calls still interleave statement-by-statement on this
    // connection, and any query issued outside an open transaction from inside
    // its callback would deadlock here — both of which the tests want to see.
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }) });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      // Rate limiting is per-IP and every test request comes from 127.0.0.1.
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    const app = moduleRef.createNestApplication({ logger: process.env.INTEGRATION_LOG ? ['error', 'warn'] : false });
    app.useGlobalPipes(createValidationPipe());
    app.setGlobalPrefix('api');
    await app.init();

    const fx = new Fixture(app, prisma as unknown as PrismaService, app.get(JwtService), async () => {
      await prisma.$disconnect();
      await server.stop();
      await db.close();
    });
    await fx.seedRbac();
    return fx;
  }

  async stop() {
    await this.app.close();
    await this.stopDb();
  }

  uid(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  // ── Principals ──────────────────────────────────────────────────────────────
  private async seedRbac() {
    const codes = [...new Set(Object.values(ROLE_PERMISSIONS).flat())];
    for (const code of codes) {
      const [module, action] = code.split('.');
      await this.prisma.permission.create({ data: { code, module, action } });
    }
    const perms = await this.prisma.permission.findMany();
    for (const [key, list] of Object.entries(ROLE_PERMISSIONS)) {
      await this.prisma.role.create({
        data: {
          key, name: key, isSystem: true,
          permissions: { create: perms.filter((p) => list.includes(p.code)).map((p) => ({ permissionId: p.id })) },
        },
      });
    }
  }

  /** A user with a legacy role and, optionally, a DB role (which then decides access). */
  async user(role: UserRole, dbRoleKey?: string, opts: { roleActive?: boolean } = {}): Promise<TestUser> {
    let roleId: string | undefined;
    if (dbRoleKey) {
      const r = await this.prisma.role.findUniqueOrThrow({ where: { key: dbRoleKey } });
      if (opts.roleActive === false) {
        const copy = await this.prisma.role.create({ data: { key: this.uid(`${dbRoleKey}_OFF`), name: 'disabled', isActive: false } });
        roleId = copy.id;
      } else {
        roleId = r.id;
      }
    }
    const username = this.uid(role.toLowerCase());
    return this.prisma.user.create({
      data: { username, fullName: username, passwordHash: 'x', role, roleId },
      select: { id: true, username: true, role: true },
    });
  }

  token(u: TestUser) {
    return this.jwt.sign({ sub: u.id, username: u.username, role: u.role });
  }

  as(u: TestUser) {
    const auth = `Bearer ${this.token(u)}`;
    const server = this.app.getHttpServer();
    return {
      get: (path: string) => request(server).get(`/api${path}`).set('Authorization', auth),
      post: (path: string, body: object = {}) => request(server).post(`/api${path}`).set('Authorization', auth).send(body),
      patch: (path: string, body: object = {}) => request(server).patch(`/api${path}`).set('Authorization', auth).send(body),
    };
  }

  // ── Master data & stock ────────────────────────────────────────────────────
  async location(code = this.uid('WH')) {
    const warehouse = await this.prisma.warehouse.create({ data: { code, name: code } });
    const rack = await this.prisma.rack.create({ data: { warehouseId: warehouse.id, code: 'R1' } });
    const slot = await this.prisma.slot.create({ data: { rackId: rack.id, code: 'S1' } });
    return { warehouse, rack, slot };
  }

  async product(opts: { serialControlled?: boolean } = {}) {
    const code = this.uid('SKU');
    return this.prisma.product.create({ data: { code, name: code, serialControlled: opts.serialControlled ?? false } });
  }

  /** Stock rows, oldest first (receivedDate spaced one minute apart). */
  async stock(
    productId: string,
    count: number,
    opts: { status?: StockStatus; quantity?: number; serial?: boolean; warehouseId?: string; rackId?: string; slotId?: string } = {},
  ) {
    const rows: StockItem[] = [];
    for (let i = 0; i < count; i++) {
      rows.push(await this.prisma.stockItem.create({
        data: {
          productId,
          status: opts.status ?? StockStatus.AVAILABLE,
          quantity: opts.quantity ?? 1,
          serialNumber: opts.serial === false ? null : this.uid('SN'),
          warehouseId: opts.warehouseId,
          rackId: opts.rackId,
          slotId: opts.slotId,
          receivedDate: new Date(Date.UTC(2026, 0, 1, 0, this.seq)),
        },
      }));
    }
    return rows;
  }

  // ── Workflow shortcuts through the real API ─────────────────────────────────
  async approvedRequest(requester: TestUser, approver: TestUser, lines: Array<{ productId: string; quantity: number }>) {
    const created = await this.as(requester).post('/requests', { rmaCaseNumber: this.uid('RMA'), items: lines });
    expectStatus(created, 201);
    expectStatus(await this.as(requester).patch(`/requests/${created.body.id}/submit`), 200);
    expectStatus(await this.as(approver).patch(`/requests/${created.body.id}/approve`, { approved: true }), 200);
    return created.body as { id: string; refNumber: string };
  }

  async allocatedTask(requestId: string, operator: TestUser) {
    const res = await this.as(operator).post(`/fulfillment/allocate/${requestId}`);
    expectStatus(res, 201);
    return this.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: res.body.id }, include: { items: true } });
  }

  /** Board flow up to PACKED: Next ×4 (PICKING, PICKED, PACKING, PACKED). */
  async packedTask(taskId: string, operator: TestUser) {
    for (let i = 0; i < 4; i++) expectStatus(await this.as(operator).patch(`/fulfillment/${taskId}/advance`), 200);
  }

  statuses(ids: string[]) {
    return this.prisma.stockItem
      .findMany({ where: { id: { in: ids } }, select: { id: true, status: true } })
      .then((rows) => ids.map((id) => rows.find((r) => r.id === id)!.status));
  }
}

export function expectStatus(res: { status: number; body: unknown }, status: number) {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
}
