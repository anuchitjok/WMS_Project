import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// Phase 6.1: schema drift and migration safety, on throwaway in-process
// Postgres only. Reproduces how an existing database got here (schema from the
// last commit + 18_fulfillment_guard_rails.sql), applies the new additive
// script twice, then asks Prisma for the remaining difference to schema.prisma.
// Before this change that difference contained DROP INDEX for the guard rails.

const BACKEND = join(__dirname, '..', '..');
const REPO = join(BACKEND, '..');
const OFFLINE = {
  ...process.env,
  DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:9/offline',
};

function prisma(args: string, env: NodeJS.ProcessEnv = OFFLINE) {
  return execSync(`npx prisma ${args}`, {
    cwd: BACKEND,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
}

describe('Schema drift and migration script', () => {
  let db: PGlite;
  let server: PGLiteSocketServer;
  let url: string;
  const dir = mkdtempSync(join(tmpdir(), 'wms-drift-'));

  beforeAll(async () => {
    const oldSchema = join(dir, 'old.prisma');
    writeFileSync(
      oldSchema,
      execSync('git show HEAD:backend/prisma/schema.prisma', {
        cwd: REPO,
        encoding: 'utf8',
      }),
    );
    db = await PGlite.create();
    await db.exec(
      prisma(`migrate diff --from-empty --to-schema "${oldSchema}" --script`),
    );
    await db.exec(
      readFileSync(
        join(REPO, 'database', 'schema', '18_fulfillment_guard_rails.sql'),
        'utf8',
      ),
    );
    server = new PGLiteSocketServer({ db, port: 0 });
    await server.start();
    url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;
  });
  afterAll(async () => {
    await server?.stop();
    await db?.close();
  });

  // prisma.config.ts reads DATABASE_URL; it is pinned to the local PGlite socket
  // (dotenv never overrides a variable that is already set).
  // Async on purpose: the PGlite server lives in this process, so a blocking
  // execSync would stop it from answering Prisma.
  const diffToSchema = async () => {
    if (!url.includes('@127.0.0.1:'))
      throw new Error('Refusing to diff against a non-local database');
    const { stdout } = await promisify(exec)(
      'npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script',
      {
        cwd: BACKEND,
        env: { ...process.env, DATABASE_URL: url },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return stdout;
  };

  it('before the script, Prisma would only ADD (never drop the guard-rail indexes)', async () => {
    const sql = await diffToSchema();
    expect(sql).not.toMatch(
      /DROP INDEX[^;]*(ux_fulfillment_task_request_active|idx_ft_request_id|idx_ft_warehouse_status)/,
    );
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN)/);
  });

  it('21_system_control.sql applies cleanly to an existing database, twice', async () => {
    const script = readFileSync(
      join(REPO, 'database', 'schema', '21_system_control.sql'),
      'utf8',
    );
    await db.exec(script);
    await db.exec(script); // idempotent
    const idx = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'FulfillmentTask'`,
    );
    expect(idx.rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        'ux_fulfillment_task_request_active',
        'idx_ft_request_id',
        'idx_ft_warehouse_status',
      ]),
    );
    const codes = await db.query<{ code: string }>(
      `SELECT code FROM "ReasonCode" WHERE category = 'ADJUSTMENT' ORDER BY code`,
    );
    expect(codes.rows.map((r) => r.code)).toEqual([
      'CORRECTION',
      'CYCLE_COUNT',
      'DAMAGE',
      'FOUND_STOCK',
      'LOSS',
    ]);
  });

  it('22_project_planning.sql applies cleanly to an existing database, twice', async () => {
    const script = readFileSync(
      join(REPO, 'database', 'schema', '22_project_planning.sql'),
      'utf8',
    );
    await db.exec(script);
    await db.exec(script); // idempotent
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'Planning%' ORDER BY table_name`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'PlanningProject',
      'PlanningRun',
      'PlanningScenario',
    ]);
    const perms = await db.query<{ code: string }>(
      `SELECT code FROM "Permission" WHERE module = 'planning' ORDER BY code`,
    );
    expect(perms.rows.map((r) => r.code)).toEqual([
      'planning.approve',
      'planning.cost',
      'planning.manage',
      'planning.read',
    ]);
    // Grants nothing to any role.
    const grants = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE p.module = 'planning'`,
    );
    expect(grants.rows[0].n).toBe(0);
  });

  it('23_planning_sales.sql applies cleanly to an existing database, twice', async () => {
    await db.exec(
      `INSERT INTO "PlanningProject" ("id","code","name","projectType","warehouseId","plannedStart","targetEnd","updatedAt") VALUES ('pp-old','PRJ-OLD','Old','REPAIR','wh-x',now(),now(),now())`,
    );
    const script = readFileSync(
      join(REPO, 'database', 'schema', '23_planning_sales.sql'),
      'utf8',
    );
    await db.exec(script);
    await db.exec(script); // idempotent
    const old = await db.query<{ purpose: string; warehouseId: string }>(
      `SELECT "purpose", "warehouseId" FROM "PlanningProject" WHERE id = 'pp-old'`,
    );
    expect(old.rows[0]).toEqual({ purpose: 'OPERATIONAL', warehouseId: 'wh-x' });
    await db.exec(`DELETE FROM "PlanningProject" WHERE id = 'pp-old'`);
  });

  it('24_planning_templates.sql applies cleanly after 23, twice, and leaves old projects untouched', async () => {
    await db.exec(
      `INSERT INTO "PlanningProject" ("id","code","name","projectType","warehouseId","plannedStart","targetEnd","updatedAt") VALUES ('pp-old2','PRJ-OLD2','Old','REPAIR','wh-x',now(),now(),now())`,
    );
    const script = readFileSync(
      join(REPO, 'database', 'schema', '24_planning_templates.sql'),
      'utf8',
    );
    await db.exec(script);
    await db.exec(script); // idempotent
    const old = await db.query<{ companyTemplateId: string | null; purpose: string }>(
      `SELECT "companyTemplateId", "purpose" FROM "PlanningProject" WHERE id = 'pp-old2'`,
    );
    expect(old.rows[0]).toEqual({ companyTemplateId: null, purpose: 'OPERATIONAL' });
    const n = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "PlanningTemplate"`);
    expect(n.rows[0].n).toBe(0); // nothing seeded
    await db.exec(`DELETE FROM "PlanningProject" WHERE id = 'pp-old2'`);
  });

  it('after the script, the database matches schema.prisma (no drift left)', async () => {
    const sql = (await diffToSchema()).replace(/^--.*$/gm, '').trim();
    expect(sql).toBe('');
  });

  it('the guard rail still refuses a second active task for one request', async () => {
    await db.exec(
      `INSERT INTO "FulfillmentTask" ("id","refNumber","requestId","requestRef","status","updatedAt") VALUES ('t1','FT-1','r1','WR-1','ALLOCATED',now())`,
    );
    await expect(
      db.exec(
        `INSERT INTO "FulfillmentTask" ("id","refNumber","requestId","requestRef","status","updatedAt") VALUES ('t2','FT-2','r1','WR-1','PICKING',now())`,
      ),
    ).rejects.toThrow(/ux_fulfillment_task_request_active/);
    await db.exec(
      `INSERT INTO "FulfillmentTask" ("id","refNumber","requestId","requestRef","status","updatedAt") VALUES ('t3','FT-3','r1','WR-1','CANCELLED',now())`,
    );
  });

  it('the data migration seeds departments and units from values already in use', async () => {
    const fresh = await PGlite.create();
    try {
      const oldSchema = join(dir, 'old.prisma');
      await fresh.exec(
        prisma(`migrate diff --from-empty --to-schema "${oldSchema}" --script`),
      );
      await fresh.exec(
        `INSERT INTO "User" ("id","username","fullName","passwordHash","role","department","updatedAt") VALUES ('u1','a','A','x','REQUESTER','Service Desk',now())`,
      );
      await fresh.exec(
        `INSERT INTO "Product" ("id","code","name","unit","updatedAt") VALUES ('p1','P1','P','box',now())`,
      );
      await fresh.exec(
        readFileSync(
          join(REPO, 'database', 'schema', '21_system_control.sql'),
          'utf8',
        ),
      );
      expect(
        (
          await fresh.query<{ code: string }>(`SELECT code FROM "Department"`)
        ).rows.map((r) => r.code),
      ).toEqual(['Service Desk']);
      expect(
        (
          await fresh.query<{ code: string }>(
            `SELECT code FROM "UnitOfMeasure"`,
          )
        ).rows.map((r) => r.code),
      ).toEqual(['box']);
    } finally {
      await fresh.close();
    }
  });
});
