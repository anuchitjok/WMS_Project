import { ForbiddenException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  USER_EXPORT_COLUMNS,
  USER_EXPORT_SELECT,
  assertWarehouseAssignmentScope,
  canAssignWarehouses,
  canManageUsers,
  toUserExportRow,
  usersCapabilities,
} from './user-access';
import { UsersService } from './users.service';

const SECRET = /password|hash|token|secret|failedLogin|locked|otp|mfa/i;

describe('users export never includes secret fields', () => {
  it('column allow-list has no secret-looking column', () => {
    for (const c of USER_EXPORT_COLUMNS) {
      expect(c.key).not.toMatch(SECRET);
      expect(c.header).not.toMatch(SECRET);
    }
  });

  it('prisma select never asks for secret fields', () => {
    expect(JSON.stringify(USER_EXPORT_SELECT)).not.toMatch(SECRET);
  });

  it('row builder copies allowed keys only, even if the input carries secrets', () => {
    const row = toUserExportRow({
      username: 'jdoe', fullName: 'John Doe', email: 'j@x.co', role: 'WAREHOUSE_STAFF', department: 'WH',
      isActive: true, lastLoginAt: new Date('2026-11-01T02:03:04Z'),
      rbacRole: { name: 'Picker' },
      roleAssignments: [
        { expiresAt: null, role: { name: 'Requester' } },
        { expiresAt: new Date('2000-01-01'), role: { name: 'Expired Role' } },
      ],
      warehouses: [{ warehouse: { code: 'WH-B' } }, { warehouse: { code: 'WH-A' } }],
      passwordHash: '$2a$12$abc', refreshToken: 'tok', failedLoginCount: 3,
    } as any);
    expect(Object.keys(row).sort()).toEqual(USER_EXPORT_COLUMNS.map((c) => c.key).sort());
    expect(JSON.stringify(row)).not.toContain('$2a$');
    expect(JSON.stringify(row)).not.toContain('tok');
    expect(row).toEqual({
      username: 'jdoe', fullName: 'John Doe', email: 'j@x.co', role: 'WAREHOUSE_STAFF',
      rbacRoles: 'Picker, Requester', department: 'WH', warehouses: 'WH-A, WH-B',
      active: 'true', lastLoginAt: '2026-11-01T02:03:04.000Z',
    });
  });

  it('UsersService.exportUsers writes only allow-listed columns to the file', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { username: 'a', fullName: 'A', email: null, role: 'REQUESTER', department: null, isActive: false, lastLoginAt: null,
        rbacRole: null, roleAssignments: [], warehouses: [], passwordHash: 'SHOULD_NOT_APPEAR' },
    ]);
    const svc = new UsersService({ user: { findMany } } as any, {} as any);
    const buf = await svc.exportUsers('csv');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ select: USER_EXPORT_SELECT, where: { deletedAt: null } }));
    const text = buf.toString('utf8');
    expect(text.split('\n')[0]).toBe(USER_EXPORT_COLUMNS.map((c) => c.header).join(','));
    expect(text).not.toContain('SHOULD_NOT_APPEAR');

    const xlsx = await svc.exportUsers('xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as any);
    const header = (wb.worksheets[0].getRow(1).values as any[]).filter(Boolean);
    expect(header).toEqual(USER_EXPORT_COLUMNS.map((c) => c.header));
  });
});

describe('users permission rules (P1 1.7)', () => {
  const superAdmin = { id: 's', roleKey: 'SUPER_ADMIN', rbacAssigned: true, permissions: [] };
  const admin = { id: 'a', roleKey: 'ADMIN', rbacAssigned: true, permissions: ['user.manage', 'warehouse.manage'] };
  const dbManager = { id: 'm', roleKey: 'WAREHOUSE_MANAGER', roleKeys: ['WAREHOUSE_MANAGER'], rbacAssigned: true, permissions: ['warehouse.manage'] };
  const legacyManager = { id: 'l', role: 'WAREHOUSE_MANAGER', rbacAssigned: false, permissions: [] };
  const inventoryControl = { id: 'i', roleKey: 'INVENTORY_CONTROL', rbacAssigned: true, role: 'WAREHOUSE_STAFF', permissions: ['warehouse.manage'] };
  const requester = { id: 'r', role: 'REQUESTER', rbacAssigned: false, permissions: [] };

  it('full user management stays with user.manage / SUPER_ADMIN', () => {
    expect(canManageUsers(superAdmin)).toBe(true);
    expect(canManageUsers(admin)).toBe(true);
    expect(canManageUsers(dbManager)).toBe(false);
    expect(canManageUsers(legacyManager)).toBe(false);
  });

  it('warehouse managers (DB role or legacy role) may assign warehouses; others may not', () => {
    expect(canAssignWarehouses(superAdmin)).toBe(true);
    expect(canAssignWarehouses(admin)).toBe(true);
    expect(canAssignWarehouses(dbManager)).toBe(true);
    expect(canAssignWarehouses(legacyManager)).toBe(true);
    expect(canAssignWarehouses({ id: 'x', role: 'SYSTEM_ADMIN', rbacAssigned: false })).toBe(true);
    expect(canAssignWarehouses(inventoryControl)).toBe(false);
    expect(canAssignWarehouses(requester)).toBe(false);
    expect(canAssignWarehouses(null)).toBe(false);
  });

  it('capabilities: a manager gets assign/export only, never manage or import', () => {
    expect(usersCapabilities(dbManager, true)).toEqual({ manageUsers: false, assignWarehouses: true, exportUsers: true, importUsers: false });
    expect(usersCapabilities(admin, true)).toEqual({ manageUsers: true, assignWarehouses: true, exportUsers: true, importUsers: true });
    expect(usersCapabilities(admin, false).importUsers).toBe(false);
    expect(usersCapabilities(requester, true)).toEqual({ manageUsers: false, assignWarehouses: false, exportUsers: false, importUsers: false });
  });

  describe('assertWarehouseAssignmentScope', () => {
    const scoped = { ...dbManager, warehouseIds: ['A', 'B'] };

    it('admins and unrestricted managers may set any warehouses', () => {
      expect(() => assertWarehouseAssignmentScope(admin, ['X'], [])).not.toThrow();
      expect(() => assertWarehouseAssignmentScope(dbManager, [], ['X', 'Y'])).not.toThrow();
    });

    it('a scoped manager may add/remove only their own warehouses', () => {
      expect(() => assertWarehouseAssignmentScope(scoped, ['A', 'X'], ['B', 'X'])).not.toThrow();
      expect(() => assertWarehouseAssignmentScope(scoped, ['A'], ['A', 'X'])).toThrow(ForbiddenException);
      expect(() => assertWarehouseAssignmentScope(scoped, ['A', 'X'], ['A'])).toThrow(ForbiddenException);
    });

    it('a scoped manager may not clear the list (empty = every warehouse)', () => {
      expect(() => assertWarehouseAssignmentScope(scoped, ['A'], [])).toThrow(ForbiddenException);
    });

    it('anyone else is refused', () => {
      expect(() => assertWarehouseAssignmentScope(inventoryControl as any, [], ['A'])).toThrow(ForbiddenException);
    });
  });

  it('UsersService.setWarehouses refuses a manager changing a system administrator account', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 't', role: 'SYSTEM_ADMIN', rbacRole: null, roleAssignments: [], warehouses: [] }),
      },
      $transaction: jest.fn(),
    };
    const svc = new UsersService(prisma, {} as any);
    await expect(svc.setWarehouses('t', ['A'], dbManager as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('UsersController guard metadata', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { UsersController } = require('./users.controller');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PERMISSIONS_KEY } = require('../auth/decorators/permissions.decorator');
  const proto = UsersController.prototype;
  const meta = (name: string) => Reflect.getMetadata(PERMISSIONS_KEY, proto[name]);

  it('keeps user.manage at class level', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, UsersController)).toEqual(['user.manage']);
  });

  it('only list, export, capabilities and warehouse assignment lift it', () => {
    for (const m of ['findAll', 'export', 'capabilities', 'setWarehouses']) expect(meta(m)).toEqual([]);
    for (const m of ['findOne', 'create', 'update', 'toggle', 'resetPassword', 'forceChange', 'setRole', 'assignRole', 'unassignRole', 'softDelete', 'loginHistory', 'roleAssignments']) {
      expect(meta(m)).toBeUndefined();
    }
  });
});
