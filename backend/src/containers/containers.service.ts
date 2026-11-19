import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NOT_IN_LOCATION } from '../common/stock-presence';
import { ScopePrincipal, assertWarehouseAccess, scopedWarehouseIds } from '../common/warehouse-scope';
import { generateContainerCode } from './container-code';
import type { CreateContainerDto, MoveContainerDto, PackItemsDto, SplitContainerDto, MergeContainerDto, UpdateContainerDto } from './containers.dto';

/**
 * RQ17 / RQ18 — boxes.
 *
 * A container is a place that can move: it has a location of its own and holds
 * stock rows. The stock keeps its warehouse/rack/slot columns — they remain the
 * single answer to "where is this?" — and a container move rewrites them for
 * everything inside, in one transaction, so the two can never disagree.
 *
 * It is not a quantity. "Split" moves whole stock rows into another box;
 * splitting a quantity (100 pcs into 60 + 40) is RQ16 and is deliberately not
 * here. Nothing in this service changes a stock status.
 */
@Injectable()
export class ContainersService {
  constructor(private prisma: PrismaService) {}

  private audit(userId: string, action: string, entityId: string, detail: unknown) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType: 'Container', entityId, detail: JSON.stringify(detail) },
    });
  }

  private readonly detail = {
    parent: { select: { id: true, code: true, name: true } },
    children: { where: { isDeleted: false }, select: { id: true, code: true, name: true, status: true } },
    splitFrom: { select: { id: true, code: true } },
    warehouse: { select: { id: true, code: true, name: true } },
    rack: { select: { id: true, code: true } },
    slot: { select: { id: true, code: true } },
    stockItems: {
      where: { status: { notIn: NOT_IN_LOCATION } },
      select: {
        id: true, quantity: true, status: true, serialNumber: true, batchNumber: true,
        product: { select: { id: true, code: true, name: true, unit: true } },
      },
    },
  } satisfies Prisma.ContainerInclude;

  private async getOrThrow(id: string) {
    const c = await this.prisma.container.findFirst({ where: { id, isDeleted: false }, include: this.detail });
    if (!c) throw new NotFoundException('Container not found');
    return c;
  }

  /** Where a slot is, as the three columns stock and containers both use. */
  private async placeOf(slotId: string | null | undefined, scope?: ScopePrincipal) {
    if (!slotId) return { slotId: null, rackId: null, warehouseId: null };
    const slot = await this.prisma.slot.findFirst({
      where: { id: slotId, isDeleted: false, isActive: true },
      select: { id: true, rack: { select: { id: true, warehouseId: true, isDeleted: true, isActive: true } } },
    });
    if (!slot || slot.rack.isDeleted || !slot.rack.isActive) throw new NotFoundException('Slot not found');
    assertWarehouseAccess(scope, slot.rack.warehouseId, 'warehouse');
    return { slotId: slot.id, rackId: slot.rack.id, warehouseId: slot.rack.warehouseId };
  }

  private assertOpen(c: { status: ContainerStatus; code: string }) {
    if (c.status === ContainerStatus.CLOSED) {
      throw new ConflictException({
        code: 'CONTAINER_CLOSED',
        message: `Box ${c.code} is closed. Open it before packing or unpacking.`,
      });
    }
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  async list(q: { warehouseId?: string; slotId?: string; search?: string; includeEmpty?: boolean }, scope?: ScopePrincipal) {
    const ids = scopedWarehouseIds(scope);
    const where: Prisma.ContainerWhereInput = {
      isDeleted: false,
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : ids ? { OR: [{ warehouseId: { in: ids } }, { warehouseId: null }] } : {}),
      ...(q.slotId ? { slotId: q.slotId } : {}),
      ...(q.search
        ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const rows = await this.prisma.container.findMany({
      where,
      include: {
        warehouse: { select: { code: true } },
        rack: { select: { code: true } },
        slot: { select: { code: true } },
        parent: { select: { id: true, code: true } },
        _count: { select: { stockItems: true, children: true } },
      },
      orderBy: { code: 'asc' },
      take: 500,
    });
    return q.includeEmpty === false ? rows.filter((r) => r._count.stockItems > 0) : rows;
  }

  get(id: string) {
    return this.getOrThrow(id);
  }

  /** What the scanner asks for after reading BOX|<code>. */
  async byCode(code: string) {
    const c = await this.prisma.container.findFirst({
      where: { code: String(code ?? '').trim().toUpperCase(), isDeleted: false },
      include: this.detail,
    });
    if (!c) throw new NotFoundException('Container not found');
    return c;
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  /** The code is generated here and nowhere else, like a warehouse code. */
  async create(dto: CreateContainerDto, userId: string, scope?: ScopePrincipal) {
    const place = await this.placeOf(dto.slotId, scope);
    if (dto.parentContainerId) await this.getOrThrow(dto.parentContainerId);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('container_code'))`);
          const taken = await tx.container.findMany({ select: { code: true } });
          const code = generateContainerCode(taken.map((c) => c.code));
          return tx.container.create({
            data: {
              code,
              name: dto.name?.trim() || null,
              type: dto.type ?? undefined,
              notes: dto.notes?.trim() || null,
              parentContainerId: dto.parentContainerId ?? null,
              ...place,
            },
          });
        });
        await this.audit(userId, 'CONTAINER_CREATED', created.id, { code: created.code, place });
        return this.getOrThrow(created.id);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 4) continue;
        throw e;
      }
    }
    throw new ConflictException('Could not generate a container code, please try again');
  }

  async update(id: string, dto: UpdateContainerDto, userId: string) {
    const before = await this.getOrThrow(id);
    const after = await this.prisma.container.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    await this.audit(userId, dto.status && dto.status !== before.status
      ? (dto.status === ContainerStatus.CLOSED ? 'CONTAINER_CLOSED' : 'CONTAINER_OPENED')
      : 'CONTAINER_UPDATED', id, { before: { name: before.name, status: before.status }, after: { name: after.name, status: after.status } });
    return this.getOrThrow(id);
  }

  /**
   * Move the box. Everything inside goes with it — the stock rows it holds and,
   * all the way down, the boxes inside it and their stock. One transaction, so
   * a half-moved pallet cannot exist.
   */
  async move(id: string, dto: MoveContainerDto, userId: string, scope?: ScopePrincipal) {
    const before = await this.getOrThrow(id);
    const place = await this.placeOf(dto.slotId ?? null, scope);
    if (before.warehouseId) assertWarehouseAccess(scope, before.warehouseId, 'warehouse');

    // Collect the whole tree first: a box inside a box moves with its parent.
    const ids: string[] = [];
    const walk = async (parentId: string, depth = 0) => {
      if (depth > 20) throw new BadRequestException('Containers are nested too deeply');
      ids.push(parentId);
      const kids = await this.prisma.container.findMany({ where: { parentContainerId: parentId, isDeleted: false }, select: { id: true } });
      for (const k of kids) await walk(k.id, depth + 1);
    };
    await walk(id);

    const moved = await this.prisma.$transaction(async (tx) => {
      await tx.container.updateMany({ where: { id: { in: ids } }, data: place });
      // The stock inside keeps its status; only where it is changes.
      const stock = await tx.stockItem.updateMany({
        where: { containerId: { in: ids }, status: { notIn: NOT_IN_LOCATION } },
        data: place,
      });
      return { containers: ids.length, stock: stock.count };
    });

    await this.audit(userId, 'CONTAINER_MOVED', id, {
      code: before.code,
      from: { slotId: before.slotId, rackId: before.rackId, warehouseId: before.warehouseId },
      to: place,
      alsoMoved: moved,
    });
    return this.getOrThrow(id);
  }

  /** Pack stock into the box. The rows take the box's location. */
  async packItems(id: string, dto: PackItemsDto, userId: string, scope?: ScopePrincipal) {
    const box = await this.getOrThrow(id);
    this.assertOpen(box);
    const itemIds = [...new Set(dto.stockItemIds ?? [])];
    if (!itemIds.length) throw new BadRequestException('Choose at least one stock row');

    const items = await this.prisma.stockItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, status: true, warehouseId: true, containerId: true },
    });
    if (items.length !== itemIds.length) throw new NotFoundException('Some stock rows no longer exist');
    for (const it of items) {
      if ((NOT_IN_LOCATION as readonly string[]).includes(it.status)) {
        throw new ConflictException(`Stock that has left the building (${it.status}) cannot be packed`);
      }
      if (it.warehouseId) assertWarehouseAccess(scope, it.warehouseId, 'warehouse');
      if (it.containerId && it.containerId !== id) {
        throw new ConflictException('Some of this stock is already in another box — take it out first');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.stockItem.updateMany({
        where: { id: { in: itemIds } },
        data: { containerId: id, slotId: box.slotId, rackId: box.rackId, warehouseId: box.warehouseId },
      });
    });
    await this.audit(userId, 'CONTAINER_PACKED', id, { code: box.code, stockItemIds: itemIds });
    return this.getOrThrow(id);
  }

  /** Take stock out. It stays where the box is; only the link goes. */
  async unpackItems(id: string, dto: PackItemsDto, userId: string, scope?: ScopePrincipal) {
    const box = await this.getOrThrow(id);
    this.assertOpen(box);
    if (box.warehouseId) assertWarehouseAccess(scope, box.warehouseId, 'warehouse');
    const itemIds = [...new Set(dto.stockItemIds ?? [])];
    if (!itemIds.length) throw new BadRequestException('Choose at least one stock row');

    const n = await this.prisma.stockItem.updateMany({
      where: { id: { in: itemIds }, containerId: id },
      data: { containerId: null },
    });
    if (n.count === 0) throw new NotFoundException('None of those rows are in this box');
    await this.audit(userId, 'CONTAINER_UNPACKED', id, { code: box.code, stockItemIds: itemIds, moved: n.count });
    return this.getOrThrow(id);
  }

  /**
   * Split: a new box, in the same place, holding the rows chosen. The new box
   * remembers which one it came out of (`splitFromId`) — that is the trail
   * RQ18 asks for. No quantity is divided here.
   */
  async split(id: string, dto: SplitContainerDto, userId: string, scope?: ScopePrincipal) {
    const source = await this.getOrThrow(id);
    this.assertOpen(source);
    const itemIds = [...new Set(dto.stockItemIds ?? [])];
    if (!itemIds.length) throw new BadRequestException('Choose the stock to move into the new box');

    const inBox = await this.prisma.stockItem.findMany({ where: { id: { in: itemIds }, containerId: id }, select: { id: true } });
    if (inBox.length !== itemIds.length) throw new ConflictException('Some of those rows are not in this box');
    if (inBox.length === source.stockItems.length && !dto.allowEmptySource) {
      throw new BadRequestException('That would empty the box. Move the box itself, or tick "allow empty".');
    }

    const created = await this.create(
      { name: dto.name, type: dto.type ?? source.type, slotId: source.slotId ?? undefined, parentContainerId: source.parentContainerId ?? undefined },
      userId, scope,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.container.update({ where: { id: created.id }, data: { splitFromId: source.id } });
      await tx.stockItem.updateMany({ where: { id: { in: itemIds } }, data: { containerId: created.id } });
    });
    await this.audit(userId, 'CONTAINER_SPLIT', source.id, { from: source.code, to: created.code, stockItemIds: itemIds });
    return { source: await this.getOrThrow(source.id), created: await this.getOrThrow(created.id) };
  }

  /** Merge: everything in `fromContainerId` goes into this box, which keeps its own place. */
  async merge(id: string, dto: MergeContainerDto, userId: string, scope?: ScopePrincipal) {
    const target = await this.getOrThrow(id);
    this.assertOpen(target);
    if (dto.fromContainerId === id) throw new BadRequestException('A box cannot be merged into itself');
    const source = await this.getOrThrow(dto.fromContainerId);
    this.assertOpen(source);
    if (target.warehouseId) assertWarehouseAccess(scope, target.warehouseId, 'warehouse');
    if (source.warehouseId) assertWarehouseAccess(scope, source.warehouseId, 'warehouse');

    const moved = await this.prisma.$transaction(async (tx) => {
      const stock = await tx.stockItem.updateMany({
        where: { containerId: source.id, status: { notIn: NOT_IN_LOCATION } },
        data: { containerId: target.id, slotId: target.slotId, rackId: target.rackId, warehouseId: target.warehouseId },
      });
      // Boxes packed inside the source follow their stock into the target.
      const kids = await tx.container.updateMany({
        where: { parentContainerId: source.id, isDeleted: false },
        data: { parentContainerId: target.id, slotId: target.slotId, rackId: target.rackId, warehouseId: target.warehouseId },
      });

      // The source is empty now. Unless the caller wants to keep the box for
      // re-use, retire it in the same transaction so a merge never leaves an
      // empty box behind for someone to tidy up by hand. Soft delete only: the
      // code and its history stay on file.
      let retired = false;
      if (dto.retireSource) {
        const left = await tx.stockItem.count({ where: { containerId: source.id, status: { notIn: NOT_IN_LOCATION } } });
        const kidsLeft = await tx.container.count({ where: { parentContainerId: source.id, isDeleted: false } });
        if (left === 0 && kidsLeft === 0) {
          await tx.container.update({
            where: { id: source.id },
            data: { isDeleted: true, deletedAt: new Date(), deletedBy: userId, parentContainerId: null },
          });
          retired = true;
        }
      }
      return { stock: stock.count, children: kids.count, retired };
    });

    await this.audit(userId, 'CONTAINER_MERGED', target.id, {
      into: target.code, from: source.code, moved, sourceRetired: moved.retired,
    });
    if (moved.retired) await this.audit(userId, 'CONTAINER_DELETED', source.id, { code: source.code, reason: 'merged into ' + target.code });
    // A retired source is gone from every read path, so there is nothing left
    // to hand back for it.
    return {
      target: await this.getOrThrow(target.id),
      source: moved.retired ? null : await this.getOrThrow(source.id),
      moved,
    };
  }

  /** Soft delete, and only once the box is empty — a box is never deleted with stock in it. */
  async remove(id: string, userId: string, scope?: ScopePrincipal) {
    const box = await this.getOrThrow(id);
    if (box.warehouseId) assertWarehouseAccess(scope, box.warehouseId, 'warehouse');
    if (box.stockItems.length) throw new ConflictException('Take the stock out of the box first');
    if (box.children.length) throw new ConflictException('Take the boxes out of this one first');
    await this.prisma.container.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), deletedBy: userId, parentContainerId: null },
    });
    await this.audit(userId, 'CONTAINER_DELETED', id, { code: box.code });
    return { success: true, id };
  }
}
