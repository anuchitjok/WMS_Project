import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { FINAL_STATUSES, ISSUED_STATUSES, LocationInput, resolveLocation } from '../common/stock-state';
import { StockStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { nanoid } from 'nanoid';

const NOT_RELOCATABLE: StockStatus[] = [
  StockStatus.PICKING, StockStatus.PICKED, StockStatus.PACKED, StockStatus.READY_FOR_PICKUP,
  ...ISSUED_STATUSES, ...FINAL_STATUSES,
];

@Injectable()
export class TransferService {
  constructor(private prisma: PrismaService) {}

  findAll(status?: string) {
    return this.prisma.stockTransfer.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    dto: { stockItemId?: string; productLabel: string; quantity: number; fromLocation: string; toLocation: string; notes?: string },
    userId: string,
  ) {
    const trf = await this.prisma.stockTransfer.create({
      data: {
        refNumber: `TRF-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`,
        stockItemId: dto.stockItemId,
        productLabel: dto.productLabel,
        quantity: dto.quantity,
        fromLocation: dto.fromLocation,
        toLocation: dto.toLocation,
        notes: dto.notes,
        requestedById: userId,
        status: 'PENDING',
      },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'TRANSFER_REQUESTED', entityType: 'StockTransfer', entityId: trf.id, detail: trf.refNumber },
    });
    return trf;
  }

  // Complete transfer — apply destination location to linked stock item
  async complete(
    id: string,
    dest: LocationInput | undefined,
    userId: string,
  ) {
    const trf = await this.prisma.stockTransfer.findUnique({ where: { id } });
    if (!trf) throw new NotFoundException('Transfer not found');

    return this.prisma.$transaction(async (tx) => {
      // Claim the transfer: completing twice (or a cancelled transfer) is rejected.
      const claimed = await tx.stockTransfer.updateMany({
        where: { id, status: { in: ['PENDING', 'IN_TRANSIT'] } },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException(`Transfer is already ${trf.status}`);

      const loc = dest ? await resolveLocation(tx, dest) : {};
      if (trf.stockItemId && Object.keys(loc).length > 0) {
        // Picked or issued stock is no longer on its shelf — it cannot be relocated.
        const moved = await tx.stockItem.updateMany({
          where: { id: trf.stockItemId, status: { notIn: NOT_RELOCATABLE } },
          data: loc,
        });
        if (moved.count === 0) {
          const stock = await tx.stockItem.findUnique({ where: { id: trf.stockItemId }, select: { status: true } });
          throw new ConflictException(`Stock item cannot be relocated (status ${stock?.status ?? 'missing'})`);
        }
      }
      await tx.auditLog.create({
        data: {
          userId,
          action: 'TRANSFER_COMPLETED',
          entityType: 'StockTransfer',
          entityId: id,
          detail: `${trf.fromLocation} → ${trf.toLocation}`,
        },
      });
      return tx.stockTransfer.findUniqueOrThrow({ where: { id } });
    });
  }
}
