import { applyDecorators, CanActivate, GoneException, Injectable, SetMetadata, UseGuards, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isStep5LegacyEnabled } from './feature-flags';

/**
 * Step 5 ("Keep stock accurate") is retired: Inventory edits, Barcode Scanner,
 * Stock Transfer, Cycle Count and Stock Adjustment no longer create or change
 * stock on their own. Stock moves only through Step 2–4 documents
 * (receive, putaway, request, fulfillment, returns, RTV, scrap).
 *
 * Reads stay open so history remains visible; only the write commands answer
 * 410 Gone. ENABLE_STEP5_LEGACY=true re-opens them as a deployment rollback.
 */
export const RETIRED_VIEW_AT = '/reports?tab=balance';

export function retiredError(feature: string): GoneException {
  return new GoneException({
    statusCode: 410,
    error: 'Gone',
    message: `${feature} is retired. Stock now changes only through receiving, requests and returns — view balances and history in Reports.`,
    retired: feature,
    viewAt: RETIRED_VIEW_AT,
  });
}

/** Throws 410 when a retired feature is used while the legacy switch is off. */
export function assertNotRetired(feature: string): void {
  if (!isStep5LegacyEnabled()) throw retiredError(feature);
}

const RETIRED_KEY = 'wms:retired-feature';

@Injectable()
export class RetiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<string | undefined>(RETIRED_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (feature) assertNotRetired(feature);
    return true;
  }
}

/** Marks a write endpoint of a retired Step 5 feature. */
export const Retired = (feature: string) => applyDecorators(SetMetadata(RETIRED_KEY, feature), UseGuards(RetiredGuard));
