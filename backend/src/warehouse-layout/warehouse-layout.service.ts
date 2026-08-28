import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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
  async getByWarehouse(warehouseId: string) {
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

  async createLayout(warehouseId: string, dto: CreateLayoutDto, userId: string) {
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

  async updateCanvas(layoutId: string, dto: UpdateLayoutCanvasDto, userId: string) {
    const before = await this.getLayoutOrThrow(layoutId);
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

  async createObject(layoutId: string, dto: CreateLayoutObjectDto, userId: string) {
    const layout = await this.getLayoutOrThrow(layoutId);
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

  async updateObject(id: string, dto: UpdateLayoutObjectDto, userId: string) {
    const before = await this.getObjectOrThrow(id);
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
  async deleteObject(id: string, cascade: boolean, userId: string) {
    const before = await this.getObjectOrThrow(id);

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
  async batchSave(layoutId: string, dto: BatchSaveDto, userId: string) {
    const layout = await this.getLayoutOrThrow(layoutId);
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
  async duplicateObject(id: string, dto: DuplicateObjectDto, userId: string) {
    const source = await this.getObjectOrThrow(id);
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
}
