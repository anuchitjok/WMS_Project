import { NOT_IN_LOCATION } from '../common/stock-presence';
import {
  Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { StockStatus, LayoutObjectType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLayoutDto, UpdateLayoutCanvasDto, CreateLayoutObjectDto, UpdateLayoutObjectDto,
  BatchSaveDto, DuplicateObjectDto, SaveRackPositionsDto, ResetRackPositionsDto,
} from './dto/layout.dto';
import { type Pt, type FloorRect, bbox, outlineOf, rectCorners, rectInPolygon, rectsOverlap } from '../warehouse-master/floor-geometry';

// Physical Layout is the *drawing* of the warehouse floor. It never owns
// inventory and never writes Warehouse / Rack / Slot / StockItem — this service
// reads those tables only to validate that a layout's warehouse exists.
// Linking an object to a WMS Slot/Rack is Sprint 6.

const MAX_TREE_DEPTH = 64; // cycle/runaway guard for parent-chain walks

// Stock that has left the building is not occupying a bin. Matches the set used
// by warehouse.service.inventoryByBrand so both surfaces agree.
// Same definition as the Control Center (common/stock-presence.ts).
const GONE: StockStatus[] = NOT_IN_LOCATION;
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

  // ─── F6: racks arranged in the 3D view ──────────────────────────────────────
  //
  // 3D sends every active rack's position in metres; this turns them into RACK
  // drawings on the Floor Plan (linked by rackId). It writes LayoutObject and
  // WarehouseLayout only — never Rack, Slot or StockItem.

  private readonly sameOrder = [{ zIndex: 'asc' as const }, { displayOrder: 'asc' as const }, { createdAt: 'asc' as const }];

  async saveRackPositions(warehouseId: string, dto: SaveRackPositionsDto, userId: string, scope?: LayoutScope) {
    this.assertWarehouseInScope(warehouseId, scope);
    const wh = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, isDeleted: false },
      select: { id: true, lengthCm: true, widthCm: true, floorOutline: true },
    });
    if (!wh) throw new NotFoundException('Warehouse not found');

    // Every active rack, once — 3D pins them all, so none is left to the auto layout.
    const racks = await this.prisma.rack.findMany({
      where: { warehouseId, isDeleted: false, isActive: true },
      select: { id: true, code: true },
    });
    const rackOf = new Map(racks.map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const p of dto.racks) {
      const r = rackOf.get(p.rackId);
      if (!r) throw new BadRequestException(`Rack ${p.rackId} is not an active rack of this warehouse`);
      if (seen.has(p.rackId)) throw new BadRequestException(`Rack ${r.code} is listed twice`);
      seen.add(p.rackId);
    }
    const missing = racks.filter((r) => !seen.has(r.id));
    if (missing.length) {
      throw new BadRequestException(`Every active rack must be placed; missing: ${codeList(missing.map((r) => r.code))}`);
    }

    const layout = await this.prisma.warehouseLayout.findUnique({ where: { warehouseId } });
    const live = layout && !layout.isDeleted ? layout : null;
    if (live ? live.version !== dto.version : dto.version !== undefined && dto.version !== null) {
      throw new ConflictException('This layout changed elsewhere. Reload before saving.');
    }

    // The scale is recorded once; after that the stored one wins (metres convert either way).
    // The floor anchor only means something while racks are drawn against it: with no
    // rack drawing left, 3D starts a fresh frame and its anchor replaces the old one.
    const mpu = layout?.metersPerUnit ?? dto.metersPerUnit;
    const drawnNow = layout
      ? await this.prisma.layoutObject.findMany({
          where: { layoutId: layout.id, isDeleted: false, objectType: LayoutObjectType.RACK, rackId: { in: racks.map((r) => r.id) } },
          select: { id: true },
        })
      : [];
    const keepAnchor = drawnNow.length > 0 && layout?.floorOriginX != null && layout?.floorOriginZ != null;
    const origin: Pt | null = keepAnchor
      ? [layout.floorOriginX!, layout.floorOriginZ!]
      : dto.floorOriginX != null && dto.floorOriginZ != null ? [dto.floorOriginX, dto.floorOriginZ] : null;
    const poly = floorPolygon(wh, origin);

    const issues = rackPositionIssues(dto.racks, poly);
    if (issues.outside.length || issues.overlap.length) {
      const code = (id: string) => rackOf.get(id)!.code;
      const parts = [
        issues.outside.length ? `outside the warehouse: ${codeList(issues.outside.map(code))}` : '',
        issues.overlap.length ? `overlapping: ${codeList(issues.overlap.map(code))}` : '',
      ].filter(Boolean);
      throw new BadRequestException(`Racks cannot be saved here (${parts.join('; ')})`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const lay = live
        ?? (layout
          ? await tx.warehouseLayout.update({ where: { id: layout.id }, data: { isDeleted: false, deletedAt: null, deletedBy: null } })
          : await tx.warehouseLayout.create({ data: { warehouseId } }));
      const all = await tx.layoutObject.findMany({ where: { layoutId: lay.id, isDeleted: false }, orderBy: this.sameOrder });
      // Same pick as 3D: the last RACK drawing linked to a rack is the one shown.
      const drawnOf = new Map<string, (typeof all)[number]>();
      for (const o of all) if (o.objectType === LayoutObjectType.RACK && o.rackId) drawnOf.set(o.rackId, o);
      const kids = new Map<string, (typeof all)[number][]>();
      for (const o of all) if (o.parentObjectId) kids.set(o.parentObjectId, [...(kids.get(o.parentObjectId) ?? []), o]);

      let created = 0, updated = 0, childrenMoved = 0;
      let maxX = 0, maxY = 0;
      for (const p of dto.racks) {
        const g = planGeometry(p, mpu);
        const reach = Math.max(g.width, g.height);
        maxX = Math.max(maxX, g.x + reach); maxY = Math.max(maxY, g.y + reach);
        const o = drawnOf.get(p.rackId);
        if (!o) {
          const code = rackOf.get(p.rackId)!.code;
          await tx.layoutObject.create({
            data: {
              layoutId: lay.id, objectType: LayoutObjectType.RACK, name: code, code, rackId: p.rackId, ...g,
              metadata: JSON.stringify({ source: '3d' }),
            },
          });
          created++;
          continue;
        }
        if (same(o.x, g.x) && same(o.y, g.y) && same(o.width, g.width) && same(o.height, g.height) && same(o.rotation, g.rotation)) continue;
        // Bins drawn inside the rack move and turn with it, so the Floor Plan stays tidy.
        const from = { cx: o.x + o.width / 2, cy: o.y + o.height / 2, deg: facing(o) };
        await tx.layoutObject.update({ where: { id: o.id }, data: g });
        updated++;
        const to = { cx: g.x + g.width / 2, cy: g.y + g.height / 2, deg: p.rotation };
        const stack = [...(kids.get(o.id) ?? [])];
        while (stack.length) {
          const d = stack.pop()!;
          stack.push(...(kids.get(d.id) ?? []));
          await tx.layoutObject.update({ where: { id: d.id }, data: carry(d, from, to) });
          childrenMoved++;
        }
      }

      // Grow (never shrink) the plan canvas so everything stays on it.
      if (poly) for (const [x, z] of poly) { maxX = Math.max(maxX, x / mpu); maxY = Math.max(maxY, z / mpu); }
      const after = await tx.warehouseLayout.update({
        where: { id: lay.id },
        data: {
          version: { increment: 1 },
          ...(lay.metersPerUnit == null ? { metersPerUnit: mpu } : {}),
          ...(!keepAnchor ? { floorOriginX: origin?.[0] ?? null, floorOriginZ: origin?.[1] ?? null } : {}),
          widthUnits: Math.max(lay.widthUnits, Math.ceil(maxX + 2)),
          heightUnits: Math.max(lay.heightUnits, Math.ceil(maxY + 2)),
        },
      });
      const objects = await tx.layoutObject.findMany({ where: { layoutId: lay.id, isDeleted: false }, orderBy: this.sameOrder });
      return { layout: after, objects, created, updated, childrenMoved };
    });

    await this.audit(
      userId, 'LAYOUT_RACKS_ARRANGED', 'WarehouseLayout', result.layout.id,
      { version: live?.version ?? null, metersPerUnit: layout?.metersPerUnit ?? null },
      {
        version: result.layout.version, metersPerUnit: result.layout.metersPerUnit,
        racks: dto.racks.length, created: result.created, updated: result.updated, childrenMoved: result.childrenMoved,
      },
    );
    return { layout: result.layout, objects: result.objects };
  }

  // "Back to auto layout": removes the rack drawings that 3D created. Racks drawn
  // on the Floor Plan by hand stay (they are part of someone's plan), and so does
  // any 3D drawing that has objects under it.
  async resetRackPositions(warehouseId: string, dto: ResetRackPositionsDto, userId: string, scope?: LayoutScope) {
    this.assertWarehouseInScope(warehouseId, scope);
    const layout = await this.prisma.warehouseLayout.findFirst({ where: { warehouseId, isDeleted: false } });
    if (!layout) throw new NotFoundException('This warehouse has no layout');
    if (layout.version !== dto.version) throw new ConflictException('This layout changed elsewhere. Reload before saving.');

    const result = await this.prisma.$transaction(async (tx) => {
      const all = await tx.layoutObject.findMany({ where: { layoutId: layout.id, isDeleted: false } });
      const parents = new Set(all.map((o) => o.parentObjectId).filter(Boolean));
      const linked = all.filter((o) => o.objectType === LayoutObjectType.RACK && o.rackId);
      const remove = linked.filter((o) => isFrom3d(o.metadata) && !parents.has(o.id)).map((o) => o.id);
      if (remove.length) {
        await tx.layoutObject.updateMany({
          where: { id: { in: remove } },
          data: { isDeleted: true, deletedAt: new Date(), deletedBy: userId },
        });
      }
      const after = await tx.warehouseLayout.update({ where: { id: layout.id }, data: { version: { increment: 1 } } });
      const objects = await tx.layoutObject.findMany({ where: { layoutId: layout.id, isDeleted: false }, orderBy: this.sameOrder });
      return { layout: after, objects, removed: remove.length, kept: linked.length - remove.length };
    });

    await this.audit(
      userId, 'LAYOUT_RACKS_RESET', 'WarehouseLayout', layout.id,
      { version: layout.version },
      { version: result.layout.version, removed: result.removed, kept: result.kept },
    );
    return result;
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

// ─── F6 helpers (3D arrange) ────────────────────────────────────────────────────

const codeList = (codes: string[]) => codes.slice(0, 10).join(', ') + (codes.length > 10 ? ` +${codes.length - 10}` : '');
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const norm360 = (d: number) => ((Math.round(d) % 360) + 360) % 360;

const isFrom3d = (metadata: string | null) => {
  try { return !!metadata && JSON.parse(metadata)?.source === '3d'; } catch { return false; }
};

/** Warehouse floor in the 3D frame (m): the outline with its top-left corner at `origin`. */
export function floorPolygon(wh: { lengthCm?: number | null; widthCm?: number | null; floorOutline?: unknown }, origin: Pt | null): Pt[] | null {
  const pts = outlineOf(wh);
  if (!pts || !origin) return null;
  const bb = bbox(pts);
  return pts.map(([x, z]) => [origin[0] + x - bb.minX, origin[1] + z - bb.minZ] as Pt);
}

type RackPos = { rackId: string; cx: number; cz: number; length: number; depth: number; rotation: number };
const footprint = (p: RackPos): FloorRect => ({ center: [p.cx, p.cz], length: p.length, depth: p.depth, rotY: (-p.rotation * Math.PI) / 180 });

/**
 * Same rule as the 3D view: a rack must sit on the floor and must not overlap
 * another (touching is fine). A rack bigger than the floor in both directions
 * can never fit, so it is not held against the save (Warehouse Master shows it).
 */
export function rackPositionIssues(racks: RackPos[], poly: Pt[] | null): { outside: string[]; overlap: string[] } {
  const g = racks.map(footprint);
  const box = g.map((r) => {
    const c = rectCorners(r);
    return { minX: Math.min(...c.map((q) => q[0])), maxX: Math.max(...c.map((q) => q[0])), minZ: Math.min(...c.map((q) => q[1])), maxZ: Math.max(...c.map((q) => q[1])) };
  });
  let outside: string[] = [];
  if (poly) {
    const bb = bbox(poly);
    const fits = (p: RackPos) => (p.length <= bb.length + 1e-9 && p.depth <= bb.width + 1e-9) || (p.length <= bb.width + 1e-9 && p.depth <= bb.length + 1e-9);
    outside = racks.filter((p, i) => fits(p) && !rectInPolygon(g[i], poly)).map((p) => p.rackId);
  }
  const over = new Set<string>();
  for (let i = 0; i < racks.length; i++) {
    for (let j = i + 1; j < racks.length; j++) {
      const a = box[i], b = box[j];
      if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxZ <= b.minZ || b.maxZ <= a.minZ) continue;
      if (rectsOverlap(g[i], g[j])) { over.add(racks[i].rackId); over.add(racks[j].rackId); }
    }
  }
  return { outside, overlap: racks.filter((p) => over.has(p.rackId)).map((p) => p.rackId) };
}

/**
 * Metres (3D) → a RACK drawing in plan units. 3D treats a drawing that is wider
 * than tall as running along X, so the rotation is stored to come back the same.
 */
export function planGeometry(p: RackPos, mpu: number) {
  const width = p.length / mpu, height = p.depth / mpu;
  const rotation = width >= height ? p.rotation : norm360(p.rotation + 270);
  return { x: p.cx / mpu - width / 2, y: p.cz / mpu - height / 2, width, height, rotation };
}

/** Which way a rack drawing faces, in the 3D sense (0 = along +X). */
const facing = (o: { width: number; height: number; rotation: number }) =>
  o.width >= o.height ? o.rotation : o.rotation + 90;

/** A child drawing carried along when its rack moves and turns (plan units). */
function carry(
  d: { x: number; y: number; width: number; height: number; rotation: number },
  from: { cx: number; cy: number; deg: number }, to: { cx: number; cy: number; deg: number },
) {
  const t = ((to.deg - from.deg) * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  const dx = d.x + d.width / 2 - from.cx, dy = d.y + d.height / 2 - from.cy;
  const nx = to.cx + dx * c - dy * s, ny = to.cy + dx * s + dy * c;
  return { x: nx - d.width / 2, y: ny - d.height / 2, rotation: norm360(d.rotation + to.deg - from.deg) };
}
