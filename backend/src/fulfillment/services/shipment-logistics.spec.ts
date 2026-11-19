import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DispatchService } from './dispatch.service';

// LOG-001 — the shipping details on the way out. An air waybill and a carrier's
// warehouse number arrive after the box is packed, so they are editable until
// the shipment is delivered, and every change is written down.

type Shipment = {
  id: string;
  refNumber: string;
  deliveredAt: Date | null;
  carrier: string | null;
  carrierBrand: string | null;
  trackingNumber: string | null;
  awbNumber: string | null;
  warehouseNumber: string | null;
};

function makeDb(over: Partial<Shipment> = {}) {
  const shipment: Shipment = {
    id: 'sh1',
    refNumber: 'SHP-2026-ABC123',
    deliveredAt: null,
    carrier: 'Kerry Express Co., Ltd.',
    carrierBrand: null,
    trackingNumber: null,
    awbNumber: null,
    warehouseNumber: null,
    ...over,
  };
  const audit: any[] = [];
  return {
    shipment,
    audit,
    prisma: {
      shipment: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === shipment.id ? { ...shipment } : null,
        ),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(shipment, data);
          return { ...shipment };
        }),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => {
          audit.push(data);
          return data;
        }),
      },
    },
  };
}

describe('DispatchService.updateLogistics', () => {
  const svc = (db: ReturnType<typeof makeDb>) =>
    new DispatchService(db.prisma as any, {} as any, {} as any);

  it('writes the fields that were given and leaves the rest alone', async () => {
    const db = makeDb();
    const out = await svc(db).updateLogistics(
      'sh1',
      { awbNumber: '125-44556677', warehouseNumber: 'WH-KE-0042' },
      'u1',
    );
    expect(out).toMatchObject({
      awbNumber: '125-44556677',
      warehouseNumber: 'WH-KE-0042',
      carrier: 'Kerry Express Co., Ltd.', // untouched
      trackingNumber: null,
    });
  });

  it('keeps the carrier company and its brand apart', async () => {
    const db = makeDb();
    await svc(db).updateLogistics('sh1', { carrierBrand: 'Kerry' }, 'u1');
    expect(db.shipment.carrierBrand).toBe('Kerry');
    expect(db.shipment.carrier).toBe('Kerry Express Co., Ltd.');
  });

  it('an empty string clears a field, while leaving it out does not', async () => {
    const db = makeDb({ awbNumber: '125-11112222', trackingNumber: 'TRK-9' });
    await svc(db).updateLogistics('sh1', { awbNumber: '   ' }, 'u1');
    expect(db.shipment.awbNumber).toBeNull();
    expect(db.shipment.trackingNumber).toBe('TRK-9');
  });

  it('records every change, from and to, against the shipment', async () => {
    const db = makeDb();
    await svc(db).updateLogistics(
      'sh1',
      { carrierBrand: 'Kerry', awbNumber: '125-44556677' },
      'u1',
    );
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0]).toMatchObject({
      userId: 'u1',
      action: 'SHIPMENT_LOGISTICS_UPDATED',
      entityType: 'Shipment',
      entityId: 'sh1',
      changes: {
        carrierBrand: { from: null, to: 'Kerry' },
        awbNumber: { from: null, to: '125-44556677' },
      },
    });
  });

  it('writes nothing at all when nothing actually changed', async () => {
    const db = makeDb({ awbNumber: '125-44556677' });
    await svc(db).updateLogistics('sh1', { awbNumber: '125-44556677' }, 'u1');
    expect(db.prisma.shipment.update).not.toHaveBeenCalled();
    expect(db.audit).toHaveLength(0);
  });

  it('refuses once the shipment is delivered — that record is history', async () => {
    const db = makeDb({ deliveredAt: new Date('2026-11-01') });
    await expect(
      svc(db).updateLogistics('sh1', { awbNumber: 'X' }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.shipment.awbNumber).toBeNull();
  });

  it('refuses a shipment that does not exist', async () => {
    const db = makeDb();
    await expect(
      svc(db).updateLogistics('nope', { awbNumber: 'X' }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('trims what is typed and will not store a sentence in a number field', async () => {
    const db = makeDb();
    await svc(db).updateLogistics('sh1', { trackingNumber: '  TRK-123  ' }, 'u1');
    expect(db.shipment.trackingNumber).toBe('TRK-123');
    await svc(db).updateLogistics('sh1', { awbNumber: 'y'.repeat(200) }, 'u1');
    expect(db.shipment.awbNumber).toHaveLength(100);
  });
});
