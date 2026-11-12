import { Test } from '@nestjs/testing';
import { INestApplication, ExecutionContext, CanActivate } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { WarehouseMasterController } from './warehouse-master.controller';
import { WarehouseMasterService } from './warehouse-master.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { createValidationPipe } from '../common/validation';

// HTTP-level cover for plan P1 1.7 (role matrix) and the DTO contract.
// Authentication is stubbed; RolesGuard and the global ValidationPipe are real.

let currentRole: UserRole = UserRole.SYSTEM_ADMIN;
const PRINCIPAL = (role: UserRole) => ({ id: 'u1', role, roleKey: null, warehouseIds: ['w1'] });

class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = PRINCIPAL(currentRole);
    return true;
  }
}

const service = new Proxy({} as Record<string, jest.Mock>, {
  get(t, prop: string) {
    if (prop === 'then') return undefined;
    t[prop] ??= jest.fn().mockResolvedValue({ ok: true });
    return t[prop];
  },
});

const ADMIN_ONLY: Array<[string, string, Record<string, unknown>]> = [
  ['post', '/warehouse-master/warehouses', { code: 'W', name: 'W', lengthCm: 1000, widthCm: 800 }],
  ['patch', '/warehouse-master/warehouses/w1', { usableAreaPct: 80 }],
  ['patch', '/warehouse-master/warehouses/w1/activate', {}],
  ['patch', '/warehouse-master/warehouses/w1/deactivate', {}],
  ['post', '/warehouse-master/rack-types', { code: 'T', name: 'T', category: 'STANDARD_RACK', lengthCm: 1, widthCm: 1, heightCm: 1 }],
  ['patch', '/warehouse-master/rack-types/t1', { isActive: false }],
];
const MANAGER_WRITES: Array<[string, string, Record<string, unknown>]> = [
  ['post', '/warehouse-master/racks', { warehouseId: 'w1', code: 'A01', category: 'STANDARD_RACK', rackTypeId: 't1' }],
  ['patch', '/warehouse-master/racks/r1', { lengthCm: 250 }],
  ['delete', '/warehouse-master/racks/r1', {}],
  ['post', '/warehouse-master/racks/r1/generate-slots', { levels: 5, columns: 5, preview: true }],
  ['post', '/warehouse-master/slots', { rackId: 'r1', code: 'A01-01-01' }],
  ['patch', '/warehouse-master/slots/s1', { capacity: 2 }],
  ['patch', '/warehouse-master/slots/bulk', { ids: ['s1', 's2'], changes: { capacity: 2 } }],
  ['delete', '/warehouse-master/slots/s1', {}],
  ['post', '/warehouse-master/slots/bulk-delete', { ids: ['s1', 's2'] }],
  ['post', '/warehouse-master/warehouses/w1/setup-racks', { rackTypeId: 't1', zones: [{ name: 'A', racks: 2 }], preview: true }],
];
const READS = [
  '/warehouse-master', '/warehouse-master/summary', '/warehouse-master/space-summary',
  '/warehouse-master/rack-types', '/warehouse-master/space-planner?warehouseId=w1&rackTypeId=t1',
  '/warehouse-master/space-summary/w1/racks',
];

describe('WarehouseMasterController (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [WarehouseMasterController],
      providers: [{ provide: WarehouseMasterService, useValue: service }],
    }).overrideGuard(JwtAuthGuard).useClass(StubAuthGuard).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { currentRole = UserRole.SYSTEM_ADMIN; jest.clearAllMocks(); });

  const send = (method: string, path: string, body: Record<string, unknown>) =>
    (request(app.getHttpServer()) as any)[method](path).send(body);

  describe('warehouse + rack type writes: SYSTEM_ADMIN only', () => {
    it.each(ADMIN_ONLY)('%s %s', async (method, path, body) => {
      currentRole = UserRole.SYSTEM_ADMIN;
      const ok = await send(method, path, body);
      expect(ok.status).toBeLessThan(300);
      currentRole = UserRole.WAREHOUSE_MANAGER;
      expect((await send(method, path, body)).status).toBe(403);
    });
  });

  describe('rack + slot writes: SYSTEM_ADMIN and WAREHOUSE_MANAGER', () => {
    it.each(MANAGER_WRITES)('%s %s', async (method, path, body) => {
      for (const role of [UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER]) {
        currentRole = role;
        expect((await send(method, path, body)).status).toBeLessThan(300);
      }
      for (const role of [UserRole.WAREHOUSE_SUPERVISOR, UserRole.WAREHOUSE_STAFF, UserRole.REQUESTER]) {
        currentRole = role;
        expect((await send(method, path, body)).status).toBe(403);
      }
    });
  });

  it.each(READS)('read %s is open to any signed-in role', async (path) => {
    currentRole = UserRole.WAREHOUSE_STAFF;
    expect((await request(app.getHttpServer()).get(path)).status).toBe(200);
  });

  it('simulator is read-only and open to any signed-in role', async () => {
    currentRole = UserRole.REQUESTER;
    const res = await request(app.getHttpServer()).post('/warehouse-master/space-simulate').send({ mode: 'AREA', areaM2: 20 });
    expect(res.status).toBe(200);
    expect(service.simulate).toHaveBeenCalledWith(expect.objectContaining({ warehouseIds: ['w1'] }), expect.objectContaining({ mode: 'AREA', areaM2: 20 }));
  });

  it('space summary passes the caller scope and warehouse filter', async () => {
    await request(app.getHttpServer()).get('/warehouse-master/space-summary?warehouseId=w1').expect(200);
    expect(service.getSpaceSummary).toHaveBeenCalledWith(expect.objectContaining({ warehouseIds: ['w1'] }), 'w1');
  });

  it('rack space drill-down passes the caller scope and warehouse id', async () => {
    await request(app.getHttpServer()).get('/warehouse-master/space-summary/w1/racks').expect(200);
    expect(service.getRackSpace).toHaveBeenCalledWith(expect.objectContaining({ warehouseIds: ['w1'] }), 'w1');
  });

  it('PATCH slots/bulk reaches bulkUpdateSlots, not updateSlot', async () => {
    await send('patch', '/warehouse-master/slots/bulk', { ids: ['a'], changes: { slotType: 'PALLET' } }).expect(200);
    expect(service.bulkUpdateSlots).toHaveBeenCalledWith(['a'], expect.objectContaining({ slotType: 'PALLET' }), 'u1');
    expect(service.updateSlot).not.toHaveBeenCalled();
  });

  it('POST slots/bulk-delete passes ids, preview flag and the caller scope', async () => {
    await send('post', '/warehouse-master/slots/bulk-delete', { ids: ['a', 'b'], preview: true }).expect(200);
    expect(service.bulkDeleteSlots).toHaveBeenCalledWith(['a', 'b'], 'u1', true, expect.objectContaining({ warehouseIds: ['w1'] }));
  });

  it('DELETE slots/:id passes the caller scope', async () => {
    await send('delete', '/warehouse-master/slots/s9', {}).expect(200);
    expect(service.deleteSlot).toHaveBeenCalledWith('s9', 'u1', expect.objectContaining({ warehouseIds: ['w1'] }));
  });

  describe('validation', () => {
    it('rejects non-positive warehouse sizes and usable % above 100', async () => {
      await send('post', '/warehouse-master/warehouses', { code: 'W', name: 'W', lengthCm: -1 }).expect(400);
      await send('patch', '/warehouse-master/warehouses/w1', { usableAreaPct: 120 }).expect(400);
      await send('patch', '/warehouse-master/warehouses/w1', { widthCm: 0 }).expect(400);
    });
    it('accepts null to clear a warehouse size', async () => {
      await send('patch', '/warehouse-master/warehouses/w1', { lengthCm: null }).expect(200);
    });
    it('rejects an unknown rack category and grids above 99', async () => {
      await send('post', '/warehouse-master/racks', { warehouseId: 'w1', code: 'A', category: 'DRIVE_IN' }).expect(400);
      await send('post', '/warehouse-master/racks/r1/generate-slots', { levels: 100, columns: 1 }).expect(400);
    });
    it('rejects bulk edit with unknown fields or no ids', async () => {
      await send('patch', '/warehouse-master/slots/bulk', { ids: [], changes: { capacity: 1 } }).expect(400);
      await send('patch', '/warehouse-master/slots/bulk', { ids: ['a'], changes: { status: 'EMPTY' } }).expect(400);
    });
    it('rejects bulk delete with no ids, non-string ids or unknown fields', async () => {
      await send('post', '/warehouse-master/slots/bulk-delete', { ids: [] }).expect(400);
      await send('post', '/warehouse-master/slots/bulk-delete', { ids: [1, 2] }).expect(400);
      await send('post', '/warehouse-master/slots/bulk-delete', { ids: ['a'], force: true }).expect(400);
    });
    it('rejects setup with bad zone names, rack counts or unknown fields', async () => {
      const url = '/warehouse-master/warehouses/w1/setup-racks';
      await send('post', url, { rackTypeId: 't1', zones: [] }).expect(400);
      await send('post', url, { rackTypeId: 't1', zones: [{ name: 'A B', racks: 1 }] }).expect(400);
      await send('post', url, { rackTypeId: 't1', zones: [{ name: 'A', racks: 0 }] }).expect(400);
      await send('post', url, { rackTypeId: 't1', zones: [{ name: 'A', racks: 100 }] }).expect(400);
      await send('post', url, { rackTypeId: 't1', zones: [{ name: 'A', racks: 1 }], levels: 9 }).expect(400);
    });
    it('setup passes the warehouse id, body and caller scope', async () => {
      await send('post', '/warehouse-master/warehouses/w1/setup-racks', { rackTypeId: 't1', zones: [{ name: 'A', racks: 2 }] }).expect(200);
      expect(service.setupRacks).toHaveBeenCalledWith('w1', expect.objectContaining({ rackTypeId: 't1' }), 'u1', expect.objectContaining({ warehouseIds: ['w1'] }));
    });
    it('rejects an unknown simulator mode', async () => {
      await send('post', '/warehouse-master/space-simulate', { mode: 'BOOK' }).expect(400);
    });
  });
});
