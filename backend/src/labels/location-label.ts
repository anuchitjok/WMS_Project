// Content of a location (bin / slot) label — plan P5 5.4. Pure so it is unit-tested.
//
// The QR payload stays the scanner's canonical location format:
//   LOC|<warehouse code>|<rack code>|<slot code>
// BarcodeParserService.parse() turns it into { type: 'location', value: 'WH|RACK|SLOT' },
// which is exactly the `locationKey` that ScanService putaway splits on '|'.
import { binCode } from '../documents/picking-slip-data';

export interface LabelSlot {
  code: string;
  level?: number | null;
  column?: number | null;
  capacity?: number | null;
  slotType?: string | null;
  rack: {
    code: string;
    name?: string | null;
    rackType?: string | null;
    rackTypeMaster?: { category?: string | null } | null;
    warehouse: { code: string; name?: string | null };
  };
}

export interface LocationLabel {
  /** Big code on the label, e.g. A01-01-08. */
  code: string;
  warehouseLine: string;
  rackLine: string;
  /** e.g. "Level 1 · Column 8" (empty when the slot has no grid position). */
  positionLine: string;
  capacityLine: string;
  /** Value encoded in the QR. */
  payload: string;
  /** Location key the scanner / putaway reads (payload without the LOC| prefix). */
  locationKey: string;
}

export function isPalletOnFloor(rack: LabelSlot['rack']): boolean {
  const c = rack.rackTypeMaster?.category;
  if (c === 'PALLET_ON_FLOOR') return true;
  if (c === 'STANDARD_RACK') return false;
  return rack.rackType === 'PALLET';
}

/** Canonical location key, same order the scanner and putaway use. */
export function locationKey(whCode: string, rackCode?: string | null, slotCode?: string | null): string {
  return [whCode, rackCode, slotCode].filter((p) => p != null && p !== '').join('|');
}

export function locationPayload(whCode: string, rackCode?: string | null, slotCode?: string | null): string {
  return `LOC|${locationKey(whCode, rackCode, slotCode)}`;
}

export function buildLocationLabel(slot: LabelSlot): LocationLabel {
  const rack = slot.rack;
  const wh = rack.warehouse;
  const pallet = isPalletOnFloor(rack);
  const rackName = rack.name && rack.name !== rack.code ? ` (${rack.name})` : '';
  const pos = [
    slot.level ? `Level ${slot.level}` : '',
    slot.column ? `Column ${slot.column}` : '',
  ].filter(Boolean).join(' · ');
  const key = locationKey(wh.code, rack.code, slot.code);
  return {
    code: binCode(rack.code, slot.code),
    warehouseLine: wh.name && wh.name !== wh.code ? `${wh.name} (${wh.code})` : wh.code,
    rackLine: pallet ? `Pallet on Floor · ${rack.code}${rackName}` : `Rack ${rack.code}${rackName}`,
    positionLine: pos,
    capacityLine: slot.capacity && slot.capacity > 0 ? `Capacity: ${slot.capacity}` : '',
    payload: `LOC|${key}`,
    locationKey: key,
  };
}

/**
 * Fallback for a raw key with no slot row (legacy callers that post
 * `locations: ['WH|RACK|SLOT']`): shows what the key says.
 */
export function labelFromKey(key: string): LocationLabel {
  const [wh = '', rack = '', slot = ''] = key.split('|');
  const k = locationKey(wh, rack, slot);
  return {
    code: binCode(rack, slot) || wh,
    warehouseLine: wh,
    rackLine: rack ? `Rack ${rack}` : '',
    positionLine: '',
    capacityLine: '',
    payload: `LOC|${k}`,
    locationKey: k,
  };
}
