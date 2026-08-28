import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ExecutionContext, CanActivate } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { WarehouseLayoutController } from './warehouse-layout.controller';
import { WarehouseLayoutService } from './warehouse-layout.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// HTTP-level cover: route resolution order, the global ValidationPipe contract,
// and the real RolesGuard. Only authentication is stubbed; RolesGuard is the
// genuine article so the role matrix is actually exercised.

let currentRole: UserRole = UserRole.SYSTEM_ADMIN;

class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = {
      id: 'u1', role: currentRole, roleKey: 'ADMIN', warehouseIds: ['wh_1'],
    };
    return true;
  }
}

// Sprint 7: handlers forward the caller's warehouse scope to the service.
const SCOPE = { roleKey: 'ADMIN', warehouseIds: ['wh_1'] };

describe('WarehouseLayoutController (HTTP)', () => {
  let app: INestApplication;
  const service = {
    getByWarehouse: jest.fn().mockResolvedValue({ warehouse: {}, layout: null, objects: [] }),
    createLayout: jest.fn().mockResolvedValue({ id: 'lay_1' }),
    updateCanvas: jest.fn().mockResolvedValue({ id: 'lay_1' }),
    createObject: jest.fn().mockResolvedValue({ id: 'obj_1' }),
    updateObject: jest.fn().mockResolvedValue({ id: 'obj_1' }),
    deleteObject: jest.fn().mockResolvedValue({ success: true, deletedIds: ['obj_1'] }),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [WarehouseLayoutController],
      providers: [{ provide: WarehouseLayoutService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubAuthGuard)
      .compile();

    app = mod.createNestApplication();
    // Same pipe configuration as main.ts.
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
      transformOptions: { enableImplicitConversion: true }, forbidUnknownValues: true,
      validationError: { target: false, value: false },
    }));
    await app.init();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { currentRole = UserRole.SYSTEM_ADMIN; jest.clearAllMocks(); });

  const validObject = { objectType: 'BIN', name: 'Bin A-01-01', x: 1, y: 2, width: 1, height: 1 };

  describe('route resolution', () => {
    it('PATCH /objects/:id hits updateObject, not the :warehouseId routes', async () => {
      await request(app.getHttpServer()).patch('/warehouse-layout/objects/obj_1').send({ name: 'X' }).expect(200);
      expect(service.updateObject).toHaveBeenCalledWith('obj_1', { name: 'X' }, 'u1', SCOPE);
    });

    it('DELETE /objects/:id passes cascade through as a boolean', async () => {
      await request(app.getHttpServer()).delete('/warehouse-layout/objects/obj_1?cascade=true').expect(200);
      expect(service.deleteObject).toHaveBeenCalledWith('obj_1', true, 'u1', SCOPE);
    });

    it('DELETE without cascade defaults to false', async () => {
      await request(app.getHttpServer()).delete('/warehouse-layout/objects/obj_1').expect(200);
      expect(service.deleteObject).toHaveBeenCalledWith('obj_1', false, 'u1', SCOPE);
    });

    it('GET /:warehouseId resolves to the warehouse read', async () => {
      await request(app.getHttpServer()).get('/warehouse-layout/wh_1').expect(200);
      expect(service.getByWarehouse).toHaveBeenCalledWith('wh_1', SCOPE);
    });

    it('POST /:layoutId/objects resolves to createObject', async () => {
      await request(app.getHttpServer()).post('/warehouse-layout/lay_1/objects').send(validObject).expect(201);
      expect(service.createObject).toHaveBeenCalledWith('lay_1', expect.objectContaining({ name: 'Bin A-01-01' }), 'u1', SCOPE);
    });
  });

  describe('validation contract', () => {
    it('rejects slotId — linking is Sprint 6, not part of this API yet', async () => {
      const res = await request(app.getHttpServer())
        .post('/warehouse-layout/lay_1/objects')
        .send({ ...validObject, slotId: 'slot_1' })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/slotId/);
      expect(service.createObject).not.toHaveBeenCalled();
    });

    it('rejects a zero-width object', async () => {
      await request(app.getHttpServer())
        .post('/warehouse-layout/lay_1/objects').send({ ...validObject, width: 0 }).expect(400);
    });

    it('rejects a negative coordinate', async () => {
      await request(app.getHttpServer())
        .post('/warehouse-layout/lay_1/objects').send({ ...validObject, x: -5 }).expect(400);
    });

    it('rejects an unknown objectType', async () => {
      await request(app.getHttpServer())
        .post('/warehouse-layout/lay_1/objects').send({ ...validObject, objectType: 'TELEPORTER' }).expect(400);
    });

    it('rejects a malformed colour', async () => {
      await request(app.getHttpServer())
        .post('/warehouse-layout/lay_1/objects').send({ ...validObject, color: 'green' }).expect(400);
    });

    it('accepts a well-formed object', async () => {
      await request(app.getHttpServer())
        .post('/warehouse-layout/lay_1/objects')
        .send({ ...validObject, color: '#15803D', rotation: 90, capacity: 12 })
        .expect(201);
    });
  });

  describe('RBAC (real RolesGuard)', () => {
    it('allows WAREHOUSE_STAFF to read', async () => {
      currentRole = UserRole.WAREHOUSE_STAFF;
      await request(app.getHttpServer()).get('/warehouse-layout/wh_1').expect(200);
    });

    it('blocks WAREHOUSE_STAFF from writing (403)', async () => {
      currentRole = UserRole.WAREHOUSE_STAFF;
      await request(app.getHttpServer())
        .post('/warehouse-layout/lay_1/objects').send(validObject).expect(403);
      expect(service.createObject).not.toHaveBeenCalled();
    });

    it('blocks WAREHOUSE_SUPERVISOR from writing (403)', async () => {
      currentRole = UserRole.WAREHOUSE_SUPERVISOR;
      await request(app.getHttpServer()).delete('/warehouse-layout/objects/obj_1').expect(403);
    });

    it('blocks REQUESTER from writing (403)', async () => {
      currentRole = UserRole.REQUESTER;
      await request(app.getHttpServer()).post('/warehouse-layout/wh_1').send({}).expect(403);
    });

    it('allows WAREHOUSE_MANAGER to write', async () => {
      currentRole = UserRole.WAREHOUSE_MANAGER;
      await request(app.getHttpServer()).post('/warehouse-layout/lay_1/objects').send(validObject).expect(201);
    });
  });
});
