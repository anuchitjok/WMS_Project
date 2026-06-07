import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { BarcodeParserService, ParsedBarcode } from './barcode-parser.service';
import { StockStatus, RequestStatus } from '@prisma/client';

interface Actor { id: string; roleKey?: string; warehouseIds?: string[] }
type ScanWorkflow =
  | 'LOOKUP' | 'RECEIVE' | 'PUTAWAY' | 'PICK' | 'PACK' | 'SHIP'
  | 'TRANSFER' | 'COUNT' | 'ADJUST' | 'RTV';

interface ScanDto {
  workflow: ScanWorkflow;
  rawValue: string;
  context?: {
    locationKey?: string;
    requestId?: string;
    taskId?: string;          // fulfillment task
    sessionId?: string;       // cycle count
    lineId?: string;
    countedQty?: number;
    grId?: string;            // goods receiving
    transferId?: string;
    rtvCaseId?: string;
  };
  clientScanId?: string;
  deviceId?: string;
}

@Injectable()
export class ScanService {
  constructor(
    private prisma: PrismaService,
    private parser: BarcodeParserService,
    private realtime: RealtimeGateway,
  ) {}

  // Resolve a parsed barcode to a concrete entity (no state change)
  async resolve(parsed: ParsedBarcode) {
    const v = parsed.value;
    switch (parsed.type) {
      case 'product':
        return this.tagged('product', await this.prisma.product.findFirst({ where: { code: v }, include: { brand: true } }));
      case 'stockItem':
        return this.tagged('stockItem', await this.prisma.stockItem.findFirst({ where: { id: v }, include: { product: true, warehouse: true, rack: true, slot: true } }));
      case 'serial':
        return this.tagged('stockItem', await this.prisma.stockItem.findFirst({ where: { serialNumber: v }, include: { product: true, warehouse: true, rack: true, slot: true } }));
      case 'request':
        return this.tagged('request', await this.prisma.withdrawalRequest.findFirst({ where: { refNumber: v }, include: { items: { include: { product: true } } } }));
      case 'location': {
        const [whCode, rackCode, slotCode] = v.split('|');
        const wh = await this.prisma.warehouse.findFirst({ where: { code: whCode }, include: { racks: { include: { slots: true } } } });
        return this.tagged('location', wh ? { warehouse: wh, rackCode, slotCode, locationKey: v } : null);
      }
      default: {
        // unknown → try product code, then serial, then batch (mirrors existing barcode lookup)
        const p = await this.prisma.product.findFirst({ where: { code: v }, include: { brand: true } });
        if (p) return this.tagged('product', p);
        const s = await this.prisma.stockItem.findFirst({
          where: { OR: [{ serialNumber: v }, { batchNumber: v }] },
          include: { product: true, warehouse: true, rack: true, slot: true },
        });
        if (s) return this.tagged('stockItem', s);
        return { entityType: null, entity: null };
      }
    }
  }
  private tagged(entityType: string, entity: any) {
    return { entityType: entity ? entityType : null, entity };
  }

  // Dry-run: parse + resolve, NO writes, NO ScanEvent
  async validate(rawValue: string) {
    const parsed = this.parser.parse(rawValue);
    const { entityType, entity } = await this.resolve(parsed);
    return { parsed, found: !!entity, entityType, entity };
  }

  // Execute a scan: resolve + perform workflow effect + log immutable ScanEvent
  async scan(dto: ScanDto, actor: Actor) {
    // Idempotency: replay returns the original outcome
    if (dto.clientScanId) {
      const existing = await this.prisma.scanEvent.findUnique({ where: { clientScanId: dto.clientScanId } });
      if (existing) return { duplicate: true, event: existing };
    }

    const parsed = this.parser.parse(dto.rawValue);
    let result = 'SUCCESS';
    let message: string | undefined;
    let entityType: string | null = null;
    let entityId: string | null = null;
    let warehouseId: string | null = null;
    let effect: any = null;

    try {
      const resolved = await this.resolve(parsed);
      entityType = resolved.entityType;
      const entity = resolved.entity;
      if (!entity) {
        result = 'NOT_FOUND';
        message = `No entity for barcode: ${dto.rawValue}`;
      } else if (dto.workflow === 'LOOKUP') {
        entityId = entity.id ?? null;
        warehouseId = entity.warehouseId ?? null;
        effect = entity;
      } else if (dto.workflow === 'PUTAWAY') {
        ({ result, message, entityId, warehouseId, effect } = await this.doPutaway(entity, dto, actor));
      } else if (dto.workflow === 'PICK') {
        ({ result, message, entityId, warehouseId, effect } = await this.doPick(entity, dto, actor));
      } else if (dto.workflow === 'RECEIVE') {
        ({ result, message, entityId, warehouseId, effect } = await this.doReceive(entity, dto, actor));
      } else if (dto.workflow === 'PACK') {
        ({ result, message, entityId, warehouseId, effect } = await this.doPack(entity, dto, actor));
      } else if (dto.workflow === 'SHIP') {
        ({ result, message, entityId, warehouseId, effect } = await this.doShip(entity, dto, actor));
      } else if (dto.workflow === 'TRANSFER') {
        ({ result, message, entityId, warehouseId, effect } = await this.doTransfer(entity, dto, actor));
      } else if (dto.workflow === 'COUNT') {
        ({ result, message, entityId, warehouseId, effect } = await this.doCount(entity, dto, actor));
      } else if (dto.workflow === 'ADJUST') {
        entityId = entity.id; warehouseId = entity.warehouseId; effect = entity;
        result = 'SUCCESS'; message = `Item verified for adjustment: ${entity.product?.code ?? entity.id}`;
      } else if (dto.workflow === 'RTV') {
        ({ result, message, entityId, warehouseId, effect } = await this.doRtv(entity, dto, actor));
      } else {
        result = 'ERROR';
        message = `Unsupported workflow: ${dto.workflow}`;
      }
    } catch (e: any) {
      result = 'ERROR';
      message = e?.message ?? 'Scan failed';
    }

    const event = await this.prisma.scanEvent.create({
      data: {
        clientScanId: dto.clientScanId,
        userId: actor.id,
        deviceId: dto.deviceId,
        workflow: dto.workflow,
        rawValue: dto.rawValue,
        symbology: parsed.symbology,
        entityType,
        entityId,
        warehouseId,
        result,
        message,
      },
    });
    this.realtime.emitInventoryUpdate({ action: 'scan', workflow: dto.workflow, result });
    return { duplicate: false, result, message, entityType, entity: effect, event };
  }

  private async doPutaway(item: any, dto: ScanDto, actor: Actor) {
    if (!dto.context?.locationKey) throw new BadRequestException('Putaway requires a destination location scan');
    const allowed: StockStatus[] = [StockStatus.PENDING_RECEIVING, StockStatus.PENDING_INSPECTION];
    if (!allowed.includes(item.status)) throw new BadRequestException(`Item not awaiting putaway (status ${item.status})`);

    const [whCode, rackCode, slotCode] = dto.context.locationKey.split('|');
    const wh = await this.prisma.warehouse.findFirst({ where: { code: whCode } });
    if (!wh) throw new BadRequestException(`Unknown warehouse: ${whCode}`);
    if (actor.roleKey !== 'SUPER_ADMIN' && (actor.warehouseIds?.length ?? 0) > 0 && !actor.warehouseIds!.includes(wh.id)) {
      return { result: 'OUT_OF_SCOPE', message: `Warehouse ${whCode} not in your scope`, entityId: item.id, warehouseId: wh.id, effect: null };
    }
    const rack = rackCode ? await this.prisma.rack.findFirst({ where: { warehouseId: wh.id, code: rackCode } }) : null;
    const slot = rack && slotCode ? await this.prisma.slot.findFirst({ where: { rackId: rack.id, code: slotCode } }) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.stockItem.update({
        where: { id: item.id },
        data: { warehouseId: wh.id, rackId: rack?.id, slotId: slot?.id, status: StockStatus.AVAILABLE },
        include: { product: true, warehouse: true, rack: true, slot: true },
      });
      await tx.auditLog.create({ data: { userId: actor.id, action: 'PUTAWAY_CONFIRMED', entityType: 'StockItem', entityId: item.id, detail: dto.context!.locationKey } });
      return u;
    });
    return { result: 'SUCCESS', message: undefined, entityId: item.id, warehouseId: wh.id, effect: updated };
  }

  private async doPick(item: any, dto: ScanDto, actor: Actor) {
    if (!dto.context?.requestId) throw new BadRequestException('Pick requires a request context');
    if (item.status !== StockStatus.RESERVED) {
      // double-pick / wrong-unit guard
      return { result: 'ERROR', message: `Item is ${item.status}, not RESERVED — cannot pick`, entityId: item.id, warehouseId: item.warehouseId, effect: null };
    }
    const reqItem = await this.prisma.withdrawalRequestItem.findFirst({
      where: { request: { refNumber: dto.context.requestId }, stockItemId: item.id },
      include: { request: true },
    });
    if (!reqItem) {
      return { result: 'ERROR', message: 'This unit is not reserved for that request', entityId: item.id, warehouseId: item.warehouseId, effect: null };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.stockItem.update({ where: { id: item.id }, data: { status: StockStatus.PICKED }, include: { product: true } });
      // advance request to PICKING if still APPROVED
      if (reqItem.request.status === RequestStatus.APPROVED) {
        await tx.withdrawalRequest.update({ where: { id: reqItem.requestId }, data: { status: RequestStatus.PICKING } });
      }
      await tx.auditLog.create({ data: { userId: actor.id, action: 'PICK_CONFIRMED', entityType: 'StockItem', entityId: item.id, detail: dto.context!.requestId } });
      return u;
    });
    this.realtime.emitRequestUpdate({ action: 'pick', requestId: reqItem.requestId });
    return { result: 'SUCCESS', message: undefined, entityId: item.id, warehouseId: item.warehouseId, effect: updated };
  }

  // Offline replay — idempotent per clientScanId
  async batch(scans: ScanDto[], actor: Actor) {
    const results: any[] = [];
    for (const s of scans) results.push(await this.scan(s, actor));
    const applied = results.filter((r) => !r.duplicate).length;
    return { total: scans.length, applied, duplicates: scans.length - applied, results };
  }

  history(filter: { entityId?: string; serial?: string; workflow?: string; limit?: number }) {
    const where: any = {};
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.workflow) where.workflow = filter.workflow;
    if (filter.serial) where.rawValue = { contains: filter.serial };
    return this.prisma.scanEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: filter.limit ?? 50 });
  }

  // ── RECEIVE scan: verify item against open GR ─────────────────────────────
  private async doReceive(item: any, dto: ScanDto, actor: Actor) {
    if (!dto.context?.grId) throw new BadRequestException('RECEIVE scan requires grId in context');
    const grItem = await this.prisma.goodsReceivingItem.findFirst({
      where: { receivingId: dto.context.grId, serialNumber: item.serialNumber ?? undefined },
    });
    if (!grItem) return { result: 'ERROR', message: 'Item not found in this receiving record', entityId: null, warehouseId: null, effect: null };
    return { result: 'SUCCESS', message: `Verified in GR`, entityId: item.id, warehouseId: item.warehouseId, effect: item };
  }

  // ── PACK scan: link item to packing session ────────────────────────────────
  private async doPack(item: any, dto: ScanDto, actor: Actor) {
    if (!dto.context?.taskId) throw new BadRequestException('PACK scan requires taskId in context');
    const task = await this.prisma.fulfillmentTask.findUnique({ where: { id: dto.context.taskId } });
    if (!task) return { result: 'ERROR', message: 'Task not found', entityId: null, warehouseId: null, effect: null };
    if (!['PICKED', 'PACKING', 'PACKED'].includes(task.status)) {
      return { result: 'ERROR', message: `Task status ${task.status} not in packing stage`, entityId: task.id, warehouseId: task.warehouseId, effect: null };
    }
    // Verify item belongs to this task
    const taskItem = await this.prisma.fulfillmentTaskItem.findFirst({ where: { taskId: dto.context.taskId, stockItemId: item.id } });
    if (!taskItem) return { result: 'ERROR', message: 'Item not part of this packing task', entityId: task.id, warehouseId: task.warehouseId, effect: null };
    return { result: 'SUCCESS', message: `Item verified for packing`, entityId: task.id, warehouseId: task.warehouseId, effect: { task, item } };
  }

  // ── SHIP scan: confirm shipment barcode ────────────────────────────────────
  private async doShip(entity: any, dto: ScanDto, actor: Actor) {
    // Scan shipment ref barcode or task ref
    const shipment = await this.prisma.shipment.findFirst({
      where: { OR: [{ refNumber: dto.rawValue.replace('SHP|', '') }, { taskId: dto.context?.taskId }] },
    });
    if (!shipment) return { result: 'NOT_FOUND', message: `No shipment found`, entityId: null, warehouseId: null, effect: null };
    // Update shipment to SHIPPED
    const updated = await this.prisma.shipment.update({ where: { id: shipment.id }, data: { shippedAt: new Date() } });
    await this.prisma.shipmentTimeline.create({ data: { shipmentId: shipment.id, status: 'SHIPPED', description: 'Confirmed via barcode scan', actorId: actor.id } });
    await this.prisma.auditLog.create({ data: { userId: actor.id, action: 'SCAN_SHIP', entityType: 'Shipment', entityId: shipment.id } });
    return { result: 'SUCCESS', message: `Shipment ${shipment.refNumber} confirmed`, entityId: shipment.id, warehouseId: null, effect: updated };
  }

  // ── TRANSFER scan: confirm source or destination ─────────────────────────
  private async doTransfer(item: any, dto: ScanDto, actor: Actor) {
    if (!dto.context?.transferId) throw new BadRequestException('TRANSFER scan requires transferId in context');
    const transfer = await this.prisma.stockTransfer.findUnique({ where: { id: dto.context.transferId } });
    if (!transfer) return { result: 'ERROR', message: 'Transfer not found', entityId: null, warehouseId: null, effect: null };
    if (transfer.status !== 'PENDING') return { result: 'ERROR', message: `Transfer already ${transfer.status}`, entityId: transfer.id, warehouseId: null, effect: null };
    return { result: 'SUCCESS', message: `Item verified for transfer ${transfer.refNumber}`, entityId: transfer.id, warehouseId: null, effect: transfer };
  }

  // ── COUNT scan: record cycle count for a line ─────────────────────────────
  private async doCount(item: any, dto: ScanDto, actor: Actor) {
    if (!dto.context?.sessionId) throw new BadRequestException('COUNT scan requires sessionId in context');
    const line = await this.prisma.cycleCountLine.findFirst({
      where: { sessionId: dto.context.sessionId, stockItemId: item.id },
    });
    if (!line) return { result: 'ERROR', message: 'Item not in count session', entityId: null, warehouseId: item.warehouseId, effect: null };
    const qty = dto.context.countedQty ?? 1;
    const variance = qty - line.expectedQty;
    await this.prisma.cycleCountLine.update({ where: { id: line.id }, data: { countedQty: qty, variance, countedById: actor.id, countedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { userId: actor.id, action: 'SCAN_COUNT', entityType: 'CycleCountLine', entityId: line.id, detail: `qty=${qty} variance=${variance}` } });
    return { result: 'SUCCESS', message: `Counted ${qty} (variance ${variance > 0 ? '+' : ''}${variance})`, entityId: line.id, warehouseId: item.warehouseId, effect: { line, item } };
  }

  // ── RTV scan: confirm DOA item for RTV case ────────────────────────────────
  private async doRtv(item: any, dto: ScanDto, actor: Actor) {
    if (!['DOA', 'DAMAGED', 'RTV_PENDING'].includes(item.status)) {
      return { result: 'ERROR', message: `Item status ${item.status} is not eligible for RTV`, entityId: item.id, warehouseId: item.warehouseId, effect: null };
    }
    const rtv = dto.context?.rtvCaseId
      ? await this.prisma.rTVCase.findUnique({ where: { id: dto.context.rtvCaseId } })
      : await this.prisma.rTVCase.findFirst({ where: { stockItemId: item.id } });
    if (!rtv) return { result: 'ERROR', message: 'No RTV case found for this item', entityId: item.id, warehouseId: item.warehouseId, effect: null };
    await this.prisma.auditLog.create({ data: { userId: actor.id, action: 'SCAN_RTV', entityType: 'RTVCase', entityId: rtv.id, detail: item.serialNumber ?? item.id } });
    return { result: 'SUCCESS', message: `Item verified for RTV case ${rtv.refNumber}`, entityId: rtv.id, warehouseId: item.warehouseId, effect: rtv };
  }
}
