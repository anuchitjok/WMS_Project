// shipment.service.ts — Read-only shipment tracker.
// Packing and dispatch operations have moved to fulfillment/services/.
// This service provides read-only visibility into shipment status and history.
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FulfillmentStatus } from '@prisma/client';

@Injectable()
export class ShipmentService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(status?: string) {
    return this.prisma.shipment.findMany({
      where: status ? { task: { status: status as FulfillmentStatus } } : {},
      include: {
        task: {
          include: { items: { include: { product: true } } },
        },
        timeline: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findShipment(id: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        task: {
          include: {
            items: { include: { product: true } },
            packing: { include: { cartons: true } },
            timeline: { orderBy: { createdAt: 'asc' } },
          },
        },
        timeline: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!s) throw new NotFoundException('Shipment not found');
    return s;
  }

  async findByTrackingNumber(trackingNumber: string) {
    const s = await this.prisma.shipment.findFirst({
      where: { trackingNumber: { contains: trackingNumber, mode: 'insensitive' } },
      include: { task: true, timeline: { orderBy: { createdAt: 'asc' } } },
    });
    if (!s) throw new NotFoundException(`No shipment found with tracking: ${trackingNumber}`);
    return s;
  }
}
