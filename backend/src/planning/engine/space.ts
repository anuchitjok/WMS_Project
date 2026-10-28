import { r2 } from './workflow';
import {
  DataSnapshot,
  Issue,
  MaterialResult,
  ScenarioInputs,
  SpaceLine,
  StageResult,
} from './types';

const EPS = 1e-9;
const ceil = (n: number) => Math.ceil(n - EPS);

export interface SpaceOut {
  lines: SpaceLine[];
  inboundPallets: number | null;
  outboundPallets: number | null;
  missing: Issue[];
}

function status(
  required: number | null,
  available: number | null,
  riskPct: number,
): Pick<SpaceLine, 'utilizationPct' | 'shortfall' | 'status'> {
  if (required === null || available === null)
    return { utilizationPct: null, shortfall: null, status: 'INCOMPLETE' };
  const util =
    available > 0
      ? r2((required / available) * 100)
      : required > 0
        ? Infinity
        : 0;
  const shortfall = r2(Math.max(0, required - available));
  return {
    utilizationPct: Number.isFinite(util) ? util : null,
    shortfall,
    status: shortfall > 0 ? 'SHORTAGE' : util > riskPct ? 'RISK' : 'OK',
  };
}

/**
 * Storage (rack/pallet positions), receiving and dispatch staging, and work
 * area are kept separate — they are different physical spaces. Nothing is
 * estimated when a dimension is missing: the line is marked INCOMPLETE.
 */
export function planSpace(
  inp: ScenarioInputs,
  data: DataSnapshot,
  stages: StageResult[],
  receivedUnits: number,
  lineThroughputPerDay: number,
  materials: MaterialResult[],
): SpaceOut {
  const sp = inp.space;
  const lay = data.layout;
  const missing: Issue[] = [];
  const Q = inp.quantity;
  const unitsPerPallet =
    sp.unitsPerCarton && sp.cartonsPerPallet
      ? sp.unitsPerCarton * sp.cartonsPerPallet
      : null;
  const palletArea =
    sp.palletLengthM && sp.palletWidthM
      ? sp.palletLengthM * sp.palletWidthM
      : null;
  if (unitsPerPallet === null)
    missing.push({
      area: 'SPACE',
      message:
        'Units per carton and cartons per pallet are not entered (Product Master has no packaging data)',
    });
  if (palletArea === null)
    missing.push({
      area: 'SPACE',
      message:
        'Pallet dimensions are not entered — staging and work areas cannot be sized',
    });
  const inPerDay = (lineThroughputPerDay * receivedUnits) / Q; // units entering per day at line pace
  const lines: SpaceLine[] = [];

  // ── Storage ────────────────────────────────────────────────────────────────
  const storedUnits =
    sp.receiptPattern === 'ALL_AT_START'
      ? receivedUnits
      : ceil(inPerDay * sp.storageDwellDays);
  const projectPallets = unitsPerPallet
    ? ceil(storedUnits / unitsPerPallet)
    : null;
  const incoming = materials.filter((m) => m.netRequirement > 0);
  const matNoPallet = incoming.filter((m) => {
    const line = inp.materials.find(
      (x) => x.productId === m.productId && x.unitsPerPallet,
    );
    return !line;
  });
  const matPallets = incoming.reduce((a, m) => {
    const upp = inp.materials.find(
      (x) => x.productId === m.productId && x.unitsPerPallet,
    )?.unitsPerPallet;
    return upp ? a + ceil(m.netRequirement / upp) : a;
  }, 0);
  if (matNoPallet.length)
    missing.push({
      area: 'SPACE',
      message: `Units per pallet missing for incoming material ${matNoPallet.map((m) => m.code).join(', ')}`,
    });
  const storageReq =
    projectPallets === null || matNoPallet.length
      ? null
      : projectPallets + matPallets;
  const storageAvail =
    sp.overrideStoragePalletPositions ??
    (lay.palletSlotCount > 0 ? lay.palletSlotFreeCapacity : null);
  if (storageAvail === null)
    missing.push({
      area: 'SPACE',
      message:
        'The warehouse has no PALLET or BULK slots defined and no manual storage capacity was entered',
    });
  lines.push({
    key: 'STORAGE',
    label: 'Storage positions',
    unit: 'pallet positions',
    required: storageReq,
    available: storageAvail,
    availableSource:
      sp.overrideStoragePalletPositions !== null
        ? 'MANUAL_OVERRIDE'
        : storageAvail === null
          ? 'MISSING'
          : 'WMS',
    ...status(storageReq, storageAvail, sp.capacityRiskPct),
    formula:
      sp.receiptPattern === 'ALL_AT_START'
        ? 'pallets = ⌈ units received ÷ units per pallet ⌉ + Σ ⌈ incoming material ÷ units per pallet ⌉'
        : 'pallets = ⌈ intake per day × storage dwell days ÷ units per pallet ⌉ + Σ ⌈ incoming material ÷ units per pallet ⌉',
    detail:
      `${storedUnits} units ÷ ${unitsPerPallet ?? '?'} per pallet = ${projectPallets ?? '?'} pallets + ${matPallets} material pallets. ` +
      (sp.overrideStoragePalletPositions !== null
        ? `Available entered manually: ${storageAvail}.`
        : `Available = free capacity of ${lay.palletSlotCount} active PALLET/BULK slots in the WMS (${lay.palletSlotFreeCapacity}).`),
  });

  // ── Receiving staging ────────────────────────────────────────────────────
  const stagedIn =
    projectPallets === null || unitsPerPallet === null
      ? null
      : sp.receivingDwellDays === 0
        ? 0
        : sp.receiptPattern === 'ALL_AT_START'
          ? projectPallets
          : ceil((inPerDay * sp.receivingDwellDays) / unitsPerPallet);
  const recvReq =
    stagedIn === null || palletArea === null
      ? null
      : r2(ceil(stagedIn / sp.stackLevels) * palletArea);
  const recvAvailWms = lay.receivingAreaM2 ?? lay.stagingAreaM2;
  const recvAvail = sp.overrideReceivingAreaM2 ?? recvAvailWms;
  lines.push({
    key: 'RECEIVING_STAGING',
    label: 'Receiving staging',
    unit: 'm²',
    required: recvReq,
    available: recvAvail,
    availableSource:
      sp.overrideReceivingAreaM2 !== null
        ? 'MANUAL_OVERRIDE'
        : recvAvail === null
          ? 'MISSING'
          : 'WMS',
    ...status(recvReq, recvAvail, sp.capacityRiskPct),
    formula:
      'm² = ⌈ pallets staged ÷ stack levels ⌉ × pallet length × pallet width',
    detail:
      `${stagedIn ?? '?'} pallets staged for ${sp.receivingDwellDays} day(s), stacked ${sp.stackLevels} high, ${palletArea === null ? '?' : r2(palletArea)} m² each. ` +
      (sp.overrideReceivingAreaM2 !== null
        ? 'Available entered manually.'
        : lay.receivingAreaM2 !== null
          ? 'Available = RECEIVING_AREA objects on the Floor Plan.'
          : lay.stagingAreaM2 !== null
            ? 'No RECEIVING_AREA on the Floor Plan — general STAGING_AREA used.'
            : 'No receiving area on the Floor Plan.'),
  });
  if (recvAvail === null)
    missing.push({
      area: 'SPACE',
      message:
        'No receiving area is drawn on the Floor Plan (in metres) and none was entered',
    });

  // ── Dispatch staging ─────────────────────────────────────────────────────
  const stagedOut =
    unitsPerPallet === null
      ? null
      : sp.dispatchDwellDays === 0
        ? 0
        : ceil((lineThroughputPerDay * sp.dispatchDwellDays) / unitsPerPallet);
  const dispReq =
    stagedOut === null || palletArea === null
      ? null
      : r2(ceil(stagedOut / sp.stackLevels) * palletArea);
  const dispAvail =
    sp.overrideDispatchAreaM2 ?? lay.dispatchAreaM2 ?? lay.stagingAreaM2;
  lines.push({
    key: 'DISPATCH_STAGING',
    label: 'Dispatch staging',
    unit: 'm²',
    required: dispReq,
    available: dispAvail,
    availableSource:
      sp.overrideDispatchAreaM2 !== null
        ? 'MANUAL_OVERRIDE'
        : dispAvail === null
          ? 'MISSING'
          : 'WMS',
    ...status(dispReq, dispAvail, sp.capacityRiskPct),
    formula:
      'm² = ⌈ ⌈ output per day × dispatch dwell days ÷ units per pallet ⌉ ÷ stack levels ⌉ × pallet area',
    detail: `${r2(lineThroughputPerDay)} units/day × ${sp.dispatchDwellDays} day(s) ÷ ${unitsPerPallet ?? '?'} = ${stagedOut ?? '?'} pallets.`,
  });
  if (dispAvail === null)
    missing.push({
      area: 'SPACE',
      message:
        'No shipping/dispatch area is drawn on the Floor Plan (in metres) and none was entered',
    });

  // ── Work area (benches + WIP queues) ─────────────────────────────────────
  const noBench = inp.stages.filter((s) => s.benchAreaM2 === null);
  const bench = inp.stages.reduce(
    (a, s) => a + s.workstations * (s.benchAreaM2 ?? 0),
    0,
  );
  const queuePallets =
    unitsPerPallet === null
      ? null
      : stages.reduce((a, s) => a + ceil(s.queueEstimate / unitsPerPallet), 0);
  const wipM2 =
    queuePallets === null || palletArea === null
      ? null
      : ceil(queuePallets / sp.stackLevels) * palletArea;
  const workReq = noBench.length || wipM2 === null ? null : r2(bench + wipM2);
  if (noBench.length)
    missing.push({
      area: 'SPACE',
      message: `Bench area per workstation missing for: ${noBench.map((s) => s.name).join(', ')}`,
    });
  const workAvail = sp.overrideWorkAreaM2 ?? lay.workAreaM2;
  lines.push({
    key: 'WORK_AREA',
    label: 'Work area (benches + WIP)',
    unit: 'm²',
    required: workReq,
    available: workAvail,
    availableSource:
      sp.overrideWorkAreaM2 !== null
        ? 'MANUAL_OVERRIDE'
        : workAvail === null
          ? 'MISSING'
          : 'WMS',
    ...status(workReq, workAvail, sp.capacityRiskPct),
    formula:
      'm² = Σ workstations × bench m² + ⌈ WIP queue pallets ÷ stack levels ⌉ × pallet area',
    detail: `Benches ${r2(bench)} m² + WIP ${queuePallets ?? '?'} pallets (${wipM2 === null ? '?' : r2(wipM2)} m²). Available = WORK_AREA / QC_AREA on the Floor Plan unless entered manually.`,
  });
  if (workAvail === null)
    missing.push({
      area: 'SPACE',
      message:
        'No work or QC area is drawn on the Floor Plan (in metres) and none was entered',
    });

  const outboundPallets = unitsPerPallet ? ceil(Q / unitsPerPallet) : null;
  return {
    lines,
    inboundPallets:
      projectPallets === null ? null : projectPallets + matPallets,
    outboundPallets,
    missing,
  };
}
