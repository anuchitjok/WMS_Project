import { Prisma, RelocationStatus, SlotStatus, StockStatus } from '@prisma/client';
import { FINAL_STATUSES, ISSUED_STATUSES } from '../common/stock-state';

/**
 * Requirement 32, step 3 — how much room a slot really has.
 *
 * A slot has TWO independent ceilings, and the difference matters:
 *
 *   places  (`Slot.capacity`)    how many stock rows / pallets it holds.
 *                                0 means nobody entered a figure → not limited.
 *   pieces  (`Slot.maxQuantity`) how many pieces it holds in total (migration 41).
 *                                NULL means nobody entered a figure → not limited.
 *
 * Both are counted against what is on hand now PLUS what open relocation
 * requests have already promised to put there, so two requests cannot each be
 * told there is room for the same pallet.
 */

/** Rows that no longer take up room in a slot. */
const GONE: StockStatus[] = [...FINAL_STATUSES, ...ISSUED_STATUSES];
const OPEN: RelocationStatus[] = [
  RelocationStatus.PENDING_APPROVAL,
  RelocationStatus.APPROVED,
];

/**
 * Why a slot cannot be chosen at all. `null` = it can.
 *
 * Note what is NOT here: running out of PLACES. `Slot.capacity` is NOT NULL with
 * a default of 1, and the slot generator fills it from a rack template, so a 1
 * there means "nobody has said" at least as often as it means "one pallet". The
 * live data shows it plainly: slots that say 1 are holding three or four rows,
 * put there by putaway, which never checked the figure either. Barring a
 * destination on that figure would hide nearly every location in the warehouse
 * and make relocation the only screen that refuses what putaway allows.
 *
 * So the places figure WARNS (`atPlaceLimit`, and OVER_CAPACITY on the request)
 * and the piece ceiling BARS. The piece ceiling is nullable, so a figure there
 * was typed by someone on purpose — which is the whole difference.
 */
export type SlotUnavailable =
  | 'BLOCKED' // marked blocked by hand
  | 'INACTIVE' // retired or soft-deleted
  | 'NO_PIECES'; // the piece ceiling is reached

export interface SlotSpace {
  slotId: string;
  code: string;
  rackCode: string;
  status: SlotStatus;
  /** Places configured; 0 = not limited. */
  capacity: number;
  placesUsed: number;
  /** Places promised by open requests. */
  placesHeld: number;
  /** `null` = not limited. */
  placesFree: number | null;
  /** No place left by the `capacity` figure. A warning, never a bar — see above. */
  atPlaceLimit: boolean;
  /** Piece ceiling; `null` = not limited. */
  maxQuantity: number | null;
  piecesOnHand: number;
  /** Pieces promised by open requests. */
  piecesHeld: number;
  /** `null` = not limited. */
  piecesFree: number | null;
  unavailable: SlotUnavailable | null;
}

export interface SlotRow {
  id: string;
  code: string;
  status: SlotStatus;
  capacity: number;
  maxQuantity: number | null;
  isActive: boolean;
  isDeleted: boolean;
  rack?: { code: string } | null;
}

const free = (limit: number | null, taken: number) =>
  limit === null ? null : Math.max(0, limit - taken);

/** Pure: turn one slot plus its tallies into the room it has left. */
export function slotSpace(
  slot: SlotRow,
  used: { places: number; pieces: number },
  held: { places: number; pieces: number },
): SlotSpace {
  const placesFree = free(
    slot.capacity > 0 ? slot.capacity : null,
    used.places + held.places,
  );
  const piecesFree = free(
    slot.maxQuantity !== null && slot.maxQuantity >= 0 ? slot.maxQuantity : null,
    used.pieces + held.pieces,
  );
  const unavailable: SlotUnavailable | null =
    slot.status === SlotStatus.BLOCKED
      ? 'BLOCKED'
      : !slot.isActive || slot.isDeleted
        ? 'INACTIVE'
        : piecesFree === 0
          ? 'NO_PIECES'
          : null;
  return {
    slotId: slot.id,
    code: slot.code,
    rackCode: slot.rack?.code ?? '',
    status: slot.status,
    capacity: slot.capacity,
    placesUsed: used.places,
    placesHeld: held.places,
    placesFree,
    atPlaceLimit: placesFree === 0,
    maxQuantity: slot.maxQuantity,
    piecesOnHand: used.pieces,
    piecesHeld: held.pieces,
    piecesFree,
    unavailable,
  };
}

/**
 * The most that may be moved into this slot from one stock row: the row's own
 * quantity, unless the piece ceiling allows less. A row always needs one free
 * place, whether it moves whole or in part, because the moved quantity lands as
 * a row of its own.
 */
export function maxMovable(space: SlotSpace, rowQuantity: number): number {
  if (space.unavailable) return 0;
  return space.piecesFree === null
    ? rowQuantity
    : Math.min(rowQuantity, space.piecesFree);
}

/** Take one line's room out of a slot, so the next line of the same request sees it. */
export function reserve(space: SlotSpace, quantity: number): SlotSpace {
  return slotSpace(
    {
      id: space.slotId,
      code: space.code,
      status: space.status,
      capacity: space.capacity,
      maxQuantity: space.maxQuantity,
      isActive: space.unavailable !== 'INACTIVE',
      isDeleted: false,
      rack: { code: space.rackCode },
    },
    { places: space.placesUsed, pieces: space.piecesOnHand },
    {
      places: space.placesHeld + 1,
      pieces: space.piecesHeld + quantity,
    },
  );
}

type Db = Prisma.TransactionClient;

/**
 * Reads the room left in the given slots (or in every slot of the warehouse).
 * `exceptRequestId` leaves one request's own lines out of the promised figures,
 * which is what the review of that request needs — its lines are shown on their
 * own rather than counted against it twice.
 */
export async function loadSlotSpace(
  db: Db,
  opts: {
    warehouseId: string;
    slotIds?: string[];
    exceptRequestId?: string;
  },
): Promise<Map<string, SlotSpace>> {
  const where: Prisma.SlotWhereInput = opts.slotIds
    ? { id: { in: opts.slotIds } }
    : { isDeleted: false, rack: { warehouseId: opts.warehouseId, isDeleted: false } };
  const slots = await db.slot.findMany({
    where,
    select: {
      id: true,
      code: true,
      status: true,
      capacity: true,
      maxQuantity: true,
      isActive: true,
      isDeleted: true,
      rack: { select: { code: true } },
    },
    orderBy: [{ rack: { code: 'asc' } }, { code: 'asc' }],
    take: 2000,
  });
  const ids = slots.map((s) => s.id);
  if (!ids.length) return new Map();

  const [onHand, promised] = await Promise.all([
    db.stockItem.groupBy({
      by: ['slotId'],
      where: { slotId: { in: ids }, status: { notIn: GONE } },
      _count: { _all: true },
      _sum: { quantity: true },
    }),
    db.relocationLine.findMany({
      where: {
        toSlotId: { in: ids },
        request: {
          status: { in: OPEN },
          ...(opts.exceptRequestId ? { id: { not: opts.exceptRequestId } } : {}),
        },
      },
      select: { toSlotId: true, quantity: true },
    }),
  ]);

  const used = new Map<string, { places: number; pieces: number }>();
  for (const g of onHand)
    if (g.slotId)
      used.set(g.slotId, {
        places: g._count._all,
        pieces: Number(g._sum.quantity ?? 0),
      });
  const held = new Map<string, { places: number; pieces: number }>();
  for (const l of promised) {
    const at = held.get(l.toSlotId) ?? { places: 0, pieces: 0 };
    at.places += 1;
    at.pieces += Number(l.quantity);
    held.set(l.toSlotId, at);
  }

  const out = new Map<string, SlotSpace>();
  for (const s of slots)
    out.set(
      s.id,
      slotSpace(
        s,
        used.get(s.id) ?? { places: 0, pieces: 0 },
        held.get(s.id) ?? { places: 0, pieces: 0 },
      ),
    );
  return out;
}
