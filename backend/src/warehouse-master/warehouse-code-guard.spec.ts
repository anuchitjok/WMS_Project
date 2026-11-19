import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { createValidationPipe } from '../common/validation';
import { WarehouseMasterService } from './warehouse-master.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './warehouse-master.dto';

/**
 * RQ3 — Warehouse Code rules.
 *
 * A warehouse code is its permanent identity: unique, immutable once created,
 * and never reusable after the warehouse is retired (deactivated). Codes travel
 * in import files, labels and printed documents, so a reused or re-pointed code
 * would silently re-label history.
 *
 * Since the auto-code change the server also OWNS the code: it is generated from
 * the warehouse name (WH-<NAME SLUG>-<RUNNING NUMBER>, see warehouse-code.ts) and
 * anything a caller sends as `code` is ignored. The four guards that assumed a
 * typed code now lock the generated behaviour instead; the immutability guards
 * below are unchanged.
 *
 * Immutability is enforced today by `updateWarehouse` simply never reading
 * `dto.code` (and `UpdateWarehouseDto` not declaring one). These guards fail if
 * a future refactor starts honouring a code on update.
 */

const WH = {
  id: 'w1', code: 'WH-MAIN', name: 'Main', location: 'BKK',
  lengthCm: 2000, widthCm: 1000, heightCm: 400, usableAreaPct: 50,
  floorOutline: null, isActive: true, isDeleted: false,
};

function makePrisma(existingByCode: any = null, before: any = WH, takenCodes?: string[]) {
  const codes = takenCodes ?? (existingByCode ? [existingByCode.code] : []);
  const prisma: any = {
    // createWarehouse generates the code inside one transaction (advisory lock + recount).
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    warehouse: {
      findUnique: jest.fn().mockResolvedValue(existingByCode),
      findFirst: jest.fn().mockResolvedValue(before),
      findMany: jest.fn().mockResolvedValue(codes.map((code) => ({ code }))),
      create: jest.fn((a: any) => ({ id: 'w9', ...a.data })),
      // The stored row: only what `data` carries can change.
      update: jest.fn((a: any) => ({ ...before, ...a.data })),
    },
    stockItem: { count: jest.fn().mockResolvedValue(0) },
    rack: { count: jest.fn().mockResolvedValue(0) },
    slot: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  return { prisma, svc: new WarehouseMasterService(prisma) };
}

describe('RQ3 — the server owns the warehouse code', () => {
  it('RQ3: a code sent by the caller is ignored — the server builds it from the name', async () => {
    const { prisma, svc } = makePrisma(null);

    const wh = await svc.createWarehouse({ code: 'WH-MAIN', name: 'Another main' } as CreateWarehouseDto, 'u1');

    expect(prisma.warehouse.create.mock.calls[0][0].data.code).toBe('WH-ANOTHER-MAIN-001');
    expect(wh.code).not.toBe('WH-MAIN');
  });

  it('RQ3: the name is trimmed before the code is built', async () => {
    const { prisma, svc } = makePrisma(null);

    const wh = await svc.createWarehouse({ name: '  North  ' } as CreateWarehouseDto, 'u1');

    expect(prisma.warehouse.create.mock.calls[0][0].data).toMatchObject({ code: 'WH-NORTH-001', name: 'North' });
    expect(wh.code).toBe('WH-NORTH-001');
  });

  it('RQ3: a running number already in use is never handed out twice', async () => {
    const { svc } = makePrisma(null, WH, ['WH-MAIN', 'WH-NORTH-001', 'WH-SOUTH-002']);

    const wh = await svc.createWarehouse({ name: 'North' } as CreateWarehouseDto, 'u1');

    // Legacy codes (WH-MAIN) are not counted; the generated sequence continues at 003.
    expect(wh.code).toBe('WH-NORTH-003');
  });

  it('RQ3: a blank name is refused outright — the code is built from the name', async () => {
    const { prisma, svc } = makePrisma(null);

    await expect(svc.createWarehouse({ name: '   ' } as CreateWarehouseDto, 'u1'))
      .rejects.toThrow(new ConflictException('Warehouse name is required'));

    expect(prisma.warehouse.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('RQ3 — warehouse code is immutable after creation', () => {
  it('RQ3: updateWarehouse cannot change the code, even when one is passed through', async () => {
    const { prisma, svc } = makePrisma(null);

    // `code` is not on UpdateWarehouseDto; this is what a stray client payload
    // (or a future DTO that adds the field) would send.
    const after = await svc.updateWarehouse('w1', { name: 'Main renamed', code: 'WH-HACKED' } as unknown as UpdateWarehouseDto, 'u1');

    const data = prisma.warehouse.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('code');
    expect(data).toMatchObject({ name: 'Main renamed' });
    expect(after.code).toBe('WH-MAIN'); // the stored code is untouched
  });

  it('RQ3: no other update field can carry a code in — size, location and shape leave it alone', async () => {
    const { prisma, svc } = makePrisma(null);

    const after = await svc.updateWarehouse(
      'w1',
      { location: 'CNX', lengthCm: 3000, widthCm: 1500, usableAreaPct: 60, code: 'WH-OTHER' } as unknown as UpdateWarehouseDto,
      'u1',
    );

    const data = prisma.warehouse.update.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['lengthCm', 'location', 'usableAreaPct', 'widthCm']);
    expect(after.code).toBe('WH-MAIN');
  });

  it('RQ3: activate and deactivate never touch the code either', async () => {
    const active = makePrisma(null, WH);
    await active.svc.deactivateWarehouse('w1', 'u1');
    expect(active.prisma.warehouse.update.mock.calls[0][0].data).toEqual({ isActive: false });

    const inactive = makePrisma(null, { ...WH, isActive: false });
    await inactive.svc.activateWarehouse('w1', 'u1');
    expect(inactive.prisma.warehouse.update.mock.calls[0][0].data).toEqual({ isActive: true });
  });
});

/**
 * Both layers are tested on purpose, because they fail differently and either
 * one could be weakened on its own:
 *
 *  - The global validation pipe (`whitelist` + `forbidNonWhitelisted`) is the
 *    LOUD rejection: over HTTP a PATCH carrying `code` never reaches the
 *    service, it comes back 400 "property code should not exist". That is the
 *    behaviour a client actually sees, and it depends on the pipe's config —
 *    drop `forbidNonWhitelisted` and the rename becomes a silent 200.
 *  - The service's `pick()` whitelist (see the updateWarehouse tests above) is
 *    the BACKSTOP: it drops `code` even for an in-process caller that bypasses
 *    the pipe, and it still holds if the pipe config ever changes.
 *
 * These two tests validate the DTO through the real pipe rather than booting
 * Nest, in the same style as receiving-display.spec.ts.
 */
describe('RQ3 — the HTTP layer rejects a code on update', () => {
  const pipe = createValidationPipe();
  const patch = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: UpdateWarehouseDto });

  /** The reasons the 400 carries — the pipe puts them in the response body, not in error.message. */
  const rejectionReasons = async (body: Record<string, unknown>): Promise<string[]> => {
    try {
      await patch(body);
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const res = (e as BadRequestException).getResponse() as { message?: string | string[] };
      return [res.message ?? []].flat();
    }
    throw new Error('expected the pipe to reject this payload, but it was accepted');
  };

  it('RQ3: the API rejects a PATCH that carries a code, it does not silently strip it', async () => {
    await expect(patch({ name: 'Main renamed', code: 'WH-HACKED' })).rejects.toThrow(BadRequestException);
    // Named explicitly: a bare strip (whitelist without forbidNonWhitelisted)
    // would resolve with { name } instead and rejectionReasons would throw.
    expect(await rejectionReasons({ name: 'Main renamed', code: 'WH-HACKED' })).toEqual(['property code should not exist']);
  });

  it('RQ3: a PATCH with only the allowed fields passes the pipe', async () => {
    await expect(patch({ name: 'Main renamed', location: 'CNX', lengthCm: 3000, widthCm: 1500, usableAreaPct: 60 }))
      .resolves.toMatchObject({ name: 'Main renamed', location: 'CNX', lengthCm: 3000, widthCm: 1500, usableAreaPct: 60 });
    await expect(patch({})).resolves.toEqual({});
  });
});

describe('RQ3 — a retired warehouse keeps its code taken', () => {
  it('RQ3: the code of a deactivated warehouse is never handed out again', async () => {
    const retired = { ...WH, code: 'WH-REBORN-001', isActive: false };
    const { prisma, svc } = makePrisma(retired, retired, ['WH-REBORN-001']);

    const wh = await svc.createWarehouse({ name: 'Reborn' } as CreateWarehouseDto, 'u1');

    // The code query must not narrow by isActive / isDeleted, or a retired code
    // would come back up for grabs.
    expect(prisma.warehouse.findMany.mock.calls[0][0]).toEqual({ select: { code: true } });
    expect(wh.code).toBe('WH-REBORN-002');
  });

  it('RQ3: a soft-deleted warehouse keeps its code taken too', async () => {
    const removed = { ...WH, code: 'WH-REBORN-001', isActive: false, isDeleted: true };
    const { svc } = makePrisma(removed, removed, ['WH-REBORN-001']);

    const wh = await svc.createWarehouse({ name: 'Reborn' } as CreateWarehouseDto, 'u1');

    expect(wh.code).toBe('WH-REBORN-002');
  });

  it('RQ3: retiring a warehouse leaves the row (and its code) in place — it is not deleted', async () => {
    const { prisma, svc } = makePrisma(null, WH);

    const after = await svc.deactivateWarehouse('w1', 'u1');

    expect(after.code).toBe('WH-MAIN');
    expect(after.isActive).toBe(false);
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('WAREHOUSE_DEACTIVATED');
  });
});
