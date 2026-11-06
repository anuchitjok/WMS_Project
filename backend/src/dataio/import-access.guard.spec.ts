import { UserRole } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { ImportAccessGuard } from './import-access.guard';

const ctx = (user: any, type: string) => ({
  switchToHttp: () => ({ getRequest: () => ({ user, params: { type } }) }),
}) as any;

describe('ImportAccessGuard', () => {
  const guard = new ImportAccessGuard();
  const as = (role: UserRole) => ({ id: 'u', role, rbacAssigned: false });

  it('product import: SYSTEM_ADMIN and WAREHOUSE_MANAGER only (plan 1.7)', () => {
    expect(guard.canActivate(ctx(as(UserRole.SYSTEM_ADMIN), 'products'))).toBe(true);
    expect(guard.canActivate(ctx(as(UserRole.WAREHOUSE_MANAGER), 'products'))).toBe(true);
    expect(() => guard.canActivate(ctx(as(UserRole.WAREHOUSE_SUPERVISOR), 'products'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(as(UserRole.WAREHOUSE_STAFF), 'products'))).toThrow(ForbiddenException);
  });

  it('product import for DB-role users needs product.manage', () => {
    expect(guard.canActivate(ctx({ rbacAssigned: true, permissions: ['product.manage'] }, 'products'))).toBe(true);
    expect(() => guard.canActivate(ctx({ rbacAssigned: true, permissions: ['dataio.manage'] }, 'products'))).toThrow(ForbiddenException);
  });

  it('other import types keep the Data Import rule (users unchanged)', () => {
    expect(guard.canActivate(ctx(as(UserRole.WAREHOUSE_SUPERVISOR), 'users'))).toBe(true);
    expect(guard.canActivate(ctx({ rbacAssigned: true, permissions: ['dataio.manage'] }, 'users'))).toBe(true);
    expect(() => guard.canActivate(ctx(as(UserRole.WAREHOUSE_STAFF), 'users'))).toThrow(ForbiddenException);
  });

  it('rejects anonymous requests', () => {
    expect(() => guard.canActivate(ctx(undefined, 'products'))).toThrow(ForbiddenException);
  });
});
