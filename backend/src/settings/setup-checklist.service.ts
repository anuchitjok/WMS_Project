import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';
import { isApprovalEngineEnabled } from '../common/feature-flags';

/**
 * Phase 6 — System Setup Checklist (N01 setup review S05/S01).
 *
 * Read-only. Every status comes from checking the data itself, never from
 * "the page was opened": NOT_STARTED (nothing set up), IN_PROGRESS (started,
 * something still missing), READY, NEEDS_FIX (set up but something is wrong),
 * REVIEW (works, but a person should look — e.g. test accounts / test rules).
 * Steps follow the recommended order; each lists what is missing and where to fix it.
 */
export type StepStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'READY'
  | 'NEEDS_FIX'
  | 'REVIEW';
export interface SetupStep {
  key: string;
  order: number;
  title: string;
  status: StepStatus;
  summary: string;
  issues: string[];
  href: string;
}

const TEST_NAME = /(^|[^a-z])(e2e|test|uat|demo|dummy|sample)([^a-z]|$)/i;
const MAX_LISTED = 10;
const list = (items: string[]) =>
  items.length > MAX_LISTED
    ? [...items.slice(0, MAX_LISTED), `…and ${items.length - MAX_LISTED} more`]
    : items;

@Injectable()
export class SetupChecklistService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  async checklist(): Promise<{
    steps: SetupStep[];
    ready: boolean;
    counts: Record<StepStatus, number>;
  }> {
    const p = this.prisma;
    const [
      company,
      uoms,
      departments,
      brands,
      vendors,
      warehouses,
      products,
      roles,
      users,
      rules,
      reasons,
      settings,
    ] = await Promise.all([
      p.companyProfile.findUnique({ where: { id: 'default' } }),
      p.unitOfMeasure.findMany({
        where: { isActive: true },
        select: { code: true },
      }),
      p.department.count({ where: { isActive: true } }),
      p.brand.count({ where: { isActive: true } }),
      p.vendor.count({ where: { isActive: true } }),
      p.warehouse.findMany({
        where: { isActive: true, isDeleted: false },
        select: {
          code: true,
          racks: {
            where: { isActive: true, isDeleted: false },
            select: { code: true, _count: { select: { slots: true } } },
          },
        },
      }),
      p.product.findMany({
        where: { isActive: true },
        select: { code: true, unit: true },
      }),
      p.role.findMany({
        where: { isActive: true },
        select: { key: true, _count: { select: { permissions: true } } },
      }),
      p.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: {
          username: true,
          fullName: true,
          role: true,
          roleId: true,
          rbacRole: { select: { key: true } },
        },
      }),
      p.approvalRule.findMany({
        where: { isActive: true },
        select: { name: true, entityType: true },
      }),
      p.reasonCode.groupBy({
        by: ['category'],
        where: { isActive: true },
        _count: { _all: true },
      }),
      this.settings.findAll(),
    ]);
    const steps: SetupStep[] = [];
    const push = (s: Omit<SetupStep, 'order'>) =>
      steps.push({ ...s, order: steps.length + 1 });

    // 1. Company profile
    const companyMissing = [
      !company?.legalName && 'legal name',
      !company?.address && 'address',
      !company?.taxId && 'tax ID',
    ].filter(Boolean) as string[];
    push({
      key: 'company',
      title: 'Company profile',
      href: '/company-profile',
      status:
        !company?.legalName && !company?.displayName
          ? 'NOT_STARTED'
          : companyMissing.length
            ? 'IN_PROGRESS'
            : 'READY',
      summary:
        company?.legalName || company?.displayName
          ? `${company.legalName ?? company.displayName}`
          : 'No company details yet',
      issues: companyMissing.map((m) => `Missing ${m}`),
    });

    // 2. Codes and units of measure
    const reasonCount = new Map(
      reasons.map((r) => [r.category, r._count._all]),
    );
    const codeIssues = [
      ...(uoms.length
        ? []
        : ['No units of measure — products cannot pick a unit']),
      ...(departments
        ? []
        : ['No departments — requests and users accept any text']),
      ...['DOA', 'SCRAP']
        .filter((c) => !reasonCount.get(c))
        .map(
          (c) => `No active ${c} reason codes — free-text reasons are accepted`,
        ),
    ];
    push({
      key: 'codes',
      title: 'Units of measure, departments and reason codes',
      href: '/system-master',
      status:
        !uoms.length && !departments && !reasons.length
          ? 'NOT_STARTED'
          : !uoms.length
            ? 'NEEDS_FIX'
            : codeIssues.length
              ? 'IN_PROGRESS'
              : 'READY',
      summary: `${uoms.length} unit(s), ${departments} department(s), ${reasons.reduce((n, r) => n + r._count._all, 0)} reason code(s)`,
      issues: codeIssues,
    });

    // 3. Brands and vendors
    push({
      key: 'partners',
      title: 'Brands and vendors',
      href: '/business-partners',
      status:
        !brands && !vendors
          ? 'NOT_STARTED'
          : !brands || !vendors
            ? 'IN_PROGRESS'
            : 'READY',
      summary: `${brands} brand(s), ${vendors} vendor(s)`,
      issues: [
        ...(brands ? [] : ['No active brand']),
        ...(vendors
          ? []
          : ['No active vendor — vendor receipts and RTV need one']),
      ],
    });

    // 4. Warehouse structure
    const noRacks = warehouses
      .filter((w) => !w.racks.length)
      .map((w) => `Warehouse ${w.code} has no rack`);
    const noSlots = warehouses.flatMap((w) =>
      w.racks
        .filter((r) => !r._count.slots)
        .map((r) => `Rack ${w.code} › ${r.code} has no slot`),
    );
    push({
      key: 'warehouse',
      title: 'Warehouse structure',
      href: '/warehouse-master',
      status: !warehouses.length
        ? 'NOT_STARTED'
        : noRacks.length === warehouses.length
          ? 'IN_PROGRESS'
          : noRacks.length || noSlots.length
            ? 'NEEDS_FIX'
            : 'READY',
      summary: `${warehouses.length} warehouse(s), ${warehouses.reduce((n, w) => n + w.racks.length, 0)} rack(s)`,
      issues: list([...noRacks, ...noSlots]),
    });

    // 5. Products
    const uomCodes = new Set(uoms.map((u) => u.code));
    const badUnit = uomCodes.size
      ? products
          .filter((x) => !x.unit || !uomCodes.has(x.unit))
          .map(
            (x) =>
              `${x.code}: unit "${x.unit ?? ''}" is not a listed unit of measure`,
          )
      : [];
    push({
      key: 'products',
      title: 'Products',
      href: '/products',
      status: !products.length
        ? 'NOT_STARTED'
        : badUnit.length
          ? 'NEEDS_FIX'
          : 'READY',
      summary: `${products.length} active product(s)`,
      issues: list(badUnit),
    });

    // 6. Roles, users and warehouse scope
    const emptyRoles = roles
      .filter((r) => r._count.permissions === 0 && r.key !== 'SUPER_ADMIN')
      .map((r) => `Role ${r.key} grants no permissions`);
    const admins = users.filter(
      (u) => u.role === 'SYSTEM_ADMIN' || u.rbacRole?.key === 'SUPER_ADMIN',
    );
    const testUsers = users
      .filter(
        (u) => TEST_NAME.test(u.username) || TEST_NAME.test(u.fullName ?? ''),
      )
      .map((u) => `Active account looks like a test account: ${u.username}`);
    const userIssues = [
      ...emptyRoles,
      ...(admins.length > 3
        ? [
            `${admins.length} active administrator accounts — confirm each still needs full access`,
          ]
        : []),
      ...testUsers,
    ];
    push({
      key: 'access',
      title: 'Roles, users and warehouse access',
      href: '/users',
      status:
        users.length <= 1
          ? 'NOT_STARTED'
          : emptyRoles.length
            ? 'NEEDS_FIX'
            : userIssues.length
              ? 'REVIEW'
              : 'READY',
      summary: `${roles.length} role(s), ${users.length} active user(s), ${admins.length} administrator(s)`,
      issues: list(userIssues),
    });

    // 7. Approval rules
    const engine = isApprovalEngineEnabled();
    const testRules = rules
      .filter((r) => TEST_NAME.test(r.name))
      .map(
        (r) =>
          `Active rule looks like a test rule: "${r.name}" — disable it after review (do not delete)`,
      );
    push({
      key: 'approvals',
      title: 'Approval rules',
      href: '/approval-rules',
      status:
        engine && !rules.length
          ? 'NEEDS_FIX'
          : testRules.length
            ? 'REVIEW'
            : 'READY',
      summary: engine
        ? `Approval engine on — ${rules.length} active rule(s)`
        : `Built-in approval (engine off) — ${rules.length} active rule(s) kept for later`,
      issues: [
        ...(engine && !rules.length
          ? [
              'Approval engine is on but no rule is active — requests cannot be routed',
            ]
          : []),
        ...list(testRules),
      ],
    });

    // 8. System settings (S01): a stored value the system ignores must not look ready.
    type SettingRow = {
      label: string;
      value: string;
      state: string;
      problem: string | null;
    };
    const invalid = (settings as SettingRow[])
      .filter((s) => s.state === 'invalid')
      .map((s) => `${s.label}: stored "${s.value}" is ignored — ${s.problem}`);
    push({
      key: 'settings',
      title: 'System settings',
      href: '/settings',
      status: invalid.length ? 'NEEDS_FIX' : 'READY',
      summary: invalid.length
        ? `${invalid.length} setting(s) not in force`
        : 'All stored settings are in force',
      issues: invalid,
    });

    const counts = {
      NOT_STARTED: 0,
      IN_PROGRESS: 0,
      READY: 0,
      NEEDS_FIX: 0,
      REVIEW: 0,
    } as Record<StepStatus, number>;
    steps.forEach((s) => counts[s.status]++);
    return {
      steps,
      ready: steps.every((s) => s.status === 'READY' || s.status === 'REVIEW'),
      counts,
    };
  }
}
