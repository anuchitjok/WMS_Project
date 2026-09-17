import { Test } from '@nestjs/testing';
import { INestApplication, ExecutionContext, CanActivate, Type } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { createValidationPipe } from '../common/validation';

import { FulfillmentController } from '../fulfillment/fulfillment.controller';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { AllocationService } from '../fulfillment/services/allocation.service';
import { PickingService } from '../fulfillment/services/picking.service';
import { PackingService } from '../fulfillment/services/packing.service';
import { DispatchService } from '../fulfillment/services/dispatch.service';
import { HandoverService } from '../fulfillment/services/handover.service';
import { Fulfillment2Controller } from '../fulfillment2/fulfillment2.controller';
import { Fulfillment2Service } from '../fulfillment2/fulfillment2.service';
import { PutawayController } from '../putaway/putaway.controller';
import { PutawayService } from '../putaway/putaway.service';
import { TransferController } from '../transfer/transfer.controller';
import { TransferService } from '../transfer/transfer.service';
import { InventoryController } from '../inventory/inventory.controller';
import { InventoryService } from '../inventory/inventory.service';
import { ReceivingController } from '../receiving/receiving.controller';
import { ReceivingService } from '../receiving/receiving.service';
import { ReceivingImportService } from '../receiving/receiving-import.service';
import { AdjustmentController } from '../adjustment/adjustment.controller';
import { AdjustmentService } from '../adjustment/adjustment.service';
import { CycleCountController } from '../cycle-count/cycle-count.controller';
import { CycleCountService } from '../cycle-count/cycle-count.service';
import { ScrapController } from '../scrap/scrap.controller';
import { ScrapService } from '../scrap/scrap.service';
import { DoaController } from '../doa/doa.controller';
import { DoaService } from '../doa/doa.service';
import { UnusedController } from '../unused/unused.controller';
import { UnusedService } from '../unused/unused.service';
import { RmaController } from '../rma/rma.controller';
import { RmaService } from '../rma/rma.service';
import { RtvController } from '../rtv/rtv.controller';
import { RtvService } from '../rtv/rtv.service';
import { RequestsController } from '../requests/requests.controller';
import { RequestsService } from '../requests/requests.service';
import { ProductsController } from '../products/products.controller';
import { ProductsService } from '../products/products.service';
import { DataioController } from '../dataio/dataio.controller';
import { DataioService } from '../dataio/dataio.service';
import { ImportService } from '../dataio/import.service';
import { ApprovalController } from '../approval/approval.controller';
import { ApprovalService } from '../approval/approval.service';

// Regression net for the Phase 1 authorization gaps: these warehouse writes were
// reachable by ANY authenticated user (including REQUESTER), or used only the
// legacy role enum. Authentication is stubbed; AccessGuard and the global
// ValidationPipe are the real ones.

type Principal = { id: string; role: UserRole; roleKey: string | null; permissions: string[]; rbacAssigned: boolean };
let principal: Principal;

class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = principal;
    return true;
  }
}

const legacy = (role: UserRole): Principal => ({ id: 'u1', role, roleKey: null, permissions: [], rbacAssigned: false });
const dbRole = (roleKey: string, permissions: string[], role: UserRole = UserRole.REQUESTER): Principal =>
  ({ id: 'u1', role, roleKey, permissions, rbacAssigned: true });

// Permission sets from prisma/seed-rbac.ts
const PICKER = ['inventory.read', 'request.read', 'putaway.manage', 'fulfillment.manage', 'receiving.manage'];
const REQUESTER = ['inventory.read', 'request.read', 'request.create', 'request.cancel', 'rma.manage'];

/** A service double whose every method resolves to {} (lifecycle hooks and thenable checks excluded). */
function serviceDouble() {
  const fns = new Map<string, jest.Mock>();
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string' || prop === 'then' || prop.startsWith('on') || prop === 'beforeApplicationShutdown') return undefined;
      if (!fns.has(prop)) fns.set(prop, jest.fn().mockResolvedValue({}));
      return fns.get(prop);
    },
  });
}

type Rule = 'OPERATOR' | 'SUPERVISOR';
// [method, path, body, who may call it as a legacy role]
const WRITES: Array<[string, string, Record<string, unknown>, Rule]> = [
  ['post', '/fulfillment/allocate/r1', {}, 'OPERATOR'],
  ['patch', '/fulfillment/t1/advance', {}, 'OPERATOR'],
  ['patch', '/fulfillment/t1/exception', { status: 'HOLD' }, 'OPERATOR'],
  ['patch', '/fulfillment/t1/items/i1/pick', { qty: 1 }, 'OPERATOR'],
  ['post', '/fulfillment/t1/packing/start', {}, 'OPERATOR'],
  ['patch', '/fulfillment/t1/packing', { cartonCount: 1 }, 'OPERATOR'],
  ['post', '/fulfillment/t1/packing/complete', {}, 'OPERATOR'],
  ['post', '/fulfillment/t1/shipment', {}, 'OPERATOR'],
  ['post', '/fulfillment/shipments/s1/dispatch', {}, 'OPERATOR'],
  ['post', '/fulfillment/shipments/s1/deliver', {}, 'OPERATOR'],
  ['post', '/fulfillment/t1/handover/rma', { receiver: 'x' }, 'OPERATOR'],
  ['post', '/fulfillment/t1/cancel', {}, 'OPERATOR'],
  ['post', '/fulfillment2/allocate/r1', {}, 'OPERATOR'],
  ['patch', '/fulfillment2/t1/advance', {}, 'OPERATOR'],
  ['patch', '/putaway/s1/confirm', { warehouseId: 'w1' }, 'OPERATOR'],
  ['patch', '/transfer/t1/complete', {}, 'OPERATOR'],
  ['patch', '/inventory/s1/status', { status: 'QUARANTINE' }, 'OPERATOR'],
  ['patch', '/inventory/s1/location', { warehouseId: 'w1' }, 'SUPERVISOR'],
  ['patch', '/receiving/g1/inspect', { items: [{ itemId: 'i', inspectedQty: 1, inspectionOutcome: 'good' }] }, 'OPERATOR'],
  ['patch', '/receiving/g1/verify', {}, 'OPERATOR'],
  ['patch', '/unused/r1/return', {}, 'OPERATOR'],
  ['patch', '/unused/r1/doa', {}, 'OPERATOR'],
  ['post', '/adjustment', { productLabel: 'x', reason: 'y', quantityBefore: 1, quantityAfter: 2 }, 'SUPERVISOR'],
  ['patch', '/adjustment/a1/approve', {}, 'SUPERVISOR'],
  ['post', '/cycle-count/c1/approve', {}, 'SUPERVISOR'],
  ['post', '/cycle-count/c1/cancel', {}, 'SUPERVISOR'],
  ['post', '/scrap', {}, 'SUPERVISOR'],
  ['patch', '/scrap/c1/status', { status: 'APPROVED' }, 'SUPERVISOR'],
];

describe('Warehouse write authorization (Phase 1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const controllers: Type<unknown>[] = [
      FulfillmentController, Fulfillment2Controller, PutawayController, TransferController, InventoryController,
      ReceivingController, AdjustmentController, CycleCountController, ScrapController, DoaController,
      UnusedController, RmaController, RtvController, RequestsController, ProductsController, DataioController,
      ApprovalController,
    ];
    const services: Type<unknown>[] = [
      FulfillmentService, AllocationService, PickingService, PackingService, DispatchService, HandoverService,
      Fulfillment2Service, PutawayService, TransferService, InventoryService, ReceivingService, ReceivingImportService,
      AdjustmentService, CycleCountService, ScrapService, DoaService, UnusedService, RmaService, RtvService,
      RequestsService, ProductsService, DataioService, ImportService, ApprovalService,
    ];
    const mod = await Test.createTestingModule({
      controllers,
      providers: services.map((s) => ({ provide: s, useValue: serviceDouble() })),
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubAuthGuard)
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  const call = (method: string, path: string, body: Record<string, unknown> = {}) =>
    (request(app.getHttpServer()) as any)[method](path).send(body);

  describe.each(WRITES)('%s %s', (method, path, body, rule) => {
    it('rejects a legacy REQUESTER', async () => {
      principal = legacy(UserRole.REQUESTER);
      await call(method, path, body).expect(403);
    });

    it(`${rule === 'OPERATOR' ? 'allows' : 'rejects'} legacy WAREHOUSE_STAFF`, async () => {
      principal = legacy(UserRole.WAREHOUSE_STAFF);
      const res = await call(method, path, body);
      if (rule === 'OPERATOR') expect(res.status).toBeLessThan(300);
      else expect(res.status).toBe(403);
    });

    it('allows a legacy WAREHOUSE_MANAGER', async () => {
      principal = legacy(UserRole.WAREHOUSE_MANAGER);
      const res = await call(method, path, body);
      expect(res.status).toBeLessThan(300);
    });

    it('rejects a DB REQUESTER role even when the legacy role is SYSTEM_ADMIN', async () => {
      principal = dbRole('REQUESTER', REQUESTER, UserRole.SYSTEM_ADMIN);
      await call(method, path, body).expect(403);
    });
  });

  it('a DB PICKER role may execute fulfillment but not approve stock adjustments', async () => {
    principal = dbRole('PICKER', PICKER);
    expect((await call('patch', '/fulfillment/t1/advance')).status).toBeLessThan(300);
    expect((await call('patch', '/putaway/s1/confirm', { warehouseId: 'w1' })).status).toBeLessThan(300);
    await call('patch', '/adjustment/a1/approve').expect(403);
    await call('post', '/scrap').expect(403);
  });

  it('SUPER_ADMIN passes regardless of permissions', async () => {
    principal = dbRole('SUPER_ADMIN', []);
    expect((await call('post', '/cycle-count/c1/approve')).status).toBeLessThan(300);
  });

  it('only approvers may decide a request', async () => {
    principal = legacy(UserRole.WAREHOUSE_STAFF);
    await call('patch', '/requests/r1/approve', { approved: true }).expect(403);
    principal = legacy(UserRole.DEPT_APPROVER);
    expect((await call('patch', '/requests/r1/approve', { approved: true })).status).toBeLessThan(300);
  });

  it('only product managers may bulk-import products', async () => {
    principal = legacy(UserRole.REQUESTER);
    await call('post', '/products/stock-register/import').expect(403);
  });

  it('only audit roles may export the audit trail; other exports are unchanged', async () => {
    principal = legacy(UserRole.REQUESTER);
    await call('get', '/io/export/audit').expect(403);
    principal = legacy(UserRole.AUDITOR);
    expect((await call('get', '/io/export/audit')).status).toBeLessThan(300);
  });

  it('only administrators may create approval rules', async () => {
    principal = legacy(UserRole.WAREHOUSE_MANAGER);
    await call('post', '/approvals/rules', {}).expect(403);
  });

  describe('input validation on stock writes', () => {
    beforeEach(() => { principal = legacy(UserRole.SYSTEM_ADMIN); });

    it.each([
      ['/putaway/s1/confirm'],
      ['/transfer/t1/complete'],
      ['/inventory/s1/location'],
    ])('%s rejects stock fields other than the location', async (path) => {
      await call('patch', path, { warehouseId: 'w1', quantity: 999 }).expect(400);
      await call('patch', path, { status: 'AVAILABLE' }).expect(400);
      await call('patch', path, { productId: 'p2' }).expect(400);
    });

    it('requires an explicit approve/reject decision (a missing flag used to reject)', async () => {
      await call('patch', '/requests/r1/approve', {}).expect(400);
      await call('patch', '/requests/r1/approve', { rejectReason: 'x' }).expect(400);
    });

    it('rejects an unknown RMA usage value', async () => {
      await call('patch', '/rma/r1/usage', { usage: 'used' }).expect(400);
      expect((await call('patch', '/rma/r1/usage', { usage: 'USED' })).status).toBeLessThan(300);
    });
  });
});
