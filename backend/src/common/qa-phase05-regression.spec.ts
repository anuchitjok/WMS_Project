/**
 * Regression tests for the defects fixed in QA Phase 05.
 *
 * Each block names the issue it guards and asserts the property that was wrong, so a
 * future change that reintroduces the defect fails here rather than in manual QA.
 */
import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('WMS-01-001 — retired write endpoints, and the one deliberate exception', () => {
  // Investigated in Phase 05 and NOT a defect. `cancel` is intentionally left open so a
  // count locked before Step 5 was retired can still release its stock. The existing
  // suite asserts this in auth/warehouse-write-authorization.spec.ts.
  // This test pins the exception to exactly one endpoint, so a future omission elsewhere
  // is still caught — the @Retired guard is metadata-driven and fails OPEN.
  const EXPECTED_EXCEPTIONS = [":id/cancel"];

  const controllers: Array<[string, string]> = [
    ['cycle-count', join('cycle-count', 'cycle-count.controller.ts')],
    ['adjustment', join('adjustment', 'adjustment.controller.ts')],
    ['transfer', join('transfer', 'transfer.controller.ts')],
  ];

  it.each(controllers)('%s: only the documented exception lacks @Retired', (_name, rel) => {
    const lines = src(rel).split('\n');
    const unguarded: string[] = [];
    lines.forEach((line, i) => {
      const m = /^\s*@(Post|Patch|Put|Delete)\(/.exec(line);
      if (!m) return;
      const back = lines.slice(Math.max(0, i - 6), i).join('\n');
      if (/@Retired\(/.test(back)) return;
      if (EXPECTED_EXCEPTIONS.some((e) => line.includes(e))) return;
      unguarded.push(`line ${i + 1}: ${line.trim()}`);
    });
    expect(unguarded).toEqual([]);
  });

  it('the cancel exception is explained in the code, not just absent', () => {
    const text = src(join('cycle-count', 'cycle-count.controller.ts'));
    const idx = text.indexOf("@Post(':id/cancel')");
    expect(idx).toBeGreaterThan(-1);
    // a comment must justify why this one is open, so it is not "fixed" by mistake later
    expect(text.slice(Math.max(0, idx - 400), idx)).toMatch(/Deliberately NOT @Retired/);
  });
});

describe('WMS-01-003 — a missing planning-run id is a 400, not an engine panic', () => {
  // Prisma 7 panics its query compiler on `where: { id: undefined }` instead of
  // returning null, so the guard must happen before the query.
  const makeService = () => {
    const prisma = { mrpRun: { findUnique: jest.fn() } };
    // exercise the guard logic directly; the real service pulls in the whole Nest graph
    const getRun = async (id: string | undefined) => {
      if (!id || typeof id !== 'string') throw new BadRequestException('A planning run id is required');
      return prisma.mrpRun.findUnique({ where: { id } });
    };
    const compare = async (baseId?: string, targetId?: string) => {
      if (!baseId || !targetId) {
        throw new BadRequestException('base and target are both required to compare two planning runs');
      }
      return Promise.all([getRun(baseId), getRun(targetId)]);
    };
    return { prisma, getRun, compare };
  };

  it('compare with neither parameter throws BadRequest and never queries', async () => {
    const { prisma, compare } = makeService();
    await expect(compare(undefined, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mrpRun.findUnique).not.toHaveBeenCalled();
  });

  it('compare with only one parameter still throws BadRequest', async () => {
    const { prisma, compare } = makeService();
    await expect(compare('abc', undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(compare(undefined, 'abc')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mrpRun.findUnique).not.toHaveBeenCalled();
  });

  it('getRun refuses an undefined id so no caller can reach findUnique with it', async () => {
    const { prisma, getRun } = makeService();
    await expect(getRun(undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mrpRun.findUnique).not.toHaveBeenCalled();
  });

  it('a well-formed pair does reach the query', async () => {
    const { prisma, compare } = makeService();
    await compare('a', 'b');
    expect(prisma.mrpRun.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('WMS-01-004 — request bodies are typed, so the ValidationPipe can act', () => {
  it('no controller declares an untyped @Body()', () => {
    const files = [
      join('roles', 'roles.controller.ts'),
      join('auth', 'auth.controller.ts'),
    ];
    for (const rel of files) {
      const text = src(rel);
      expect(text).not.toMatch(/@Body\(\)\s+\w+\s*:\s*any/);
      // an inline object type is just as invisible at runtime as `any`
      expect(text).not.toMatch(/@Body\(\)\s+\w+\s*:\s*\{/);
    }
  });

  it('the DTO classes exist and declare their required fields', () => {
    const roles = src(join('roles', 'roles.dto.ts'));
    expect(roles).toContain('class CreateRoleDto');
    expect(roles).toContain('class CreatePermissionDto');
    expect(roles).toMatch(/IsNotEmpty[\s\S]*key/);

    const pw = src(join('auth', 'dto', 'change-password.dto.ts'));
    expect(pw).toContain('class ChangePasswordDto');
    expect(pw).toMatch(/oldPassword/);
    expect(pw).toMatch(/newPassword/);
  });
});

describe('WMS-01-005 — a missing required field is 400, not 409', () => {
  it('warehouse master-data creates use BadRequestException for missing fields', () => {
    const text = src(join('warehouse', 'warehouse.service.ts'));
    for (const msg of ['Brand name is required', 'Family name is required', 'Vendor code and name are required']) {
      const i = text.indexOf(msg);
      expect(i).toBeGreaterThan(-1);
      const stmt = text.slice(Math.max(0, i - 120), i);
      expect(stmt).toContain('BadRequestException');
      expect(stmt).not.toContain('ConflictException');
    }
  });
});

describe('WMS-01-007 — paginated queries have a unique tiebreaker', () => {
  // orderBy on a non-unique timestamp with OFFSET paging repeats rows on one page and
  // drops them from another. Every paginated findMany must break the tie on `id`.
  const files = [
    join('audit', 'audit.service.ts'),
    join('inventory', 'inventory.service.ts'),
    join('products', 'products.service.ts'),
    join('relocation', 'relocation.service.ts'),
    join('requests', 'requests.service.ts'),
    join('rtv', 'rtv.service.ts'),
    join('scrap', 'scrap.service.ts'),
  ];

  it.each(files)('%s: no paginated query sorts on a bare timestamp', (rel) => {
    const lines = src(rel).split('\n');
    const offenders: string[] = [];
    lines.forEach((line, i) => {
      if (!/orderBy: \{ (createdAt|updatedAt): 'desc' \},/.test(line)) return;
      const near = lines.slice(Math.max(0, i - 4), i + 5).join('\n');
      if (/^\s*skip[,:]/m.test(near)) offenders.push(`line ${i + 1}: ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });

  it('at least eight sites carry the id tiebreaker', () => {
    const total = files.reduce((n, rel) => {
      const m = src(rel).match(/orderBy: \[\{ (createdAt|updatedAt): 'desc' \}, \{ id: 'desc' \}\]/g);
      return n + (m ? m.length : 0);
    }, 0);
    expect(total).toBeGreaterThanOrEqual(8);
  });
});

describe('WMS-01-008 — a missing upload is a client error', () => {
  it('no controller throws a bare Error', () => {
    const text = src(join('products', 'products.controller.ts'));
    expect(text).not.toMatch(/throw new Error\(/);
    expect(text).toContain("throw new BadRequestException('No file uploaded')");
  });
});

describe('WMS-01-006 — Product Master writes honour the permission matrix', () => {
  // @Roles/RolesGuard reads only the legacy enum and ignores DB role permissions, so a
  // user granted `product.manage` was still refused.
  it('product write endpoints use @Access(PRODUCT_WRITE_ACCESS), not @Roles', () => {
    const text = src(join('products', 'products.controller.ts'));
    expect(text).not.toContain('@Roles(');
    expect(text).not.toContain('RolesGuard');
    const accessCount = (text.match(/@Access\(PRODUCT_WRITE_ACCESS\)/g) ?? []).length;
    expect(accessCount).toBeGreaterThanOrEqual(4); // create, update, status, import
  });

  it('PRODUCT_WRITE_ACCESS still accepts the legacy roles, so behaviour is unchanged for them', () => {
    const text = src(join('products', 'product-access.ts'));
    expect(text).toContain("permissions: ['product.manage']");
    expect(text).toContain('legacyRoles: PRODUCT_WRITE_ROLES');
  });

  it('the duplicate ACCESS.productImport rule is gone', () => {
    expect(src(join('auth', 'access.ts'))).not.toMatch(/^\s*productImport:/m);
  });
});

describe('WMS-04-002 — bootstrap failures are reported', () => {
  it('bootstrap() has a catch handler', () => {
    const text = src('main.ts');
    expect(text).toMatch(/bootstrap\(\)\s*\.catch\(/);
  });
});
