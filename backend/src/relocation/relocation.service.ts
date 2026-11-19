import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RelocationStatus,
  SlotStatus,
  StockStatus,
} from '@prisma/client';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { assertNotCountLocked, countLocks } from '../common/count-lock';
import { assertNotSelfApproval } from '../common/separation-of-duties';
import {
  FINAL_STATUSES,
  ISSUED_STATUSES,
  ON_HAND_UNCOMMITTED,
  resolveLocation,
  splitStockRow,
} from '../common/stock-state';
import {
  ScopePrincipal,
  assertWarehouseAccess,
  warehouseFilter,
} from '../common/warehouse-scope';
import { ACCESS, AccessPrincipal, hasAccess } from '../auth/access';
import {
  SlotSpace,
  loadSlotSpace,
  maxMovable,
  reserve,
} from './slot-space';

/**
 * PR7 Location Relocation Request — move stock between slots of ONE warehouse.
 *
 *   PENDING_APPROVAL ──approve──▶ APPROVED ──complete──▶ COMPLETED
 *          │ reject / cancel          │ cancel
 *          ▼                          ▼
 *     REJECTED / CANCELLED        CANCELLED
 *
 * Stock changes only on COMPLETE (staff confirm the goods were moved), inside one
 * transaction that re-checks every line. Decisions (11 Nov 2026):
 *   • rows on hand and not committed (ON_HAND_UNCOMMITTED) — reserved / picking /
 *     packed / shipped stock is never moved here, so pick tasks keep their stock
 *   • same warehouse only · maker ≠ checker (no exception, as everywhere else)
 *   • blocked / inactive slot → refused
 *
 * Requirement 32 (19 Nov 2026) changed how the destination is handled. A slot
 * has two ceilings, kept apart on purpose (see slot-space.ts): PLACES, which is
 * `Slot.capacity` and counts stock rows, and PIECES, which is the new
 * `Slot.maxQuantity`. Neither is guessed from the other.
 *   • raising a request → a destination that can take no more PIECES is
 *     REFUSED, and so is a quantity above what it can still take. The form
 *     lists only slots that can take the row, so nobody picks a dead end.
 *     Running out of PLACES (`Slot.capacity`) only warns — slot-space.ts says
 *     why that figure cannot be trusted to bar anything.
 *   • approving / completing one → still a WARNING, never a refusal. The room
 *     may have gone while the paper was in the tray, and trapping goods that
 *     have already been carried across the floor helps nobody; the approver is
 *     told, and decides.
 *   • part of a row → the row splits (splitStockRow); serial rows move whole
 */

const OPEN: RelocationStatus[] = [
  RelocationStatus.PENDING_APPROVAL,
  RelocationStatus.APPROVED,
];
/** Rows that take a place in a slot (for the capacity warning). */
const GONE: StockStatus[] = [...FINAL_STATUSES, ...ISSUED_STATUSES];
const MAX_LINES = 50;

export interface RelocationLineInput {
  stockItemId: string;
  toSlotId: string;
  quantity: number;
}
export interface CreateRelocationInput {
  warehouseId: string;
  reason?: string;
  lines: RelocationLineInput[];
}
export type Principal = ScopePrincipal & AccessPrincipal & { id: string };

export type RelocationWarning =
  | {
      kind: 'OVER_CAPACITY'; // more rows than the slot has places
      slotId: string;
      slotCode: string;
      rows: number;
      capacity: number;
    }
  | {
      kind: 'OVER_QUANTITY'; // more pieces than the slot's ceiling
      slotId: string;
      slotCode: string;
      pieces: number;
      maxQuantity: number;
    }
  | {
      kind: 'SLOT_MARKED';
      slotId: string;
      slotCode: string;
      status: SlotStatus;
    }
  | { kind: 'COUNT_LOCKED'; stockItemId: string; countRef: string };

const DETAIL = {
  warehouse: { select: { id: true, code: true, name: true } },
  requestedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  completedBy: { select: { id: true, fullName: true } },
  lines: {
    orderBy: { id: 'asc' },
    include: {
      product: { select: { id: true, code: true, name: true, unit: true } },
      stockItem: {
        select: {
          id: true,
          quantity: true,
          status: true,
          serialNumber: true,
          batchNumber: true,
          slotId: true,
        },
      },
      fromSlot: {
        select: {
          id: true,
          code: true,
          rack: { select: { id: true, code: true } },
        },
      },
      toSlot: {
        select: {
          id: true,
          code: true,
          status: true,
          capacity: true,
          maxQuantity: true,
          rack: { select: { id: true, code: true } },
        },
      },
    },
  },
} satisfies Prisma.RelocationRequestInclude;

@Injectable()
export class RelocationService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  private genRef() {
    return `RLC-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  async findAll(
    filter: {
      status?: RelocationStatus;
      warehouseId?: string;
      page?: number;
      limit?: number;
    },
    user?: Principal,
  ) {
    const page = Math.max(1, filter.page || 1),
      limit = Math.min(100, Math.max(1, filter.limit || 20));
    if (
      filter.status &&
      !Object.values(RelocationStatus).includes(filter.status)
    )
      throw new BadRequestException('Unknown status');
    const wh = warehouseFilter(user, filter.warehouseId);
    const where: Prisma.RelocationRequestWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(wh ? { warehouseId: wh } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.relocationRequest.findMany({
        where,
        include: DETAIL,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.relocationRequest.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, user?: Principal) {
    const r = await this.prisma.relocationRequest.findUnique({
      where: { id },
      include: DETAIL,
    });
    if (!r) throw new NotFoundException('Relocation request not found');
    assertWarehouseAccess(user, r.warehouseId, 'this relocation request');
    const review = OPEN.includes(r.status)
      ? await this.review(this.prisma, r)
      : { warnings: [] as RelocationWarning[], destinations: [] };
    return { ...r, ...review };
  }

  /** Stock rows in a slot that may be relocated, with any open request / count holding them. */
  async movable(warehouseId: string, slotId: string, user?: Principal) {
    if (!warehouseId || !slotId)
      throw new BadRequestException('warehouseId and slotId are required');
    assertWarehouseAccess(user, warehouseId, 'this warehouse');
    const rows = await this.prisma.stockItem.findMany({
      where: { warehouseId, slotId, status: { in: ON_HAND_UNCOMMITTED } },
      select: {
        id: true,
        quantity: true,
        status: true,
        serialNumber: true,
        batchNumber: true,
        product: { select: { id: true, code: true, name: true, unit: true } },
      },
      orderBy: [{ product: { code: 'asc' } }, { id: 'asc' }],
      take: 500,
    });
    const ids = rows.map((r) => r.id);
    const [open, locks] = await Promise.all([
      this.prisma.relocationLine.findMany({
        where: { stockItemId: { in: ids }, request: { status: { in: OPEN } } },
        select: { stockItemId: true, request: { select: { refNumber: true } } },
      }),
      countLocks(this.prisma, ids),
    ]);
    const openOf = new Map(
      open.map((o) => [o.stockItemId, o.request.refNumber]),
    );
    return rows.map((r) => ({
      ...r,
      openRelocation: openOf.get(r.id) ?? null,
      countRef: locks.get(r.id) ?? null,
    }));
  }

  /**
   * Requirement 32 step 3 — the slots that can take this stock row, each with
   * the room it has left and the most that may go into it.
   *
   * Full, blocked and retired slots are left OUT rather than offered and then
   * refused, which is what the requirement asks for. `hidden` says how many were
   * left out, so the screen can account for them instead of a short list looking
   * like a missing warehouse.
   */
  async destinations(warehouseId: string, stockItemId: string, user?: Principal) {
    if (!warehouseId || !stockItemId)
      throw new BadRequestException('warehouseId and stockItemId are required');
    assertWarehouseAccess(user, warehouseId, 'this warehouse');
    const row = await this.prisma.stockItem.findUnique({
      where: { id: stockItemId },
      select: {
        id: true,
        warehouseId: true,
        slotId: true,
        quantity: true,
        status: true,
        serialNumber: true,
        product: { select: { id: true, code: true, name: true, unit: true } },
        slot: { select: { id: true, code: true } },
      },
    });
    if (!row) throw new NotFoundException('Stock row not found');
    if (row.warehouseId !== warehouseId)
      throw new BadRequestException('That stock row is not in this warehouse');

    const space = await loadSlotSpace(this.prisma, { warehouseId });
    const candidates = [...space.values()].filter(
      (sp) => sp.slotId !== row.slotId,
    );
    const quantity = Number(row.quantity);
    const usable = candidates
      .filter((sp) => !sp.unavailable)
      .map((sp) => ({ ...sp, maxMovable: maxMovable(sp, quantity) }))
      .filter((sp) => sp.maxMovable > 0)
      // Somewhere with a place free first; one at its place limit still works,
      // but the person should have to reach past the roomier ones for it.
      .sort((a, b) => Number(a.atPlaceLimit) - Number(b.atPlaceLimit));
    return {
      row: {
        id: row.id,
        quantity,
        status: row.status,
        serialNumber: row.serialNumber,
        product: row.product,
        slot: row.slot,
      },
      slots: usable,
      hidden: candidates.length - usable.length,
    };
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(input: CreateRelocationInput, user: Principal) {
    const warehouseId =
      typeof input?.warehouseId === 'string' ? input.warehouseId : '';
    if (!warehouseId) throw new BadRequestException('warehouseId is required');
    assertWarehouseAccess(user, warehouseId, 'this warehouse');
    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (!lines.length) throw new BadRequestException('Add at least one line');
    if (lines.length > MAX_LINES)
      throw new BadRequestException(`At most ${MAX_LINES} lines per request`);
    const ids = lines.map((l) => l?.stockItemId);
    if (ids.some((x) => typeof x !== 'string' || !x))
      throw new BadRequestException('Every line needs a stock row');
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'A stock row can appear only once per request',
      );
    const reason =
      typeof input.reason === 'string'
        ? input.reason.trim().slice(0, 500) || null
        : null;

    const created = await this.prisma.$transaction(async (tx) => {
      // Lock the rows (stable order) so two requests for the same row cannot both open.
      const sorted = [...ids].sort();
      await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" = ANY(${sorted}::text[]) ORDER BY "id" FOR UPDATE`;
      const rows = await tx.stockItem.findMany({ where: { id: { in: ids } } });
      const rowOf = new Map(rows.map((r) => [r.id, r]));

      const open = await tx.relocationLine.findFirst({
        where: { stockItemId: { in: ids }, request: { status: { in: OPEN } } },
        select: { stockItemId: true, request: { select: { refNumber: true } } },
      });
      if (open)
        throw new ConflictException(
          `Stock row ${open.stockItemId} is already in open relocation ${open.request.refNumber}`,
        );

      // Requirement 32 — the room left in every destination this request names,
      // read once. Each line then takes its share, so two lines of the same
      // request cannot both be told the last place is free.
      const space = await loadSlotSpace(tx, {
        warehouseId,
        slotIds: [
          ...new Set(
            lines
              .map((l) => l?.toSlotId)
              .filter((x): x is string => typeof x === 'string' && !!x),
          ),
        ],
      });

      const data: Prisma.RelocationLineCreateManyRequestInput[] = [];
      for (const l of lines) {
        const row = rowOf.get(l.stockItemId);
        if (!row)
          throw new NotFoundException(`Stock row ${l.stockItemId} not found`);
        this.checkRow(row, warehouseId, Number(l.quantity));
        const dest = await this.destination(tx, warehouseId, l.toSlotId);
        if (dest.slotId === row.slotId)
          throw new BadRequestException(
            `Stock row ${row.id} is already in that slot`,
          );
        const fits = space.get(dest.slotId);
        if (!fits) throw new NotFoundException('Destination slot not found');
        this.assertFits(fits, Number(l.quantity));
        space.set(dest.slotId, reserve(fits, Number(l.quantity)));
        data.push({
          stockItemId: row.id,
          productId: row.productId,
          fromSlotId: row.slotId!,
          toSlotId: dest.slotId,
          quantity: Number(l.quantity),
        });
      }

      const req = await tx.relocationRequest.create({
        data: {
          refNumber: this.genRef(),
          warehouseId,
          reason,
          requestedById: user.id,
          lines: { createMany: { data } },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'RELOCATION_REQUESTED',
          entityType: 'RelocationRequest',
          entityId: req.id,
          detail: `${req.refNumber} · ${data.length} line(s)${reason ? ` · ${reason}` : ''}`,
        },
      });
      return req;
    });
    return this.findOne(created.id, user);
  }

  // ─── Decide ────────────────────────────────────────────────────────────────

  async approve(id: string, user: Principal) {
    const r = await this.load(id, user);
    if (r.status !== RelocationStatus.PENDING_APPROVAL)
      throw new BadRequestException(
        `Cannot approve a request that is ${r.status}`,
      );
    assertNotSelfApproval(user.id, [r.requestedById], 'a relocation request');
    await this.claim(
      r,
      RelocationStatus.APPROVED,
      user.id,
      { approvedById: user.id, approvedAt: new Date() },
      'RELOCATION_APPROVED',
    );
    return this.findOne(id, user);
  }

  async reject(id: string, reason: string | undefined, user: Principal) {
    const r = await this.load(id, user);
    if (r.status !== RelocationStatus.PENDING_APPROVAL)
      throw new BadRequestException(
        `Cannot reject a request that is ${r.status}`,
      );
    const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    if (!why) throw new BadRequestException('Give a reason for rejecting');
    await this.claim(
      r,
      RelocationStatus.REJECTED,
      user.id,
      { approvedById: user.id, approvedAt: new Date(), rejectReason: why },
      'RELOCATION_REJECTED',
      why,
    );
    return this.findOne(id, user);
  }

  /** The requester may cancel their own request; an approver may cancel any open one. */
  async cancel(id: string, user: Principal) {
    const r = await this.load(id, user);
    if (!OPEN.includes(r.status))
      throw new BadRequestException(
        `Cannot cancel a request that is ${r.status}`,
      );
    if (
      r.requestedById !== user.id &&
      !hasAccess(user, ACCESS.relocationApprove)
    ) {
      throw new ForbiddenException(
        'Only the requester or an approver can cancel this request',
      );
    }
    await this.claim(
      r,
      RelocationStatus.CANCELLED,
      user.id,
      { cancelledAt: new Date() },
      'RELOCATION_CANCELLED',
    );
    return this.findOne(id, user);
  }

  // ─── Complete: the only step that moves stock ──────────────────────────────

  async complete(id: string, user: Principal) {
    const r = await this.load(id, user);
    if (r.status !== RelocationStatus.APPROVED)
      throw new BadRequestException(
        `Only an approved request can be completed (this one is ${r.status})`,
      );

    await this.prisma.$transaction(async (tx) => {
      // Claim first: a double click cannot move the stock twice.
      const claimed = await tx.relocationRequest.updateMany({
        where: { id, status: RelocationStatus.APPROVED },
        data: {
          status: RelocationStatus.COMPLETED,
          completedById: user.id,
          completedAt: new Date(),
        },
      });
      if (claimed.count === 0)
        throw new ConflictException(
          'Relocation request was changed by someone else — reload and retry',
        );

      const lines = await tx.relocationLine.findMany({
        where: { requestId: id },
        orderBy: { stockItemId: 'asc' },
      });
      const ids = lines.map((l) => l.stockItemId);
      await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
      await assertNotCountLocked(tx, ids);

      for (const l of lines) {
        const row = await tx.stockItem.findUnique({
          where: { id: l.stockItemId },
        });
        if (!row)
          throw new NotFoundException(`Stock row ${l.stockItemId} not found`);
        if (row.slotId !== l.fromSlotId)
          throw new ConflictException(
            `Stock row ${row.id} is no longer in its source slot — cancel this request and raise a new one`,
          );
        this.checkRow(row, r.warehouseId, l.quantity);
        const dest = await this.destination(tx, r.warehouseId, l.toSlotId);

        // Part of the row: the row keeps exactly the moved quantity (and its id and
        // history); the rest stays in the source slot as a new row, same status.
        const remainderId =
          l.quantity < row.quantity
            ? await splitStockRow(tx, row.id, l.quantity, row.status)
            : null;
        const moved = await tx.stockItem.updateMany({
          where: {
            id: row.id,
            slotId: l.fromSlotId,
            status: { in: ON_HAND_UNCOMMITTED },
          },
          data: { slotId: dest.slotId, rackId: dest.rackId },
        });
        if (moved.count !== 1)
          throw new ConflictException(
            `Stock row ${row.id} changed while moving — reload and retry`,
          );
        if (remainderId)
          await tx.relocationLine.update({
            where: { id: l.id },
            data: { remainderStockItemId: remainderId },
          });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'STOCK_RELOCATED',
            entityType: 'StockItem',
            entityId: row.id,
            detail: `${r.refNumber}: ${l.quantity} moved${remainderId ? ` (rest stays as ${remainderId})` : ''}`,
            changes: {
              slotId: { from: l.fromSlotId, to: dest.slotId },
              rackId: { from: row.rackId, to: dest.rackId },
            },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'RELOCATION_COMPLETED',
          entityType: 'RelocationRequest',
          entityId: id,
          detail: `${r.refNumber} · ${lines.length} line(s) moved`,
          changes: {
            status: {
              from: RelocationStatus.APPROVED,
              to: RelocationStatus.COMPLETED,
            },
          },
        },
      });
    });
    this.realtime.emitInventoryUpdate({
      action: 'relocated',
      warehouseId: r.warehouseId,
      refNumber: r.refNumber,
    });
    return this.findOne(id, user);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async load(id: string, user: Principal) {
    const r = await this.prisma.relocationRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Relocation request not found');
    assertWarehouseAccess(user, r.warehouseId, 'this relocation request');
    return r;
  }

  /** Status change guarded by the status we read (a concurrent change makes it fail). */
  private async claim(
    r: { id: string; refNumber: string; status: RelocationStatus },
    to: RelocationStatus,
    actorId: string,
    extra: Prisma.RelocationRequestUncheckedUpdateManyInput,
    action: string,
    note?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.relocationRequest.updateMany({
        where: { id: r.id, status: r.status },
        data: { ...extra, status: to },
      });
      if (res.count === 0)
        throw new ConflictException(
          'Relocation request was changed by someone else — reload and retry',
        );
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action,
          entityType: 'RelocationRequest',
          entityId: r.id,
          detail: `${r.refNumber}: ${r.status} → ${to}${note ? ` · ${note}` : ''}`,
          changes: { status: { from: r.status, to } },
        },
      });
    });
  }

  /** A row this document may move: same warehouse, in a slot, on hand and not committed, enough quantity. */
  private checkRow(
    row: {
      id: string;
      warehouseId: string | null;
      slotId: string | null;
      status: StockStatus;
      quantity: number;
      serialNumber: string | null;
    },
    warehouseId: string,
    qty: number,
  ) {
    if (row.warehouseId !== warehouseId)
      throw new BadRequestException(
        `Stock row ${row.id} is not in this warehouse`,
      );
    if (!row.slotId)
      throw new BadRequestException(`Stock row ${row.id} is not in a slot`);
    if (!ON_HAND_UNCOMMITTED.includes(row.status))
      throw new ConflictException(
        `Stock row ${row.id} is ${row.status} and cannot be relocated`,
      );
    if (!Number.isFinite(qty) || qty <= 0)
      throw new BadRequestException('Quantity must be more than 0');
    if (qty > row.quantity)
      throw new ConflictException(
        `Stock row ${row.id} holds only ${row.quantity}`,
      );
    if (row.serialNumber && qty !== row.quantity)
      throw new BadRequestException(
        `Stock row ${row.id} has a serial number and moves whole`,
      );
  }

  /**
   * Requirement 32 steps 3 and 4 — a destination that cannot take this much is
   * refused while the request is being raised.
   *
   * The messages name no slot and carry no figures, so the client can translate
   * them: the form is showing the slot it is adding and the most it may send, so
   * repeating either here would only be harder to read in Thai.
   */
  private assertFits(space: SlotSpace, qty: number) {
    switch (space.unavailable) {
      case 'BLOCKED':
        throw new BadRequestException('That destination is blocked');
      case 'INACTIVE':
        throw new BadRequestException('That destination is no longer in use');
      case 'NO_PIECES':
        throw new ConflictException(
          'That destination has no room left for more pieces',
        );
    }
    if (qty > maxMovable(space, qty))
      throw new ConflictException('That destination cannot take this quantity');
  }

  /** Destination slot: active, in this warehouse, not blocked. */
  private async destination(
    db: Prisma.TransactionClient,
    warehouseId: string,
    slotId: string,
  ) {
    if (typeof slotId !== 'string' || !slotId)
      throw new BadRequestException('Choose a destination slot');
    const loc = await resolveLocation(db, { warehouseId, slotId });
    const slot = await db.slot.findUnique({
      where: { id: slotId },
      select: { status: true, code: true },
    });
    if (slot?.status === SlotStatus.BLOCKED)
      throw new BadRequestException(`Slot ${slot.code} is blocked`);
    return { slotId: loc.slotId!, rackId: loc.rackId! };
  }

  /**
   * What the review before approval shows, and what it warns about. Nothing here
   * refuses anything — see the note at the top of this file.
   */
  private async review(
    db: Prisma.TransactionClient | PrismaService,
    r: {
      id: string;
      warehouseId: string;
      lines: { stockItemId: string; toSlotId: string; quantity: number }[];
    },
  ) {
    const slotIds = [...new Set(r.lines.map((l) => l.toSlotId))];
    const [space, locks] = await Promise.all([
      loadSlotSpace(db as Prisma.TransactionClient, {
        warehouseId: r.warehouseId,
        slotIds,
        // This request's own lines are shown on their own below, so they must
        // not also be counted as room someone else has promised away.
        exceptRequestId: r.id,
      }),
      countLocks(
        db,
        r.lines.map((l) => l.stockItemId),
      ),
    ]);

    // What this request itself is sending to each slot.
    const incoming = new Map<string, { places: number; pieces: number }>();
    for (const l of r.lines) {
      const at = incoming.get(l.toSlotId) ?? { places: 0, pieces: 0 };
      at.places += 1;
      at.pieces += Number(l.quantity);
      incoming.set(l.toSlotId, at);
    }

    const left = (free: number | null, taken: number) =>
      free === null ? null : free - taken;

    const destinations = slotIds.map((slotId) => {
      const sp = space.get(slotId);
      const inc = incoming.get(slotId) ?? { places: 0, pieces: 0 };
      return {
        slotId,
        slotCode: sp?.code ?? '',
        rackCode: sp?.rackCode ?? '',
        status: sp?.status ?? null,
        capacity: sp?.capacity ?? 0,
        maxQuantity: sp?.maxQuantity ?? null,
        placesUsed: sp?.placesUsed ?? 0,
        piecesOnHand: sp?.piecesOnHand ?? 0,
        // Room before this request is carried out…
        placesFree: sp?.placesFree ?? null,
        piecesFree: sp?.piecesFree ?? null,
        incomingPlaces: inc.places,
        incomingPieces: inc.pieces,
        // …and after. Negative means it will not fit; the warnings say so too.
        placesLeft: left(sp?.placesFree ?? null, inc.places),
        piecesLeft: left(sp?.piecesFree ?? null, inc.pieces),
      };
    });

    const warnings: RelocationWarning[] = [];
    for (const d of destinations) {
      if (d.placesLeft !== null && d.placesLeft < 0)
        warnings.push({
          kind: 'OVER_CAPACITY',
          slotId: d.slotId,
          slotCode: d.slotCode,
          rows: d.placesUsed + d.incomingPlaces,
          capacity: d.capacity,
        });
      if (d.piecesLeft !== null && d.piecesLeft < 0)
        warnings.push({
          kind: 'OVER_QUANTITY',
          slotId: d.slotId,
          slotCode: d.slotCode,
          pieces: d.piecesOnHand + d.incomingPieces,
          maxQuantity: d.maxQuantity ?? 0,
        });
      if (
        d.status === SlotStatus.RESERVED ||
        d.status === SlotStatus.QUARANTINE ||
        d.status === SlotStatus.RTV
      ) {
        warnings.push({
          kind: 'SLOT_MARKED',
          slotId: d.slotId,
          slotCode: d.slotCode,
          status: d.status,
        });
      }
    }
    for (const [stockItemId, countRef] of locks)
      warnings.push({ kind: 'COUNT_LOCKED', stockItemId, countRef });

    return { warnings, destinations };
  }
}
