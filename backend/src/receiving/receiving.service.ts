import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StockStatus, OwnershipType, ReceivingStatus } from '@prisma/client';
import { nanoid } from 'nanoid';

interface CreateReceivingDto {
  sourceType: string;
  sourceRef?: string;
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
    condition?: string; // good, damaged, doa
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
      },
    });
    if (!gr) throw new NotFoundException('Receiving record not found');
    return gr;
  }

  // Create receiving + stock items — all-or-nothing in one transaction.
  // Serial numbers are validated for uniqueness against active stock first.
  async create(dto: CreateReceivingDto, userId: string) {
    // ── Serial uniqueness validation (before any write) ───────────────────
    const serials = dto.items.map((i) => i.serialNumber).filter((s): s is string => !!s && s !== 'N/A');
    if (serials.length > 0) {
      // duplicates within the same payload
      const dupInPayload = serials.find((s, idx) => serials.indexOf(s) !== idx);
      if (dupInPayload) {
        throw new ConflictException(`Duplicate serial number in request: ${dupInPayload}`);
      }
      // duplicates against existing active stock
      const existing = await this.prisma.stockItem.findFirst({
        where: {
          serialNumber: { in: serials },
          status: { notIn: [StockStatus.CONSUMED, StockStatus.SHIPPED, StockStatus.CLOSED, StockStatus.CANCELLED] },
        },
        select: { serialNumber: true },
      });
      if (existing) {
        throw new ConflictException(`Serial number already exists in active stock: ${existing.serialNumber}`);
      }
    }

    // ── serial / batch control enforcement ────────────────────────────────────
    for (const item of dto.items) {
      const product = await this.prisma.product.findUnique({ where: { id: item.productId }, select: { serialControlled: true, batchControlled: true, code: true } });
      if (product?.serialControlled && !item.serialNumber) {
        throw new BadRequestException(`Product ${product.code} is serial-controlled — serial number is required`);
      }
      if (product?.batchControlled && !item.batchNumber) {
        throw new BadRequestException(`Product ${product.code} is batch-controlled — batch/lot number is required`);
      }
    }

    const refNumber = this.ref();

    const gr = await this.prisma.$transaction(async (tx) => {
      const created = await tx.goodsReceiving.create({
        data: {
          refNumber,
          sourceType: dto.sourceType,
          sourceRef: dto.sourceRef,
          poNumber: dto.poNumber,
          supplierId: dto.supplierId,
          expectedDate: parseDate(dto.expectedDate),
          notes: dto.notes,
          receivedById: userId,
          status: 'pending_inspection',          // legacy free-string (unchanged)
          statusEnum: ReceivingStatus.QC_PENDING, // Phase 1 shadow lifecycle
        },
      });

      for (const item of dto.items) {
        const status =
          item.condition === 'doa'
            ? StockStatus.DOA
            : item.condition === 'damaged'
              ? StockStatus.DAMAGED
              : StockStatus.PENDING_RECEIVING;

        const stock = await tx.stockItem.create({
          data: {
            productId: item.productId,
            serialNumber: item.serialNumber,
            batchNumber: item.batchNumber,
            quantity: item.quantity,
            status,
            ownershipType: item.ownershipType ?? OwnershipType.OWN,
            warehouseId: item.warehouseId,
            rackId: item.rackId,
            slotId: item.slotId,
            expiryDate: parseDate(item.expiryDate), // Phase 1 — FEFO support
            createdById: userId,
          },
        });

        await tx.goodsReceivingItem.create({
          data: {
            receivingId: created.id,
            productId: item.productId,
            serialNumber: item.serialNumber,
            batchNumber: item.batchNumber,                       // Phase 1
            expiryDate: parseDate(item.expiryDate),              // Phase 1
            manufactureDate: parseDate(item.manufactureDate),   // Phase 1
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

  // Verify receiving — good items become AVAILABLE (ready for putaway), DOA -> RTV pending
  async verify(id: string, userId: string) {
    const gr = await this.findOne(id);
    for (const item of gr.items) {
      if (!item.stockItem) continue;
      let newStatus: StockStatus;
      if (item.condition === 'doa') newStatus = StockStatus.RTV_PENDING;
      else if (item.condition === 'damaged') newStatus = StockStatus.QUARANTINE;
      else newStatus = StockStatus.PENDING_INSPECTION; // ready for putaway
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
