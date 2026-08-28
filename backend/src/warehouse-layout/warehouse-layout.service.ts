import {
  Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { StockStatus, LayoutObjectType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLayoutDto, UpdateLayoutCanvasDto, CreateLayoutObjectDto, UpdateLayoutObjectDto,
  BatchSaveDto, DuplicateObjectDto,
} from './dto/layout.dto';

// Physical Layout is the *drawing* of the warehouse floor. It never owns
// inventory and never writes Warehouse / Rack / Slot / StockItem — this service
// reads those tables only to validate that a layout's warehouse exists.
// Linking an object to a WMS Slot/Rack is Sprint 6.

const MAX_TREE_DEPTH = 64; // cycle/runaway guard for parent-chain walks

// Stock that has left the building is not occupying a bin. Matches the set used
// by warehouse.service.inventoryByBrand so both surfaces agree.
const GONE: StockStatus[] = [
  StockStatus.SHIPPED, StockStatus.CLOSED, StockStatus.CANCELLED, StockStatus.CONSUMED,
];
// There is no committedQty column anywhere in the schema — "committed" has to be
// derived by bucketing StockStatus. See the Sprint 1 blueprint.
const COMMITTED: StockStatus[] = [
  StockStatus.RESERVED, StockStatus.PICKING, StockStatus.PICKED,
  StockStatus.PACKED, StockStatus.READY_FOR_PICKUP,
];

// Which layout object types may hold a WMS link, and to what. Everything else is
// physical-only: an aisle or a QC bench has no logical counterpart.
const LINKABLE: Partial<Record<LayoutObjectType, 'slot' | 'rack'>> = {
  BIN: 'slot',
  RACK: 'rack',
};

// Per-user warehouse scope, taken from the JWT (UserWarehouse rows plus any
// warehouse-scoped role assignments — see jwt.strategy.ts).
export interface LayoutScope {
  roleKey?: string;
  warehouseIds?: string[];
}

@Injectable()
export class WarehouseLayoutService {
  constructor(private prisma: PrismaService) {}

  // Mirrors warehouse-master: detail carries a before/after pair.
  private audit(userId: string, action: string, entityType: string, entityId: string, before: any, after: any) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType, entityId, detail: JSON.stringify({ before, after }) },
    });
  }

  private assertValidJson(metadata: string | null | undefined, field = 'metadata') {
    if (metadata === undefined || metadata === null || metadata === '') return;
    try {
      JSON.parse(metadata);
    } catch {
      throw new BadRequestException(`${field} must be a valid JSON string`);
    }
  }

  // Warehouse scoping (Sprint 7).
  //
  // Semantics are copied verbatim from inventory.service.findAll, the only other
  // place this is enforced today: SUPER_ADMIN bypasses, and a user with NO
  // assigned warehouses is unrestricted. That second rule looks odd in isolation
  // but it is the existing house behaviour — tightening it here would silently
  // lock out every user who has no UserWarehouse row, which is most of them.
  private assertWarehouseInScope(warehouseId: string, scope?: LayoutScope) {
    if (!scope) return; // no scope supplied (internal call / tests) = unrestricted
    if (scope.roleKey === 'SUPER_ADMIN') return;
    const ids = scope.warehouseIds ?? [];
    if (ids.length === 0) return;
    if (!ids.includes(warehouseId)) {
      throw new ForbiddenException('You do not have access to this warehouse');
    }
  }

  // Object- and layout-addressed endpoints resolve up to the warehouse before
  // the scope check, so a scoped user cannot reach another warehouse's objects
  // by id.
  private async assertLayoutInScope(layoutId: string, scope?: LayoutScope) {
    if (!scope) return;
    this.assertWarehouseInScope(await this.warehouseIdOfLayout(layoutId), scope);
  }

  private async getLayoutOrThrow(layoutId: string) {
    const layout = await this.prisma.warehouseLayout.findFirst({ where: { id: layoutId, isDeleted: false } });
    if (!layout) throw new NotFoundException('Layout not found');
    return layout;
  }

  private async getObjectOrThrow(id: string) {
    const obj = await this.prisma.layoutObject.findFirst({ where: { id, isDeleted: false } });
    if (!obj) throw new NotFoundException('Layout object not found');
    return obj;
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  // Returns the canvas plus a FLAT array of objects; the client assembles the
  // tree. `layout: null` means this warehouse has no layout yet — that is a
  // normal first-visit state, not an error.
  async getByWarehouse(warehouseId: string, scope?: LayoutScope) {
    this.assertWarehouseInScope(warehouseId, scope);
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, isDeleted: false },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const layout = await this.prisma.warehouseLayout.findFirst({
      where: { warehouseId, isDeleted: false },
    });
    if (!layout) return { warehouse, layout: null, objects: [] };

    const objects = await this.prisma.layoutObject.findMany({
      where: { layoutId: layout.id, isDeleted: false },
      orderBy: [{ zIndex: 'asc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { warehouse, layout, objects };
  }

  // ── Layout (canvas) ─────────────────────────────────────────────────────────

  async createLayout(warehouseId: string, dto: CreateLayoutDto, userId: string, scope?: LayoutScope) {
    this.assertWarehouseInScope(warehouseId, scope);
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, isDeleted: false } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const existing = await this.prisma.warehouseLayout.findUnique({ where: { warehouseId } });
    if (existing && !existing.isDeleted) {
      throw new ConflictException('This warehouse already has a layout');
    }

    // A soft-deleted layout still holds the unique warehouseId, so revive it
    // rather than failing on the constraint.
    const layout = existing
      ? await this.prisma.warehouseLayout.update({
          where: { id: existing.id },
          data: { ...dto, isDeleted: false, deletedAt: null, deletedBy: null },
        })
      : await this.prisma.warehouseLayout.create({ data: { warehouseId, ...dto } });

    await this.audit(userId, 'LAYOUT_CREATED', 'WarehouseLayout', layout.id, existing ?? null, layout);
    return layout;
  }

  async updateCanvas(layoutId: string, dto: UpdateLayoutCanvasDto, userId: string, scope?: LayoutScope) {
    const before = await this.getLayoutOrThrow(layoutId);
    await this.assertLayoutInScope(layoutId, scope);
    const after = await this.prisma.warehouseLayout.update({ where: { id: layoutId }, data: { ...dto } });
    await this.audit(userId, 'LAYOUT_UPDATED', 'WarehouseLayout', layoutId, before, after);
    return after;
  }

  // ── Tree integrity helpers ──────────────────────────────────────────────────

  // Walk up from `startParentId`; if we reach `objectId`, the reassignment would
  // close a loop and orphan the subtree from the root.
  private async wouldCreateCycle(objectId: string, startParentId: string): Promise<boolean> {
    let cursor: string | null = startParentId;
    for (let depth = 0; cursor && depth < MAX_TREE_DEPTH; depth++) {
      if (cursor === objectId) return true;
      const parent = await this.prisma.layoutObject.findUnique({
        where: { id: cursor },
        select: { parentObjectId: true },
      });
      cursor = parent?.parentObjectId ?? null;
    }
    // Ran past the depth cap — treat as suspect rather than silently allowing it.
    return cursor !== null;
  }

  private async validateParent(parentObjectId: string, layoutId: string, selfId?: string) {
    const parent = await this.prisma.layoutObject.findFirst({
      where: { id: parentObjectId, isDeleted: false },
      select: { id: true, layoutId: true },
    });
    if (!parent) throw new NotFoundException('Parent object not found');
    if (parent.layoutId !== layoutId) {
      throw new ConflictException('Parent object belongs to a different layout');
    }
    if (selfId) {
      if (parentObjectId === selfId) throw new ConflictException('An object cannot be its own parent');
      if (await this.wouldCreateCycle(selfId, parentObjectId)) {
        throw new ConflictException('That parent is a descendant of this object — the move would create a cycle');
      }
    }
  }

  // Breadth-first collection of a subtree's ids (the root included).
  private async collectSubtree(rootId: string): Promise<string[]> {
    const ids = [rootId];
    let frontier = [rootId];
    for (let depth = 0; frontier.length && depth < MAX_TREE_DEPTH; depth++) {
      const children = await this.prisma.layoutObject.findMany({
        where: { parentObjectId: { in: frontier }, isDeleted: false },
        select: { id: true },
      });
      frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
      ids.push(...frontier);
    }
    return ids;
  }

  // ── Layout objects ──────────────────────────────────────────────────────────

  async createObject(layoutId: string, dto: CreateLayoutObjectDto, userId: string, scope?: LayoutScope) {
    const layout = await this.getLayoutOrThrow(layoutId);
    await this.assertLayoutInScope(layoutId, scope);
    this.assertValidJson(dto.metadata);
    if (dto.parentObjectId) await this.validateParent(dto.parentObjectId, layout.id);

    const [obj] = await this.prisma.$transaction([
      this.prisma.layoutObject.create({ data: { layoutId, ...dto } }),
      // Bump the canvas version so Sprint 5's batch save can detect concurrent edits.
      this.prisma.warehouseLayout.update({ where: { id: layoutId }, data: { version: { increment: 1 } } }),
    ]);

    await this.audit(userId, 'LAYOUT_OBJECT_CREATED', 'LayoutObject', obj.id, null, obj);
    return obj;
  }

  async updateObject(id: string, dto: UpdateLayoutObjectDto, userId: string, scope?: LayoutScope) {
    const before = await this.getObjectOrThrow(id);
    await this.assertLayoutInScope(before.layoutId, scope);
    this.assertValidJson(dto.metadata);

    if (dto.parentObjectId !== undefined && dto.parentObjectId !== null) {
      await this.validateParent(dto.parentObjectId, before.layoutId, id);
    }

    const [after] = await this.prisma.$transaction([
      this.prisma.layoutObject.update({ where: { id }, data: { ...dto } }),
      this.prisma.warehouseLayout.update({ where: { id: before.layoutId }, data: { version: { increment: 1 } } }),
    ]);

    await this.audit(userId, 'LAYOUT_OBJECT_UPDATED', 'LayoutObject', id, before, after);
    return after;
  }

  // Soft delete only — consistent with warehouse-master. A parent with live
  // children is refused unless `cascade` is set, so the tree can never be left
  // with dangling references.
  async deleteObject(id: string, cascade: boolean, userId: string, scope?: LayoutScope) {
    const before = await this.getObjectOrThrow(id);
    await this.assertLayoutInScope(before.layoutId, scope);

    const childCount = await this.prisma.layoutObject.count({
      where: { parentObjectId: id, isDeleted: false },
    });
    if (childCount > 0 && !cascade) {
      throw new ConflictException(
        `Cannot delete: ${childCount} child object(s) still exist. Re-send with ?cascade=true to remove them too.`,
      );
    }

    const ids = cascade ? await this.collectSubtree(id) : [id];
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.layoutObject.updateMany({
        where: { id: { in: ids } },
        data: { isDeleted: true, deletedAt: now, deletedBy: userId },
      }),
      this.prisma.warehouseLayout.update({ where: { id: before.layoutId }, data: { version: { increment: 1 } } }),
    ]);

    await this.audit(userId, 'LAYOUT_OBJECT_DELETED', 'LayoutObject', id, before, {
      isDeleted: true, deletedAt: now, deletedBy: userId, cascadedIds: ids,
    });
    return { success: true, deletedIds: ids };
  }

  // ─── Sprint 5: batch save ───────────────────────────────────────────────────
  // The editor's primary write: one transaction per flush, not per drag. The app
  // sits behind a global 100 req/min throttle, so a per-object API would be
  // exhausted in under a minute of editing.
  //
  // Optimistic locking: the client sends the version it last read. A mismatch
  // means someone else saved in between, so we refuse rather than clobber.
  async batchSave(layoutId: string, dto: BatchSaveDto, userId: string, scope?: LayoutScope) {
    const layout = await this.getLayoutOrThrow(layoutId);
    await this.assertLayoutInScope(layoutId, scope);
    if (layout.version !== dto.version) {
      throw new ConflictException(
        `This layout changed elsewhere (your version ${dto.version}, current ${layout.version}). Reload before saving.`,
      );
    }

    const upserts = dto.upserts ?? [];
    const deletes = dto.deletes ?? [];
    for (const u of upserts) this.assertValidJson(u.metadata, 'upserts[].metadata');

    // Every referenced id must already belong to this layout.
    const referenced = [...upserts.filter((u) => u.id).map((u) => u.id as string), ...deletes];
    if (referenced.length) {
      const owned = await this.prisma.layoutObject.findMany({
        where: { id: { in: referenced }, layoutId, isDeleted: false },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map((o) => o.id));
      const stray = referenced.find((rid) => !ownedIds.has(rid));
      if (stray) throw new NotFoundException(`Object ${stray} does not belong to this layout`);
    }

    // Deleting a parent removes its subtree, so the tree is never left with a
    // live object pointing at a dead parent.
    const deleteIds = new Set<string>();
    for (const did of deletes) (await this.collectSubtree(did)).forEach((d) => deleteIds.add(d));

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const created: string[] = [];
      for (const u of upserts) {
        if (u.id && deleteIds.has(u.id)) continue; // a delete in the same batch wins
        const { id: uid, ...data } = u;
        if (uid) {
          await tx.layoutObject.update({ where: { id: uid }, data });
        } else {
          const row = await tx.layoutObject.create({ data: { layoutId, ...data } });
          created.push(row.id);
        }
      }

      if (deleteIds.size) {
        await tx.layoutObject.updateMany({
          where: { id: { in: [...deleteIds] } },
          data: { isDeleted: true, deletedAt: now, deletedBy: userId },
        });
      }

      // Validate the RESULTING tree rather than each edit: a batch can move
      // several objects at once, and only the end state can be judged. Anything
      // wrong here rolls the whole flush back.
      const all = await tx.layoutObject.findMany({
        where: { layoutId, isDeleted: false },
        select: { id: true, parentObjectId: true },
      });
      const parentOf = new Map(all.map((o) => [o.id, o.parentObjectId]));
      for (const o of all) {
        if (o.parentObjectId && !parentOf.has(o.parentObjectId)) {
          throw new ConflictException(`Object ${o.id} references a parent outside this layout`);
        }
        let cursor = o.parentObjectId;
        for (let depth = 0; cursor; depth++) {
          if (cursor === o.id) throw new ConflictException(`Batch would create a cycle at object ${o.id}`);
          if (depth > MAX_TREE_DEPTH) throw new ConflictException('Layout tree is nested too deeply');
          cursor = parentOf.get(cursor) ?? null;
        }
      }

      const after = await tx.warehouseLayout.update({
        where: { id: layoutId },
        data: { version: { increment: 1 } },
      });
      const objects = await tx.layoutObject.findMany({
        where: { layoutId, isDeleted: false },
        orderBy: [{ zIndex: 'asc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
      });
      return { version: after.version, objects, created, deleted: [...deleteIds] };
    });

    await this.audit(
      userId, 'LAYOUT_BATCH_SAVED', 'WarehouseLayout', layoutId,
      { version: dto.version },
      {
        version: result.version,
        created: result.created.length,
        updated: upserts.filter((u) => u.id).length,
        deleted: result.deleted.length,
      },
    );

    return { version: result.version, objects: result.objects };
  }

  // ─── Sprint 5: duplicate ────────────────────────────────────────────────────
  // Copies drop slotId/rackId and code: a WMS slot has exactly one physical bin,
  // so a duplicate must never inherit the original's link or its location code.
  async duplicateObject(id: string, dto: DuplicateObjectDto, userId: string, scope?: LayoutScope) {
    const source = await this.getObjectOrThrow(id);
    await this.assertLayoutInScope(source.layoutId, scope);
    const dx = dto.offsetX ?? 2;
    const dy = dto.offsetY ?? 2;

    const ids = dto.includeChildren ? await this.collectSubtree(id) : [id];
    const rows = await this.prisma.layoutObject.findMany({ where: { id: { in: ids }, isDeleted: false } });
    // collectSubtree returns breadth-first, so parents precede their children.
    const ordered = [...rows].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

    const created = await this.prisma.$transaction(async (tx) => {
      const idMap = new Map<string, string>();
      const out: any[] = [];
      for (const r of ordered) {
        const isRoot = r.id === source.id;
        const row = await tx.layoutObject.create({
          data: {
            layoutId: r.layoutId,
            parentObjectId: isRoot ? r.parentObjectId : (idMap.get(r.parentObjectId ?? '') ?? null),
            objectType: r.objectType,
            name: isRoot ? `${r.name} copy` : r.name,
            code: null,
            x: Math.max(0, r.x + dx), y: Math.max(0, r.y + dy),
            width: r.width, height: r.height,
            rotation: r.rotation, zIndex: r.zIndex, displayOrder: r.displayOrder,
            slotId: null, rackId: null,
            capacity: r.capacity, color: r.color, status: r.status, metadata: r.metadata,
          },
        });
        idMap.set(r.id, row.id);
        out.push(row);
      }
      await tx.warehouseLayout.update({ where: { id: source.layoutId }, data: { version: { increment: 1 } } });
      return out;
    });

    await this.audit(userId, 'LAYOUT_OBJECT_DUPLICATED', 'LayoutObject', id, source, { copies: created.length });
    return created;
  }

  // ─── Sprint 6: linking a drawn object to a WMS location ─────────────────────
  //
  // This is the ONLY place the two systems touch. Linking writes a foreign key
  // on LayoutObject and nothing else — Slot, Rack and StockItem are read to
  // validate the target and are never modified by this module.

  private async warehouseIdOfLayout(layoutId: string) {
    const layout = await this.prisma.warehouseLayout.findFirst({
      where: { id: layoutId, isDeleted: false },
      select: { warehouseId: true },
    });
    if (!layout) throw new NotFoundException('Layout not found');
    return layout.warehouseId;
  }

  async linkObject(id: string, dto: { slotId?: string; rackId?: string }, userId: string, scope?: LayoutScope) {
    const before = await this.getObjectOrThrow(id);
    await this.assertLayoutInScope(before.layoutId, scope);
    const wantSlot = !!dto.slotId;
    const wantRack = !!dto.rackId;

    if (wantSlot === wantRack) {
      throw new BadRequestException('Provide exactly one of slotId or rackId');
    }

    const expects = LINKABLE[before.objectType];
    if (!expects) {
      throw new ConflictException(
        `A ${before.objectType.replace(/_/g, ' ').toLowerCase()} is physical-only and cannot link to a WMS location`,
      );
    }
    if ((expects === 'slot') !== wantSlot) {
      throw new ConflictException(
        expects === 'slot'
          ? 'A bin links to a Slot, not a Rack'
          : 'A rack links to a Rack, not a Slot',
      );
    }

    const warehouseId = await this.warehouseIdOfLayout(before.layoutId);

    if (wantSlot) {
      const slot = await this.prisma.slot.findFirst({
        where: { id: dto.slotId, isDeleted: false },
        select: { id: true, code: true, rack: { select: { warehouseId: true } } },
      });
      if (!slot) throw new NotFoundException('Slot not found');
      if (slot.rack.warehouseId !== warehouseId) {
        throw new ConflictException('That slot belongs to a different warehouse');
      }
      // The schema enforces one physical bin per slot; surface it as a clear
      // message rather than a raw unique-constraint error.
      const taken = await this.prisma.layoutObject.findFirst({
        where: { slotId: dto.slotId, isDeleted: false, NOT: { id } },
        select: { id: true, name: true },
      });
      if (taken) throw new ConflictException(`Slot ${slot.code} is already drawn as "${taken.name}"`);
    } else {
      const rack = await this.prisma.rack.findFirst({
        where: { id: dto.rackId, isDeleted: false },
        select: { id: true, warehouseId: true },
      });
      if (!rack) throw new NotFoundException('Rack not found');
      if (rack.warehouseId !== warehouseId) {
        throw new ConflictException('That rack belongs to a different warehouse');
      }
    }

    const after = await this.prisma.layoutObject.update({
      where: { id },
      data: wantSlot ? { slotId: dto.slotId, rackId: null } : { rackId: dto.rackId, slotId: null },
    });
    await this.audit(userId, 'LAYOUT_OBJECT_LINKED', 'LayoutObject', id, before, after);
    return after;
  }

  // Unlink clears the FK on the drawing. It never touches the Slot or Rack —
  // the WMS location goes on existing exactly as it was.
  async unlinkObject(id: string, userId: string, scope?: LayoutScope) {
    const before = await this.getObjectOrThrow(id);
    await this.assertLayoutInScope(before.layoutId, scope);
    if (!before.slotId && !before.rackId) return before;
    const after = await this.prisma.layoutObject.update({
      where: { id },
      data: { slotId: null, rackId: null },
    });
    await this.audit(userId, 'LAYOUT_OBJECT_UNLINKED', 'LayoutObject', id, before, after);
    return after;
  }

  // ─── Sprint 6: live occupancy for linked bins ───────────────────────────────
  //
  // One derived read that colours the whole canvas. Every number here is
  // computed from StockItem at read time — nothing is stored on LayoutObject,
  // because that would be the second inventory system this feature exists to
  // avoid. Occupancy is derived from actual PLACEMENT (StockItem.slotId), never
  // from Slot.status, which no write path keeps in sync.
  async occupancy(warehouseId: string, scope?: LayoutScope) {
    this.assertWarehouseInScope(warehouseId, scope);
    const layout = await this.prisma.warehouseLayout.findFirst({
      where: { warehouseId, isDeleted: false },
      select: { id: true },
    });
    if (!layout) return [];

    const linked = await this.prisma.layoutObject.findMany({
      where: { layoutId: layout.id, isDeleted: false, slotId: { not: null } },
      select: { id: true, slotId: true },
    });
    if (!linked.length) return [];

    const slotIds = linked.map((l) => l.slotId as string);

    const [slots, items] = await Promise.all([
      this.prisma.slot.findMany({
        where: { id: { in: slotIds } },
        select: { id: true, code: true, name: true, capacity: true, status: true, isDeleted: true },
      }),
      this.prisma.stockItem.findMany({
        where: { slotId: { in: slotIds }, status: { notIn: GONE } },
        select: { slotId: true, productId: true, quantity: true, status: true, updatedAt: true },
      }),
    ]);

    const slotById = new Map(slots.map((s) => [s.id, s]));
    type Acc = { items: number; qty: number; available: number; committed: number; skus: Set<string>; last: Date | null };
    const acc = new Map<string, Acc>();
    const ensure = (sid: string) => {
      if (!acc.has(sid)) acc.set(sid, { items: 0, qty: 0, available: 0, committed: 0, skus: new Set(), last: null });
      return acc.get(sid) as Acc;
    };

    for (const it of items) {
      const a = ensure(it.slotId as string);
      a.items += 1;
      a.qty += it.quantity;
      a.skus.add(it.productId);
      if (it.status === StockStatus.AVAILABLE) a.available += it.quantity;
      else if (COMMITTED.includes(it.status)) a.committed += it.quantity;
      if (!a.last || it.updatedAt > a.last) a.last = it.updatedAt;
    }

    return linked.map((l) => {
      const sid = l.slotId as string;
      const slot = slotById.get(sid);
      const a = acc.get(sid);
      const capacity = slot?.capacity ?? 0;
      const itemCount = a?.items ?? 0;
      return {
        objectId: l.id,
        slotId: sid,
        // A link pointing at a soft-deleted slot is an orphan; the UI warns.
        orphaned: !slot || slot.isDeleted,
        code: slot?.code ?? null,
        name: slot?.name ?? null,
        slotStatus: slot?.status ?? null,
        capacity,
        items: itemCount,
        quantity: a?.qty ?? 0,
        available: a?.available ?? 0,
        committed: a?.committed ?? 0,
        skuCount: a?.skus.size ?? 0,
        utilizationPct: capacity > 0
          ? Math.min(100, Math.round((itemCount / capacity) * 100))
          : (itemCount > 0 ? 100 : 0),
        lastActivityAt: a?.last ?? null,
      };
    });
  }

  // ─── Sprint 6: draw bins from a rack's existing slots ───────────────────────
  // Reads the Slot rows that already exist and draws one BIN per slot, laid out
  // by the slot's own level/column. It creates drawings only — no Slot is
  // created, renamed or moved.
  async generateBinsFromRack(id: string, userId: string, scope?: LayoutScope) {
    const parent = await this.getObjectOrThrow(id);
    await this.assertLayoutInScope(parent.layoutId, scope);
    if (parent.objectType !== LayoutObjectType.RACK) {
      throw new ConflictException('Only a rack object can generate bins');
    }
    if (!parent.rackId) {
      throw new ConflictException('Link this object to a rack first');
    }

    const slots = await this.prisma.slot.findMany({
      where: { rackId: parent.rackId, isDeleted: false, isActive: true },
      select: { id: true, code: true, name: true, level: true, column: true, capacity: true },
      orderBy: [{ level: 'asc' }, { column: 'asc' }],
    });
    if (!slots.length) throw new ConflictException('That rack has no active slots');

    const already = await this.prisma.layoutObject.findMany({
      where: { slotId: { in: slots.map((s) => s.id) }, isDeleted: false },
      select: { slotId: true },
    });
    const taken = new Set(already.map((a) => a.slotId));
    const todo = slots.filter((s) => !taken.has(s.id));
    if (!todo.length) return { created: 0, skipped: slots.length };

    // Lay the bins out inside the parent rack's own footprint, using each slot's
    // level as the row and column as the column.
    const maxLevel = Math.max(...slots.map((s) => s.level));
    const maxCol = Math.max(...slots.map((s) => s.column));
    const cellW = parent.width / maxCol;
    const cellH = parent.height / maxLevel;
    const inset = Math.min(cellW, cellH) * 0.08;

    const created = await this.prisma.$transaction(async (tx) => {
      const out: any[] = [];
      for (const s of todo) {
        out.push(await tx.layoutObject.create({
          data: {
            layoutId: parent.layoutId,
            parentObjectId: parent.id,
            objectType: LayoutObjectType.BIN,
            name: s.name ?? s.code,
            code: s.code,
            // Level 1 is the bottom of a rack, so draw it at the bottom.
            x: parent.x + (s.column - 1) * cellW + inset,
            y: parent.y + (maxLevel - s.level) * cellH + inset,
            width: Math.max(0.2, cellW - inset * 2),
            height: Math.max(0.2, cellH - inset * 2),
            zIndex: parent.zIndex + 1,
            displayOrder: (s.level - 1) * maxCol + s.column,
            slotId: s.id,
            capacity: s.capacity,
          },
        }));
      }
      await tx.warehouseLayout.update({ where: { id: parent.layoutId }, data: { version: { increment: 1 } } });
      return out;
    });

    await this.audit(userId, 'LAYOUT_BINS_GENERATED', 'LayoutObject', id, parent,
      { created: created.length, skipped: slots.length - todo.length });
    return { created: created.length, skipped: slots.length - todo.length, objects: created };
  }
}
