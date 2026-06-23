import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StockStatus, OwnershipType, ReceivingStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { InspectReceivingDto } from './dto/inspect-receiving.dto';

interface CreateReceivingDto {
  sourceType: string;
  sourceRef?: string;
  awbNumber?: string;
  invoiceNumber?: string;
  poNumber?: string;
  supplierId?: string;
  expectedDate?: string;
  notes?: string;
  items: {
    productId: string;
    serialNumber?: string;
    batchNumber?: string;
    expiryDate?: string;
    manufactureDate?: string;
    quantity: number;
    condition?: string;
    ownershipType?: OwnershipType;
    warehouseId?: string;
    rackId?: string;
    slotId?: string;
  }[];
}

function parseDate(d?: string): Date | undefined {
  if (!d) return undefined;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? undefined : dt;
}

const DISCREPANCY_OUTCOMES = new Set(['short_qty', 'wrong_item', 'missing_accessories']);

@Injectable()
export class ReceivingService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  private ref() {
    return `GR-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
  }

  findAll(status?: string) {
    return this.prisma.goodsReceiving.findMany({
      where: status ? { status } : {},
      include: {
        receivedBy: { select: { fullName: true } },
        items: { include: { product: true, stockItem: true } },
        discrepancies: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const gr = await this.prisma.goodsReceiving.findUnique({
      where: { id },
      include: {
        receivedBy: { select: { fullName: true } },
        items: { include: { product: { include: { brand: true } }, stockItem: true } },
        discrepancies: true,
      },
    });
    if (!gr) throw new NotFoundException('Receiving record not found');
    return gr;
  }

  async create(dto: CreateReceivingDto, userId: string) {
    // Serial uniqueness validation (before any write)
    const serials = dto.items.map((i) => i.serialNumber).filter((s): s is string => !!s && s !== 'N/A');
    if (serials.length > 0) {
      const dupInPayload = serials.find((s, idx) => serials.indexOf(s) !== idx);
      if (dupInPayload) throw new ConflictException(`Duplicate serial number in request: ${dupInPayload}`);
      const existing = await this.prisma.stockItem.findFirst({
        where: {
          serialNumber: { in: serials },
          status: { notIn: [StockStatus.CONSUMED, StockStatus.SHIPPED, StockStatus.CLOSED, StockStatus.CANCELLED] },
        },
        select: { serialNumber: true },
      });
      if (existing) throw new ConflictException(`Serial number already exists in active stock: ${existing.serialNumber}`);
    }

    // Serial/batch control enforcement
    for (const item of dto.items) {
      const product = await this.prisma.product.findUnique({ where: { id: item.productId }, select: { serialControlled: true, batchControlled: true, code: true } });
      if (product?.serialControlled && !item.serialNumber) throw new BadRequestException(`Product ${product.code} is serial-controlled — serial number is required`);
      if (product?.batchControlled && !item.batchNumber) throw new BadRequestException(`Product ${product.code} is batch-controlled — batch/lot number is required`);
    }

    const refNumber = this.ref();

    const gr = await this.prisma.$transaction(async (tx) => {
      const created = await tx.goodsReceiving.create({
        data: {
          refNumber,
          sourceType: dto.sourceType,
          sourceRef: dto.sourceRef,
          awbNumber: dto.awbNumber,
          invoiceNumber: dto.invoiceNumber,
          poNumber: dto.poNumber,
          supplierId: dto.supplierId,
          expectedDate: parseDate(dto.expectedDate),
          notes: dto.notes,
          receivedById: userId,
          status: 'pending_inspection',
          statusEnum: ReceivingStatus.QC_PENDING,
        },
      });

      for (const item of dto.items) {
        const stock = await tx.stockItem.create({
          data: {
            productId: item.productId,
            serialNumber: item.serialNumber,
            batchNumber: item.batchNumber,
            quantity: item.quantity,
            status: StockStatus.PENDING_RECEIVING,
            ownershipType: item.ownershipType ?? OwnershipType.OWN,
            warehouseId: item.warehouseId,
            rackId: item.rackId,
            slotId: item.slotId,
            expiryDate: parseDate(item.expiryDate),
            createdById: userId,
          },
        });

        await tx.goodsReceivingItem.create({
          data: {
            receivingId: created.id,
            productId: item.productId,
            serialNumber: item.serialNumber,
            batchNumber: item.batchNumber,
            expiryDate: parseDate(item.expiryDate),
            manufactureDate: parseDate(item.manufactureDate),
            quantity: item.quantity,
            condition: item.condition ?? 'good',
            stockItemId: stock.id,
          },
        });
      }

      await tx.auditLog.create({
        data: { userId, action: 'GOODS_RECEIVED', entityType: 'GoodsReceiving', entityId: created.id, detail: refNumber },
      });
      return created;
    });

    this.realtime.emitInventoryUpdate({ action: 'received', refNumber });
    return this.findOne(gr.id);
  }

  // ─── Inspection ──────────────────────────────────────────────────────────────
  // Per-item inspection outcomes drive final stock routing. This replaces the
  // old single-click verify() for new records; verify() is kept for backward compat.
  async inspect(id: string, dto: InspectReceivingDto, userId: string) {
    const gr = await this.findOne(id);

    const allGood        = dto.items.every((i) => i.inspectionOutcome === 'good');
    const allRejected    = dto.items.every((i) => i.inspectionOutcome === 'wrong_item');
    const hasDiscrepancy = dto.items.some((i) => DISCREPANCY_OUTCOMES.has(i.inspectionOutcome));

    await this.prisma.$transaction(async (tx) => {
      for (const inspectItem of dto.items) {
        const grItem = gr.items.find((i) => i.id === inspectItem.itemId);
        if (!grItem) throw new NotFoundException(`Item ${inspectItem.itemId} not found in GR ${id}`);

        // Update inspection fields on the receiving item
        await tx.goodsReceivingItem.update({
          where: { id: grItem.id },
          data: {
            inspectedQty: inspectItem.inspectedQty,
            inspectionOutcome: inspectItem.inspectionOutcome,
            inspectorNotes: inspectItem.inspectorNotes,
            ...(inspectItem.serialNumber && { serialNumber: inspectItem.serialNumber }),
            ...(inspectItem.batchNumber  && { batchNumber:  inspectItem.batchNumber }),
          },
        });

        // Route stock based on inspection outcome
        if (grItem.stockItem) {
          let newStatus: StockStatus;
          const finalQty = inspectItem.inspectedQty ?? grItem.quantity;

          switch (inspectItem.inspectionOutcome) {
            case 'good':
              newStatus = StockStatus.PENDING_INSPECTION; // enters putaway queue
              break;
            case 'doa':
              newStatus = StockStatus.RTV_PENDING;
              break;
            case 'damaged':
              newStatus = StockStatus.QUARANTINE;
              break;
            case 'short_qty':
              newStatus = StockStatus.PENDING_INSPECTION; // partial qty available after putaway
              break;
            case 'wrong_item':
            case 'missing_accessories':
              newStatus = StockStatus.QUARANTINE;
              break;
            default:
              newStatus = StockStatus.PENDING_INSPECTION;
          }

          await tx.stockItem.update({
            where: { id: grItem.stockItem.id },
            data: { status: newStatus, quantity: finalQty },
          });

          // Create discrepancy record for flagged outcomes
          if (DISCREPANCY_OUTCOMES.has(inspectItem.inspectionOutcome)) {
            await tx.receivingDiscrepancy.create({
              data: {
                receivingId: id,
                itemId: grItem.id,
                type: inspectItem.inspectionOutcome,
                orderedQty: grItem.quantity,
                receivedQty: grItem.quantity,
                inspectedQty: finalQty,
                notes: inspectItem.inspectorNotes,
              },
            });
          }
        }
      }

      // Determine overall GR status from outcomes
      let newStatusEnum: ReceivingStatus;
      if (allRejected)         newStatusEnum = ReceivingStatus.REJECTED;
      else if (hasDiscrepancy) newStatusEnum = ReceivingStatus.PARTIAL;
      else if (allGood)        newStatusEnum = ReceivingStatus.PUTAWAY_PENDING;
      else                     newStatusEnum = ReceivingStatus.PUTAWAY_PENDING;

      await tx.goodsReceiving.update({
        where: { id },
        data: {
          status: 'completed',
          statusEnum: newStatusEnum,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'RECEIVING_INSPECTED',
          entityType: 'GoodsReceiving',
          entityId: id,
          detail: `${gr.refNumber} — ${dto.items.map((i) => i.inspectionOutcome).join(', ')}`,
        },
      });
    });

    this.realtime.emitInventoryUpdate({ action: 'inspected', id });
    return this.findOne(id);
  }

  // Legacy single-click verify — kept for backward compat; routes by stored condition.
  async verify(id: string, userId: string) {
    const gr = await this.findOne(id);
    for (const item of gr.items) {
      if (!item.stockItem) continue;
      let newStatus: StockStatus;
      if (item.condition === 'doa') newStatus = StockStatus.RTV_PENDING;
      else if (item.condition === 'damaged') newStatus = StockStatus.QUARANTINE;
      else newStatus = StockStatus.PENDING_INSPECTION;
      await this.prisma.stockItem.update({ where: { id: item.stockItem.id }, data: { status: newStatus } });
    }
    await this.prisma.goodsReceiving.update({
      where: { id },
      data: { status: 'completed', statusEnum: ReceivingStatus.COMPLETED },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'RECEIVING_VERIFIED', entityType: 'GoodsReceiving', entityId: id, detail: gr.refNumber },
    });
    this.realtime.emitInventoryUpdate({ action: 'verified', id });
    return this.findOne(id);
  }
}
