import { BadRequestException } from '@nestjs/common';

/**
 * RQ7 / decision C3 — the one size rule: a rack's size and grid belong to its
 * Rack Type. A rack that has, or is being given, a `rackTypeId` may not carry
 * length, width, height, levels or columns of its own; to change them you change
 * the Rack Type. Legacy racks with no Rack Type keep their own values — migrating
 * them is a later phase.
 *
 * This lives in common/ because BOTH rack write paths have to obey it:
 *   - POST/PATCH /warehouse-master/racks  (warehouse-master.service.ts)
 *   - POST/PATCH /warehouse/racks         (warehouse.service.ts, the older route
 *     the Warehouse Layout control centre still calls)
 * One rule, one copy. Two copies that have to agree is exactly how this rule came
 * to be bypassable from one of the two screens — do not inline it again.
 *
 * It imports nothing from either module, so neither import can become circular.
 */

/** The error code both routes return, so the UI can recognise this one rule anywhere. */
export const RACK_SIZE_FROM_TYPE = 'RACK_SIZE_FROM_TYPE';

/** The five fields a Rack Type owns. */
export const RACK_TYPE_OWNED = ['lengthCm', 'widthCm', 'heightCm', 'levels', 'columns'] as const;
export type RackTypeOwnedField = (typeof RACK_TYPE_OWNED)[number];

/** Wording the user sees, not the column name. */
const LABEL: Record<RackTypeOwnedField, string> = {
  lengthCm: 'length', widthCm: 'width', heightCm: 'height', levels: 'levels', columns: 'columns',
};

/** Any rack create/update payload, from either route. Every field is optional. */
export type RackSizeInput = Partial<Record<RackTypeOwnedField, number | null>> & { rackTypeId?: string | null };

/**
 * Refuses a payload that sets a Rack-Type-owned field on a rack that follows a
 * Rack Type. `current` is the rack as it is stored now (omit it on create).
 *
 * Clearing a field with an explicit null is allowed: that moves the rack towards
 * the rule, not away from it. Likewise a payload that drops the Rack Type
 * (`rackTypeId: null`) in the same call may set the rack's own size again.
 */
export function assertRackSizeFromType(dto: RackSizeInput, current?: { rackTypeId?: string | null } | null): void {
  const typeId = dto.rackTypeId !== undefined ? dto.rackTypeId || null : current?.rackTypeId ?? null;
  if (!typeId) return; // no Rack Type: the rack keeps its own size, exactly as before
  const set = RACK_TYPE_OWNED.filter((k) => dto[k] !== undefined && dto[k] !== null);
  if (!set.length) return;
  const fields = set.map((k) => LABEL[k]).join(', ');
  throw new BadRequestException({
    code: RACK_SIZE_FROM_TYPE,
    message: `This rack takes its size from its Rack Type, so ${fields} cannot be set on the rack. Change the Rack Type instead.`,
  });
}
