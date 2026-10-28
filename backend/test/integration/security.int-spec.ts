import { join } from 'node:path';
import * as jsonwebtoken from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';
import { RealtimeGateway } from '../../src/realtime/realtime.gateway';

// Phase 1 security regressions: role escalation through every user-management
// path, token revocation (jti), and the authenticated realtime channel.

// socket.io-client is only a frontend dependency; the test borrows that copy
// (same 4.8.x line as the server) instead of adding a backend dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { io } = require(
  require.resolve('socket.io-client', {
    paths: [join(__dirname, '..', '..', '..', 'frontend')],
  }),
);

describe('Security: role escalation, revocation, realtime auth', () => {
  let fx: Fixture;
  let sysAdmin: TestUser,
    manager: TestUser,
    superAdmin: TestUser,
    admin: TestUser;
  let superRoleId: string, managerRoleId: string;

  async function role(key: string, codes: string[]) {
    for (const code of codes) {
      const [module, action] = code.split('.');
      await fx.prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module, action },
      });
    }
    const perms = await fx.prisma.permission.findMany({
      where: { code: { in: codes } },
    });
    return fx.prisma.role.create({
      data: {
        key,
        name: key,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
  }

  beforeAll(async () => {
    fx = await Fixture.start();
    superRoleId = (
      await fx.prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } })
    ).id;
    managerRoleId = (
      await fx.prisma.role.findUniqueOrThrow({
        where: { key: 'WAREHOUSE_MANAGER' },
      })
    ).id;
    await role('ADMIN', [
      'user.manage',
      'inventory.read',
      'request.read',
      'request.approve',
    ]);
    sysAdmin = await fx.user(UserRole.SYSTEM_ADMIN); // legacy admin, no DB role
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER); // legacy manager, no DB role
    superAdmin = await fx.user(UserRole.SYSTEM_ADMIN, 'SUPER_ADMIN');
    admin = await fx.user(UserRole.WAREHOUSE_MANAGER, 'ADMIN');
  });
  afterAll(async () => {
    await fx.stop();
  });

  const newUser = (role?: string) => ({
    username: fx.uid('new'),
    fullName: 'New User',
    password: 'Passw0rd!',
    ...(role ? { role } : {}),
  });

  // ── 2.1 /auth/register ────────────────────────────────────────────────────
  describe('POST /auth/register', () => {
    it('rejects a Warehouse Manager creating a SYSTEM_ADMIN', async () => {
      const body = newUser('SYSTEM_ADMIN');
      await fx.as(manager).post('/auth/register', body).expect(403);
      expect(
        await fx.prisma.user.count({ where: { username: body.username } }),
      ).toBe(0);
    });

    it('rejects unknown role values', async () => {
      await fx
        .as(sysAdmin)
        .post('/auth/register', newUser('GOD_MODE'))
        .expect(400);
    });

    it('lets a Warehouse Manager create an ordinary user', async () => {
      const res = await fx
        .as(manager)
        .post('/auth/register', newUser('REQUESTER'));
      expectStatus(res, 201);
      expect(res.body.role).toBe('REQUESTER');
      expect(
        await fx.prisma.auditLog.count({
          where: { action: 'USER_CREATED', entityId: res.body.id },
        }),
      ).toBe(1);
    });

    it('lets a system administrator create another SYSTEM_ADMIN (controlled provisioning)', async () => {
      const res = await fx
        .as(sysAdmin)
        .post('/auth/register', newUser('SYSTEM_ADMIN'));
      expectStatus(res, 201);
      expect(res.body.role).toBe('SYSTEM_ADMIN');
    });

    it("still refuses roles outside the endpoint's legacy allow-list", async () => {
      const requester = await fx.user(UserRole.REQUESTER);
      await fx
        .as(requester)
        .post('/auth/register', newUser('REQUESTER'))
        .expect(403);
    });
  });

  // ── 2.1 /users (user.manage) ─────────────────────────────────────────────
  describe('/users escalation paths', () => {
    it('a non-super admin cannot create a SYSTEM_ADMIN or a SUPER_ADMIN-role user', async () => {
      await fx.as(admin).post('/users', newUser('SYSTEM_ADMIN')).expect(403);
      await fx
        .as(admin)
        .post('/users', { ...newUser(), roleId: superRoleId })
        .expect(403);
    });

    it('a non-super admin cannot grant a DB role with permissions they do not hold', async () => {
      // WAREHOUSE_MANAGER role has inventory.adjust etc. which ADMIN (test role) lacks
      await fx
        .as(admin)
        .post('/users', { ...newUser(), roleId: managerRoleId })
        .expect(403);
      const target = await fx.user(UserRole.REQUESTER);
      await fx
        .as(admin)
        .patch(`/users/${target.id}/role`, { roleId: managerRoleId })
        .expect(403);
      await fx
        .as(admin)
        .post(`/users/${target.id}/role-assignments`, { roleId: managerRoleId })
        .expect(403);
    });

    it('a non-super admin cannot promote an existing user to SYSTEM_ADMIN / SUPER_ADMIN', async () => {
      const target = await fx.user(UserRole.REQUESTER);
      await fx
        .as(admin)
        .patch(`/users/${target.id}`, { role: 'SYSTEM_ADMIN' })
        .expect(403);
      await fx
        .as(admin)
        .patch(`/users/${target.id}/role`, { roleId: superRoleId })
        .expect(403);
      await fx
        .as(admin)
        .post(`/users/${target.id}/role-assignments`, { roleId: superRoleId })
        .expect(403);
      const after = await fx.prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(after.role).toBe('REQUESTER');
      expect(after.roleId).toBeNull();
    });

    it('a non-super admin cannot take over an administrator account', async () => {
      await fx
        .as(admin)
        .post(`/users/${superAdmin.id}/reset-password`)
        .expect(403);
      await fx
        .as(admin)
        .patch(`/users/${superAdmin.id}`, { password: 'Takeover1!' })
        .expect(403);
      await fx.as(admin).patch(`/users/${superAdmin.id}/toggle`).expect(403);
      await fx
        .as(admin)
        .patch(`/users/${sysAdmin.id}/warehouses`, { warehouseIds: [] })
        .expect(403);
    });

    it('a non-super admin can still create and edit ordinary users within their permissions', async () => {
      const lowRole = await role(fx.uid('LOW'), ['inventory.read']);
      const created = await fx
        .as(admin)
        .post('/users', { ...newUser('REQUESTER'), roleId: lowRole.id });
      expectStatus(created, 201);
      expectStatus(
        await fx
          .as(admin)
          .patch(`/users/${created.body.id}`, { fullName: 'Renamed' }),
        200,
      );
      expectStatus(
        await fx.as(admin).post(`/users/${created.body.id}/reset-password`),
        201,
      );
    });

    it('SUPER_ADMIN can grant SUPER_ADMIN', async () => {
      const target = await fx.user(UserRole.REQUESTER);
      expectStatus(
        await fx
          .as(superAdmin)
          .patch(`/users/${target.id}/role`, { roleId: superRoleId }),
        200,
      );
    });
  });

  // ── Token revocation ─────────────────────────────────────────────────────
  describe('token revocation', () => {
    it('login tokens carry a jti and logout revokes the bearer token', async () => {
      const bcrypt = await import('bcryptjs');
      const username = fx.uid('login');
      await fx.prisma.user.create({
        data: {
          username,
          fullName: username,
          role: 'REQUESTER',
          passwordHash: await bcrypt.hash('Passw0rd!', 4),
        },
      });
      const login = await fx.http
        .post('/api/auth/login')
        .send({ username, password: 'Passw0rd!' });
      expectStatus(login, 200);
      const token = login.body.accessToken as string;
      expect((jsonwebtoken.decode(token) as { jti?: string }).jti).toBeTruthy();
      await fx.http
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await fx.http
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);
      await fx.http
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('refresh refuses a deactivated account', async () => {
      const u = await fx.user(UserRole.REQUESTER);
      const refreshToken = jsonwebtoken.sign(
        { sub: u.id, username: u.username, role: u.role },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: '1h' },
      );
      await fx.http
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);
      await fx.prisma.user.update({
        where: { id: u.id },
        data: { isActive: false },
      });
      await fx.http
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(400);
    });
  });

  // ── 2.2 WebSocket ────────────────────────────────────────────────────────
  describe('realtime gateway', () => {
    let url: string;
    const sockets: any[] = [];

    beforeAll(async () => {
      await fx.app.listen(0, '127.0.0.1');
      const { port } = fx.app.getHttpServer().address();
      url = `http://127.0.0.1:${port}/ws`;
    });
    afterAll(() => {
      for (const s of sockets) s.close();
    });

    function connect(
      auth?: Record<string, unknown>,
    ): Promise<{ socket: any; error?: Error }> {
      return new Promise((resolve) => {
        const socket = io(url, {
          transports: ['websocket'],
          reconnection: false,
          auth,
          forceNew: true,
        });
        sockets.push(socket);
        socket.on('connect', () => resolve({ socket }));
        socket.on('connect_error', (error: Error) =>
          resolve({ socket, error }),
        );
      });
    }

    function collect(socket: any, event: string) {
      const got: any[] = [];
      socket.on(event, (p: any) => got.push(p));
      return got;
    }
    const settle = () => new Promise((r) => setTimeout(r, 300));

    it('rejects anonymous connections', async () => {
      const { error } = await connect();
      expect(error?.message).toBe('Unauthorized');
    });

    it('rejects tokens with a bad signature or past expiry', async () => {
      const u = await fx.user(UserRole.WAREHOUSE_STAFF);
      const forged = jsonwebtoken.sign(
        { sub: u.id, username: u.username, role: u.role },
        'not-the-secret',
      );
      expect((await connect({ token: forged })).error?.message).toBe(
        'Unauthorized',
      );
      const expired = jsonwebtoken.sign(
        {
          sub: u.id,
          username: u.username,
          role: u.role,
          exp: Math.floor(Date.now() / 1000) - 60,
        },
        process.env.JWT_SECRET!,
      );
      expect((await connect({ token: expired })).error?.message).toBe(
        'Unauthorized',
      );
    });

    it('rejects revoked tokens and inactive users', async () => {
      const u = await fx.user(UserRole.WAREHOUSE_STAFF);
      const jti = fx.uid('jti');
      const token = jsonwebtoken.sign(
        { sub: u.id, username: u.username, role: u.role, jti },
        process.env.JWT_SECRET!,
        { expiresIn: '1h' },
      );
      await fx.prisma.tokenBlocklist.create({
        data: { jti, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) },
      });
      expect((await connect({ token })).error?.message).toBe('Unauthorized');

      const off = await fx.user(UserRole.WAREHOUSE_STAFF);
      await fx.prisma.user.update({
        where: { id: off.id },
        data: { isActive: false },
      });
      expect((await connect({ token: fx.token(off) })).error?.message).toBe(
        'Unauthorized',
      );
    });

    it('delivers events only to permitted, in-scope users with stripped payloads', async () => {
      const whA = await fx.location();
      const whB = await fx.location();
      const unscoped = await fx.user(UserRole.WAREHOUSE_STAFF);
      const scopedA = await fx.user(UserRole.WAREHOUSE_STAFF);
      await fx.prisma.userWarehouse.create({
        data: { userId: scopedA.id, warehouseId: whA.warehouse.id },
      });
      await role('NO_READ', ['user.manage']);
      const noRead = await fx.user(UserRole.WAREHOUSE_STAFF, 'NO_READ');

      const a = await connect({ token: fx.token(unscoped) });
      const b = await connect({ token: fx.token(scopedA) });
      const c = await connect({ token: fx.token(noRead) });
      expect([a.error, b.error, c.error]).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
      const gotA = collect(a.socket, 'inventory:update');
      const gotB = collect(b.socket, 'inventory:update');
      const gotC = collect(c.socket, 'inventory:update');
      const reqC = collect(c.socket, 'request:update');
      await settle();

      const gw = fx.app.get(RealtimeGateway);
      gw.emitInventoryUpdate({
        action: 'created',
        item: {
          id: 'item-b',
          warehouseId: whB.warehouse.id,
          serialNumber: 'SECRET-SN',
          unitCost: 999,
        },
      });
      gw.emitInventoryUpdate({
        action: 'created',
        item: { id: 'item-a', warehouseId: whA.warehouse.id },
      });
      gw.emitRequestUpdate({ action: 'handover', taskId: 't1' });
      await settle();

      expect(gotA.map((p) => p.stockItemId).sort()).toEqual([
        'item-a',
        'item-b',
      ]);
      expect(gotB.map((p) => p.stockItemId)).toEqual(['item-a']);
      expect(gotC).toEqual([]);
      expect(reqC).toEqual([]);
      // Sensitive fields never leave the server
      expect(JSON.stringify(gotA)).not.toContain('SECRET-SN');
      expect(JSON.stringify(gotA)).not.toContain('999');
    });

    it('drops sockets whose token is revoked after connecting', async () => {
      const u = await fx.user(UserRole.WAREHOUSE_STAFF);
      const jti = fx.uid('jti');
      const token = jsonwebtoken.sign(
        { sub: u.id, username: u.username, role: u.role, jti },
        process.env.JWT_SECRET!,
        { expiresIn: '1h' },
      );
      const { socket, error } = await connect({ token });
      expect(error).toBeUndefined();
      const dropped = new Promise((r) => socket.on('disconnect', r));
      await fx.prisma.tokenBlocklist.create({
        data: { jti, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) },
      });
      await fx.app.get(RealtimeGateway).revalidateAll();
      await expect(
        Promise.race([
          dropped.then(() => 'dropped'),
          new Promise((r) => setTimeout(() => r('still-connected'), 2000)),
        ]),
      ).resolves.toBe('dropped');
    });
  });
});
