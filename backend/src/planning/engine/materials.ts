import { addDays, daysBetween } from './calendar';
import { r2 } from './workflow';
import {
  DataSnapshot,
  InboundLine,
  Issue,
  MaterialResult,
  ProjectHeader,
  ScenarioInputs,
} from './types';

const EPS = 1e-9;

/** Identity of a material line: its product, or (sales simulation) its free-text item name. */
export const materialKey = (m: { productId: string; itemName?: string }) =>
  m.productId || `item:${(m.itemName ?? '').trim().toLowerCase()}`;

/** True when a material input line belongs to a material result line. */
export const sameMaterial = (
  line: { productId: string; itemName?: string },
  res: { productId: string; name: string },
) =>
  res.productId
    ? line.productId === res.productId
    : !line.productId &&
      (line.itemName ?? '').trim().toLowerCase() ===
        res.name.trim().toLowerCase();

export interface MaterialOut {
  lines: MaterialResult[];
  /** Latest date all of a stage's materials are covered; null = unknown. */
  readyByStage: Map<string, string | null>;
  missing: Issue[];
}

/**
 * Project material requirements, netted against the planning warehouse.
 *
 *   gross       = Σ (units entering the consuming stage × quantity per unit)
 *   total       = ⌈ gross + gross × scrap% ⌉
 *   netAvailable= max(0, on hand − safety stock − pending requests − other approved plans)
 *   netRequired = max(0, total − netAvailable)
 *   shortage    = max(0, netRequired − inbound that arrives by the required-by date)
 *
 * Reserved stock is already excluded from "on hand" (it belongs to approved
 * requests), so approved requests are not counted a second time. This
 * project's own earlier runs are never counted as demand.
 *
 * Sales simulation: stock is not read, so nothing is netted — the whole
 * requirement is "to be procured" and the only check is whether the lead time
 * (counted from today) delivers it before the consuming stage starts.
 */
export function planMaterials(
  header: ProjectHeader,
  inp: ScenarioInputs,
  data: DataSnapshot,
  stageInput: Map<string, number>,
  stageStartDate: Map<string, string>,
): MaterialOut {
  const asOf = data.asOf;
  const sales = header.purpose === 'SALES';
  const products = new Map(data.products.map((p) => [p.productId, p]));
  const missing: Issue[] = [];
  const groups = new Map<string, typeof inp.materials>();
  for (const m of inp.materials)
    groups.set(materialKey(m), [...(groups.get(materialKey(m)) ?? []), m]);

  const lines: MaterialResult[] = [];
  const coverageByProduct = new Map<string, string | null>();

  for (const [key, ms] of groups) {
    const productId = ms[0].productId;
    const free = ms[0].itemName?.trim() || 'Item';
    // Sales simulations never use stock figures, even for a Product Master item.
    const found = productId ? products.get(productId) : undefined;
    const p = {
      code: found?.code ?? free,
      name: found?.name ?? free,
      unit: found?.unit ?? (ms[0].unit?.trim() || 'unit'),
      standardUnitCost: found?.standardUnitCost ?? 0,
      minimumStock: sales ? 0 : (found?.minimumStock ?? 0),
      available: sales ? 0 : (found?.available ?? 0),
      reserved: sales ? 0 : (found?.reserved ?? 0),
      inInspection: sales ? 0 : (found?.inInspection ?? 0),
      pendingRequestDemand: sales ? 0 : (found?.pendingRequestDemand ?? 0),
      otherPlanDemand: sales ? 0 : (found?.otherPlanDemand ?? 0),
    };
    let gross = 0;
    let scrap = 0;
    for (const m of ms) {
      const g = (stageInput.get(m.stageKey) ?? 0) * m.qtyPerUnit;
      gross += g;
      scrap += (g * m.scrapPct) / 100;
    }
    const total = Math.ceil(gross + scrap - EPS);
    const requiredBy = ms.map((m) => stageStartDate.get(m.stageKey)!).sort()[0];
    const pending = inp.includePendingRequests ? p.pendingRequestDemand : 0;
    const netAvailable = Math.max(
      0,
      p.available - p.minimumStock - pending - p.otherPlanDemand,
    );
    const netRequirement = Math.max(0, total - netAvailable);
    const leadTimeDays =
      ms.map((m) => m.leadTimeDays).find((v) => v !== null) ?? null;
    const packMultiple =
      ms.map((m) => m.packMultiple).find((v) => v !== null) ?? null;

    const inbound: InboundLine[] = [];
    if (p.inInspection > 0)
      inbound.push({
        source: 'WMS_IN_INSPECTION',
        reference: 'Received, awaiting inspection',
        quantity: p.inInspection,
        expectedDate: asOf,
        arrivesInTime: asOf <= requiredBy,
      });
    for (const x of inp.manualInbound
      .filter((i) => !sales && !!productId && i.productId === productId)
      .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)))
      inbound.push({
        source: 'MANUAL',
        reference: x.reference,
        quantity: x.quantity,
        expectedDate: x.expectedDate,
        arrivesInTime: x.expectedDate <= requiredBy,
      });
    const eligibleInbound = inbound
      .filter((i) => i.arrivesInTime)
      .reduce((a, i) => a + i.quantity, 0);
    const shortage = sales
      ? 0
      : Math.max(0, netRequirement - eligibleInbound);

    let coverageDate: string | null = null;
    if (sales)
      coverageDate = leadTimeDays === null ? null : addDays(asOf, leadTimeDays);
    else if (netRequirement <= 0) coverageDate = asOf;
    else {
      let cum = 0;
      for (const i of inbound) {
        cum += i.quantity;
        if (cum >= netRequirement - EPS) {
          coverageDate = i.expectedDate;
          break;
        }
      }
      if (!coverageDate && leadTimeDays !== null)
        coverageDate = addDays(asOf, leadTimeDays);
    }
    // Sales: no lead time entered = timing not checked (not a failure).
    const arrivesInTime =
      coverageDate === null ? sales : coverageDate <= requiredBy;
    coverageByProduct.set(key, coverageDate);
    const toBuy = sales ? total : shortage;
    const orderByDate =
      toBuy > 0 && leadTimeDays !== null
        ? addDays(requiredBy, -leadTimeDays)
        : null;
    const orderDatePassed = orderByDate !== null && orderByDate < asOf;
    const suggested =
      toBuy > 0
        ? packMultiple
          ? Math.ceil(toBuy / packMultiple - EPS) * packMultiple
          : toBuy
        : 0;

    // Unit cost: manual estimate > Product Master (only with a declared currency).
    const override =
      ms.map((m) => m.unitCostOverride).find((v) => v !== null) ?? null;
    let unitCost: number | null = null;
    let unitCostSource: MaterialResult['unitCostSource'] = 'MISSING';
    let costNote = '';
    if (override !== null) {
      unitCost = override;
      unitCostSource = 'MANUAL_ESTIMATE';
    } else if (found && p.standardUnitCost > 0) {
      const cur = inp.costs.masterCostCurrency;
      if (cur && cur === header.currency) {
        unitCost = p.standardUnitCost;
        unitCostSource = 'PRODUCT_MASTER';
      } else if (cur && inp.costs.fxRateMasterToProject) {
        unitCost = r2(p.standardUnitCost * inp.costs.fxRateMasterToProject);
        unitCostSource = 'PRODUCT_MASTER';
        costNote = ` Standard unit cost ${p.standardUnitCost} ${cur} × ${inp.costs.fxRateMasterToProject} = ${unitCost} ${header.currency}.`;
      } else {
        costNote = cur
          ? ` Standard unit cost is in ${cur} and no exchange rate to ${header.currency} was entered — cost excluded.`
          : ' The currency of Product Master standard unit cost is not declared — cost excluded.';
      }
    } else
      costNote = found
        ? ' No standard unit cost in Product Master and no manual estimate.'
        : ' No unit cost entered.';

    const parts: string[] = sales
      ? [
          `Needs ${total} ${p.unit} (${r2(gross)} gross + ${r2(scrap)} scrap allowance).`,
          `Sales simulation: stock is not checked — the full quantity is treated as to be procured${packMultiple ? ` (${suggested} after rounding to multiples of ${packMultiple})` : ''}.`,
          leadTimeDays === null
            ? 'No lead time entered — material timing is not checked.'
            : `Ordered today with ${leadTimeDays} days lead time it arrives ${coverageDate}${arrivesInTime ? `, before it is needed on ${requiredBy}` : ` — after it is needed on ${requiredBy}`}.`,
        ]
      : [
      `Needs ${total} ${p.unit} (${r2(gross)} gross + ${r2(scrap)} scrap allowance).`,
      `Usable now: ${p.available} available − ${p.minimumStock} safety stock − ${pending} pending requests − ${p.otherPlanDemand} other approved plans = ${netAvailable}.`,
    ];
    if (sales) {
      // procurement wording is already in `parts`
    } else if (netRequirement <= 0) parts.push('Covered from stock.');
    else {
      parts.push(
        `Net requirement ${netRequirement}; inbound arriving by ${requiredBy}: ${eligibleInbound}.`,
      );
      if (shortage > 0) {
        parts.push(`Shortage ${shortage}.`);
        const late = inbound.filter((i) => !i.arrivesInTime);
        if (late.length)
          parts.push(
            `Late inbound: ${late.map((i) => `${i.quantity} on ${i.expectedDate}`).join(', ')}.`,
          );
        parts.push(
          leadTimeDays === null
            ? 'No supplier lead time entered — arrival date unknown.'
            : `With ${leadTimeDays} days lead time, order by ${orderByDate}${orderDatePassed ? ' (already passed)' : ''}.`,
        );
        parts.push(
          `Suggested replenishment ${suggested}${packMultiple ? ` (rounded to multiples of ${packMultiple})` : ''} — suggestion only, no purchase order is created.`,
        );
      }
    }
    if (costNote) parts.push(costNote.trim());

    if (shortage > 0 && coverageDate === null)
      missing.push({
        area: 'MATERIAL',
        message: `${p.code}: shortage of ${shortage} with no inbound or lead time — the date it can be available is unknown`,
      });

    lines.push({
      productId,
      supplyCheck: sales ? 'NOT_CHECKED' : 'WMS',
      code: p.code,
      name: p.name,
      unit: p.unit,
      source: 'MANUAL',
      stages: [...new Set(ms.map((m) => m.stageKey))],
      demandType: header.demandType,
      grossRequirement: r2(gross),
      scrapAllowance: r2(scrap),
      totalRequirement: total,
      onHand: p.available,
      reserved: p.reserved,
      safetyStock: p.minimumStock,
      pendingRequestDemand: pending,
      otherPlanDemand: p.otherPlanDemand,
      netAvailable,
      netRequirement,
      inbound,
      eligibleInbound,
      shortage,
      requiredByDate: requiredBy,
      coverageDate,
      arrivesInTime,
      leadTimeDays,
      orderByDate,
      orderDatePassed,
      suggestedReplenishment: suggested,
      unitCost,
      unitCostSource,
      totalCost: unitCost === null ? null : r2(unitCost * total),
      explanation: parts.join(' '),
    });
  }

  const readyByStage = new Map<string, string | null>();
  for (const m of inp.materials) {
    const cov = coverageByProduct.get(materialKey(m)) ?? null;
    const prev = readyByStage.get(m.stageKey);
    if (prev === null) continue; // already unknown
    if (cov === null) readyByStage.set(m.stageKey, null);
    else if (prev === undefined || daysBetween(prev, cov) > 0)
      readyByStage.set(m.stageKey, cov);
  }
  return { lines, readyByStage, missing };
}
