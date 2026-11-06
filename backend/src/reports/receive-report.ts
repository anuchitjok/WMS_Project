// Receive report (plan 3.4): one row per goods-receiving line, Goods Receiving +
// Item Master fields in the fixed Acumatica order. Pure — the service loads the
// data, this builds the rows and the column set shared by the web table and export.
import { conditionLabel, sourceTypeLabel } from '../receiving/receiving-display';
import type { AuditNames } from '../products/product-audit-names';
import type { ReportColumn } from './reports.service';

export function iso(d?: Date | null): string {
  return d ? d.toISOString() : '';
}

export function bin(item: { rack?: { code: string } | null; slot?: { code: string } | null }): string {
  return [item.rack?.code, item.slot?.code].filter(Boolean).join(' / ');
}

export function sku(p: { partNumber?: string | null; code: string }): string {
  return p.partNumber || p.code;
}

/** Export headers are English and fixed (never translated). Order is the agreed column set. */
export const RECEIVE_COLUMNS: ReportColumn[] = [
  { header: 'AWB', key: 'awb', width: 18 },
  { header: 'Bin Number', key: 'binNumber', width: 16 },
  { header: 'Brand', key: 'brand', width: 16 },
  { header: 'Condition', key: 'condition', width: 14 },
  { header: 'Created By', key: 'createdBy', width: 18 },
  { header: 'Created On', key: 'createdOn', width: 22 },
  { header: 'Current Cost', key: 'currentCost', width: 14 },
  { header: 'Default Price', key: 'defaultPrice', width: 14 },
  { header: 'Description', key: 'description', width: 30 },
  { header: 'Inventory ID/SKU', key: 'sku', width: 20 },
  { header: 'Invoice No', key: 'invoiceNo', width: 18 },
  { header: 'Item Status', key: 'itemStatus', width: 14 },
  { header: 'Item Type', key: 'itemType', width: 16 },
  { header: 'Last Modified By', key: 'lastModifiedBy', width: 18 },
  { header: 'Last Modified On', key: 'lastModifiedOn', width: 22 },
  { header: 'Model', key: 'model', width: 16 },
  { header: 'Part Type', key: 'partType', width: 16 },
  { header: 'QTY', key: 'qty', width: 8 },
  { header: 'Receive By', key: 'receiveBy', width: 18 },
  { header: 'Receive Date', key: 'receiveDate', width: 22 },
  { header: 'RMA Reference No', key: 'rmaRef', width: 20 },
  { header: 'S/N', key: 'serialNumber', width: 20 },
  { header: 'Source Type', key: 'sourceType', width: 16 },
  { header: 'Warehouse', key: 'warehouse', width: 18 },
  { header: 'PO / Reference No.', key: 'poNumber', width: 20 },
];

const ITEM_STATUS: Record<string, string> = { ACTIVE: 'Active', INACTIVE: 'Inactive', DISCONTINUED: 'Discontinued' };
const ITEM_TYPE: Record<string, string> = { FINISHED_GOODS: 'Finished Goods', SPARE_PART: 'Spare Parts' };

/** The shape the service loads for one receiving line. */
export interface ReceiveLine {
  serialNumber: string | null;
  quantity: number;
  condition: string | null;
  itemCondition: string | null;
  product: {
    id: string; code: string; partNumber: string | null; description: string | null; model: string | null;
    productType: string; productStatus: string; partType: string | null;
    unitCost: number | null; defaultPrice: number | null;
    createdAt: Date; updatedAt: Date;
    brand: { name: string } | null;
  };
  receiving: {
    receivedDate: Date; sourceType: string | null; sourceRef: string | null;
    awbNumber: string | null; invoiceNumber: string | null; poNumber: string | null;
    receivedBy: { fullName: string | null } | null;
  };
  stockItem: {
    warehouse: { name: string } | null;
    rack: { code: string } | null;
    slot: { code: string } | null;
  } | null;
}

export function buildReceiveRow(it: ReceiveLine, names?: AuditNames) {
  const p = it.product;
  const gr = it.receiving;
  return {
    awb: gr.awbNumber ?? '',
    binNumber: it.stockItem ? bin(it.stockItem) : '',
    brand: p.brand?.name ?? '',
    condition: conditionLabel(it.itemCondition, it.condition),
    createdBy: names?.createdBy ?? '',
    createdOn: iso(p.createdAt),
    currentCost: p.unitCost ?? null,
    defaultPrice: p.defaultPrice ?? null,
    description: p.description ?? '',
    sku: sku(p),
    invoiceNo: gr.invoiceNumber ?? '',
    itemStatus: ITEM_STATUS[p.productStatus] ?? p.productStatus,
    itemType: ITEM_TYPE[p.productType] ?? p.productType,
    lastModifiedBy: names?.updatedBy ?? '',
    lastModifiedOn: iso(p.updatedAt),
    model: p.model ?? '',
    partType: p.partType ?? '',
    qty: it.quantity,
    receiveBy: gr.receivedBy?.fullName ?? '',
    receiveDate: iso(gr.receivedDate),
    rmaRef: gr.sourceRef ?? '',
    serialNumber: it.serialNumber ?? '',
    sourceType: sourceTypeLabel(gr.sourceType),
    warehouse: it.stockItem?.warehouse?.name ?? '',
    poNumber: gr.poNumber ?? '',
    // Not export columns: stored values, so the screen can translate labels and a
    // search for the stored name ("RTV Replacement", "REFURBISH") still matches.
    sourceTypeValue: gr.sourceType ?? '',
    itemCondition: it.itemCondition ?? null,
    qcCondition: it.condition ?? null,
    itemStatusValue: p.productStatus,
    itemTypeValue: p.productType,
  };
}

export type ReceiveRow = ReturnType<typeof buildReceiveRow>;
