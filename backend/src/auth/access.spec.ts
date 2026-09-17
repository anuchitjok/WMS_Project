import { UserRole } from '@prisma/client';
import { ACCESS, hasAccess } from './access';

// The DB permission matrix is canonical once a user holds a DB role; the legacy
// enum only decides for users that have not been migrated yet.

describe('hasAccess', () => {
  it('denies a missing principal', () => {
    expect(hasAccess(undefined, ACCESS.fulfillment)).toBe(false);
  });

  it('lets SUPER_ADMIN through every rule', () => {
    const su = { roleKey: 'SUPER_ADMIN', rbacAssigned: true, permissions: [] };
    for (const rule of Object.values(ACCESS)) expect(hasAccess(su, rule)).toBe(true);
  });

  describe('users with a DB role', () => {
    it('are authorised by permission codes, not by their legacy role', () => {
      const picker = { role: UserRole.SYSTEM_ADMIN, rbacAssigned: true, permissions: ['fulfillment.manage', 'putaway.manage'] };
      expect(hasAccess(picker, ACCESS.fulfillment)).toBe(true);
      expect(hasAccess(picker, ACCESS.putaway)).toBe(true);
      // Legacy SYSTEM_ADMIN would pass, but the DB role does not grant inventory.adjust.
      expect(hasAccess(picker, ACCESS.adjustment)).toBe(false);
      expect(hasAccess(picker, ACCESS.rmaUsage)).toBe(false);
    });

    it('get nothing when every role is disabled (no fallback to the legacy role)', () => {
      const disabled = { role: UserRole.WAREHOUSE_MANAGER, rbacAssigned: true, permissions: [] };
      for (const rule of Object.values(ACCESS)) expect(hasAccess(disabled, rule)).toBe(false);
    });

    it('need only one of several listed permissions', () => {
      expect(hasAccess({ rbacAssigned: true, permissions: ['putaway.manage'] }, ACCESS.cycleCount)).toBe(true);
      expect(hasAccess({ rbacAssigned: true, permissions: ['inventory.adjust'] }, ACCESS.cycleCount)).toBe(true);
    });
  });

  describe('users without a DB role (legacy fallback)', () => {
    const legacy = (role: UserRole) => ({ role, rbacAssigned: false, permissions: [] });

    it('keep the access their legacy role had', () => {
      expect(hasAccess(legacy(UserRole.WAREHOUSE_STAFF), ACCESS.fulfillment)).toBe(true);
      expect(hasAccess(legacy(UserRole.WAREHOUSE_STAFF), ACCESS.receiving)).toBe(true);
      expect(hasAccess(legacy(UserRole.DEPT_APPROVER), ACCESS.requestApprove)).toBe(true);
    });

    it('are refused warehouse writes outside their role', () => {
      const requester = legacy(UserRole.REQUESTER);
      for (const rule of [ACCESS.fulfillment, ACCESS.putaway, ACCESS.scrap, ACCESS.cycleCountApprove, ACCESS.returnsInbound, ACCESS.auditExport]) {
        expect(hasAccess(requester, rule)).toBe(false);
      }
      expect(hasAccess(legacy(UserRole.WAREHOUSE_STAFF), ACCESS.adjustment)).toBe(false);
    });

    it("accept any authenticated user on 'ANY' rules", () => {
      expect(hasAccess(legacy(UserRole.REQUESTER), ACCESS.rmaUsage)).toBe(true);
    });
  });
});
