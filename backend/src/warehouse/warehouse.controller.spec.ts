import { Test } from '@nestjs/testing';
import { INestApplication, ExecutionContext, CanActivate } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Regression net for a real authorization hole: rack and slot writes on this
// controller carried NO @Roles at all, so any authenticated principal — a
// REQUESTER, an AUDITOR, a read-only viewer — could create or delete warehouse
// structure, while /warehouse-master guarded the very same tables.
//
// Only authentication is stubbed here; RolesGuard is the real one, so these
// tests fail if a guard is ever dropped again.

let currentRole: UserRole = UserRole.SYSTEM_ADMIN;

class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = { id: 'u1', role: currentRole, roleKey: 'ADMIN', warehouseIds: [] };
    return true;
  }
}

// Every role that must NOT be able to touch warehouse structure.
const OUTSIDERS: UserRole[] = [
  UserRole.REQUESTER, UserRole.DEPT_APPROVER, UserRole.RMA_TEAM, UserRole.RTV_OFFICER,
  UserRole.FINANCE_VIEWER, UserRole.BRAND_VIEWER, UserRole.MGMT_VIEWER, UserRole.AUDITOR,
];

describe('WarehouseController — rack/slot write authorization', () => {
  let app: INestApplication;
  const service = {
    findAll: jest.fn().mockResolvedValue([]),
    getStats: jest.fn().mockResolvedValue({}),
    getSlotDetail: jest.fn().mockResolvedValue({}),
    createRack: jest.fn().mockResolvedValue({ id: 'r1' }),
    updateRack: jest.fn().mockResolvedValue({ id: 'r1' }),
    deleteRack: jest.fn().mockResolvedValue({ id: 'r1' }),
    createSlot: jest.fn().mockResolvedValue({ id: 's1' }),
    bulkGenerateSlots: jest.fn().mockResolvedValue({ created: 1, skipped: 0 }),
    updateSlot: jest.fn().mockResolvedValue({ id: 's1' }),
    deleteSlot: jest.fn().mockResolvedValue({ id: 's1' }),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [WarehouseController],
      providers: [{ provide: WarehouseService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubAuthGuard)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { currentRole = UserRole.SYSTEM_ADMIN; jest.clearAllMocks(); });

  const srv = () => app.getHttpServer();
  const rack = { warehouseId: 'wh_1', code: 'R-Z' };

  // Each entry: [label, how to fire it]
  const STRUCTURE_WRITES: [string, () => request.Test][] = [
    ['POST /racks', () => request(srv()).post('/warehouse/racks').send(rack)],
    ['DELETE /racks/:id', () => request(srv()).delete('/warehouse/racks/r1')],
    ['POST /racks/:id/slots', () => request(srv()).post('/warehouse/racks/r1/slots').send({ code: 'S1' })],
    ['POST /racks/:id/slots/bulk', () => request(srv()).post('/warehouse/racks/r1/slots/bulk').send({ levels: 1, columns: 1 })],
    ['DELETE /slots/:id', () => request(srv()).delete('/warehouse/slots/s1')],
  ];
  const OPS_WRITES: [string, () => request.Test][] = [
    ['PATCH /racks/:id', () => request(srv()).patch('/warehouse/racks/r1').send({ name: 'x' })],
    ['PATCH /slots/:id', () => request(srv()).patch('/warehouse/slots/s1').send({ status: 'BLOCKED' })],
  ];

  describe('the hole is closed', () => {
    for (const role of OUTSIDERS) {
      it(`${role} cannot perform ANY rack/slot write`, async () => {
        currentRole = role;
        for (const [, fire] of [...STRUCTURE_WRITES, ...OPS_WRITES]) {
          await fire().expect(403);
        }
        // Not one call reached the service.
        expect(service.createRack).not.toHaveBeenCalled();
        expect(service.deleteRack).not.toHaveBeenCalled();
        expect(service.updateSlot).not.toHaveBeenCalled();
        expect(service.deleteSlot).not.toHaveBeenCalled();
        expect(service.bulkGenerateSlots).not.toHaveBeenCalled();
      });
    }
  });

  describe('structure writes are admin/manager only, matching warehouse-master', () => {
    for (const [label, fire] of STRUCTURE_WRITES) {
      it(`${label} allows SYSTEM_ADMIN`, async () => {
        currentRole = UserRole.SYSTEM_ADMIN;
        const res = await fire();
        expect(res.status).not.toBe(403);
      });
      it(`${label} allows WAREHOUSE_MANAGER`, async () => {
        currentRole = UserRole.WAREHOUSE_MANAGER;
        const res = await fire();
        expect(res.status).not.toBe(403);
      });
      it(`${label} blocks WAREHOUSE_STAFF`, async () => {
        currentRole = UserRole.WAREHOUSE_STAFF;
        await fire().expect(403);
      });
    }
  });

  describe('edits stay open to the floor roles', () => {
    // The Operations Control Center uses PATCH slots/:id for the everyday
    // block / unblock action. Locking it to admins would break that flow.
    for (const [label, fire] of OPS_WRITES) {
      for (const role of [UserRole.WAREHOUSE_SUPERVISOR, UserRole.WAREHOUSE_STAFF]) {
        it(`${label} allows ${role}`, async () => {
          currentRole = role;
          const res = await fire();
          expect(res.status).not.toBe(403);
        });
      }
    }
  });

  describe('reads are unaffected', () => {
    it('a REQUESTER can still read the warehouse tree', async () => {
      currentRole = UserRole.REQUESTER;
      await request(srv()).get('/warehouse').expect(200);
    });
    it('a REQUESTER can still read slot detail', async () => {
      currentRole = UserRole.REQUESTER;
      await request(srv()).get('/warehouse/slots/s1/detail').expect(200);
    });
  });
});
