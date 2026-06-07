import { Injectable } from '@nestjs/common';

export type EntityType = 'product' | 'stockItem' | 'location' | 'request' | 'shipment' | 'asset' | 'serial' | 'unknown';

export interface ParsedBarcode {
  symbology: 'CODE128' | 'QR' | 'GS1' | 'DATAMATRIX' | 'UNKNOWN';
  type: EntityType;
  value: string; // canonical lookup value (code / id / serial / location key)
  gs1?: { gtin?: string; serial?: string; batch?: string; expiry?: string };
}

const PREFIX_MAP: Record<string, EntityType> = {
  SKU: 'product',
  ITM: 'stockItem',
  LOC: 'location',
  REQ: 'request',
  SHP: 'shipment',
  AST: 'asset',
  SN: 'serial',
};

/**
 * Decodes any supported symbology into a typed token.
 * - Internal canonical:  TYPE|value          (SKU|..., LOC|wh|rack|slot, ...)
 * - GS1:                 (01)..(21)..(10)..   Application Identifiers
 * - Fallback:            raw string → resolver tries product/serial/batch
 */
@Injectable()
export class BarcodeParserService {
  parse(raw: string): ParsedBarcode {
    const value = (raw ?? '').trim();

    // GS1 — detect parenthesised AIs e.g. (01)094...(21)SER123
    if (/\(\d{2,4}\)/.test(value)) {
      const ai = (code: string) => {
        const m = value.match(new RegExp(`\\(${code}\\)([^()]+)`));
        return m ? m[1].trim() : undefined;
      };
      const gs1 = { gtin: ai('01'), serial: ai('21'), batch: ai('10'), expiry: ai('17') };
      return {
        symbology: 'GS1',
        type: gs1.serial ? 'serial' : 'product',
        value: gs1.serial || gs1.gtin || value,
        gs1,
      };
    }

    // Internal canonical prefix
    if (value.includes('|')) {
      const [prefix, ...rest] = value.split('|');
      const type = PREFIX_MAP[prefix.toUpperCase()];
      if (type) {
        return {
          symbology: prefix.toUpperCase() === 'LOC' || prefix.toUpperCase() === 'REQ' ? 'QR' : 'CODE128',
          type,
          value: type === 'location' ? rest.join('|') : rest.join('|'),
        };
      }
    }

    // Plain value — resolver will try product code / serial / batch
    return { symbology: 'UNKNOWN', type: 'unknown', value };
  }

  /** Build a canonical internal barcode payload for an entity. */
  encode(type: Exclude<EntityType, 'unknown'>, value: string): string {
    const prefix = Object.entries(PREFIX_MAP).find(([, t]) => t === type)?.[0] ?? 'SKU';
    return `${prefix}|${value}`;
  }
}
