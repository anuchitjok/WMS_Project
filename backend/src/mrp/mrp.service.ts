import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { customAlphabet } from 'nanoid';

// Run suffix: upper-case letters and digits only (no '-' or '_', no case-folding collisions).
const runSuffix = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS, AccessPrincipal, hasAccess } from '../auth/access';
import { ScopePrincipal, scopedWarehouseIds } from '../common/warehouse-scope';
import { MrpDataService } from './mrp-data.service';
import { MrpConfigShape, methodSpec } from './engine/config';
import { backtest } from './engine/accuracy';
import { FORECAST_METHODS, forecast } from './engine/forecast';
import { MaterialPlan, MaterialSnapshot, planMaterial } from './engine/material';
import { Granularity, periodStart } from './engine/periods';
import { buildSeries, comparePeriods, round, usageStats } from './engine/usage';

export type Principal = AccessPrincipal & ScopePrincipal & { id: string };

const NULLABLE_SORT = new Set(['estCost', 'suggestedOrderDate']);
const LINE_SORT = new Set(['urgency', 'sku', 'suggestedQty', 'projectedShortage', 'netReq', 'available', 'onHand', 'forecastQty', 'estCost', 'suggestedOrderDate', 'openPoQty']);

@Injectable()
export class MrpService {
  constructor(
    private prisma: PrismaService,
    private data: MrpDataService,
  ) {}

  canSeeCost(u: Principal) {
    return hasAccess(u, ACCESS.mrpCost);
  }

  /** Warehouses a run covers for this principal; refuses a warehouse outside their scope. */
  private runScope(u: Principal, warehouseId?: string | null): string[] | null {
    const scope = scopedWarehouseIds(u);
    if (warehouseId) {
      if (scope && !scope.includes(warehouseId)) throw new ForbiddenException('You do not have access to this warehouse');
      return [warehouseId];
    }
    return scope;
  }

  /** A run is visible when everything it covered is inside the viewer's scope. */
  private assertRunVisible(u: Principal, run: { scope: Prisma.JsonValue }) {
    const viewer = scopedWarehouseIds(u);
    if (!viewer) return;
    const covered = run.scope as string[] | null;
    if (!covered || covered.some((w) => !viewer.includes(w))) throw new ForbiddenException('This plan covers warehouses outside your access');
  }

  private visibleRunFilter(u: Principal): (r: { scope: Prisma.JsonValue }) => boolean {
    const viewer = scopedWarehouseIds(u);
    return (r) => {
      if (!viewer) return true;
      const covered = r.scope as string[] | null;
      return !!covered && covered.every((w) => viewer.includes(w));
    };
  }

  // ── Runs ────────────────────────────────────────────────────────────────
  async run(u: Principal, dto: { warehouseId?: string; asOf?: string; note?: string }) {
    const started = Date.now();
    const asOf = dto.asOf ? new Date(dto.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('Invalid asOf');
    if (dto.warehouseId) {
      const wh = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId }, select: { id: true } });
      if (!wh) throw new NotFoundException('Warehouse not found');
    }
    const scope = this.runScope(u, dto.warehouseId);
    const { config, version } = await this.data.loadConfig();
    const { snapshots, warnings } = await this.data.buildSnapshots({ asOf, warehouseId: dto.warehouseId ?? null, scope }, config);
    const plans = snapshots.map((s) => ({ s, p: planMaterial(s, config) }));
    const inputHash = hashInputs(config, snapshots);
    const summary = this.summarise(plans, config);

    const runNumber = `MRP-${asOf.toISOString().slice(0, 10).replace(/-/g, '')}-${runSuffix()}`;
    const run = await this.prisma.$transaction(async (tx) => {
      const r = await tx.mrpRun.create({
        data: {
          runNumber, asOf, warehouseId: dto.warehouseId ?? null, scope: (scope ?? null) as Prisma.InputJsonValue,
          params: { warehouseId: dto.warehouseId ?? null, asOf: asOf.toISOString() },
          configSnapshot: config as unknown as Prisma.InputJsonValue, configVersion: version, inputHash,
          lineCount: plans.length, summary: summary as unknown as Prisma.InputJsonValue,
          warnings: warnings as unknown as Prisma.InputJsonValue, note: dto.note ?? null, startedById: u.id,
          completedAt: new Date(), durationMs: Date.now() - started,
        },
      });
      if (plans.length) {
        await tx.mrpRunLine.createMany({ data: plans.map(({ s, p }) => this.toLine(r.id, s, p)) });
      }
      await tx.auditLog.create({
        data: {
          userId: u.id, action: 'MRP_RUN', entityType: 'MrpRun', entityId: r.id,
          detail: JSON.stringify({ runNumber, asOf: asOf.toISOString(), warehouseId: dto.warehouseId ?? null, lines: plans.length, inputHash, configVersion: version }),
        },
      });
      return r;
    });
    return this.getRun(u, run.id);
  }

  private toLine(runId: string, s: MaterialSnapshot, p: MaterialPlan): Prisma.MrpRunLineCreateManyInput {
    return {
      runId, productId: s.productId, warehouseId: s.warehouseId, sku: s.sku, description: s.description, category: s.category,
      planningStatus: p.planningStatus, urgency: p.urgency, forecastMethod: p.forecastMethod, forecastQty: round(p.forecastFinal.reduce((a, b) => a + b, 0)),
      avgMonthlyUsage: p.usage.stats.avgMonthly, movementClass: p.classification.movement,
      onHand: p.position.onHand, available: p.position.available, allocated: p.position.allocated, blocked: p.position.blocked + p.position.inspection,
      safetyStock: p.safetyStock, openPoQty: p.supply.openQty, nextInboundDate: p.supply.nextInboundDate ? new Date(p.supply.nextInboundDate) : null,
      grossReq: p.plan.totals.gross, netReq: p.plan.totals.net, projectedShortage: p.plan.maxShortage, suggestedQty: p.suggested.qty,
      suggestedOrderDate: p.suggested.orderDate ? new Date(p.suggested.orderDate) : null,
      requiredDate: p.suggested.requiredDate ? new Date(p.suggested.requiredDate) : null,
      leadTimeDays: p.leadTimeDays, moq: p.moq, orderMultiple: p.orderMultiple,
      vendorId: s.supplier?.vendorId ?? null, vendorName: s.supplier?.vendorName ?? null,
      unitCost: p.cost.unitCost, currency: p.cost.currency, costSource: p.cost.source, estCost: p.cost.estimatedCost,
      exceptionCodes: p.exceptions.map((e) => e.code),
      detail: { snapshot: s, plan: p } as unknown as Prisma.InputJsonValue,
    };
  }

  private summarise(plans: Array<{ s: MaterialSnapshot; p: MaterialPlan }>, cfg: MrpConfigShape) {
    const count = (f: (x: { s: MaterialSnapshot; p: MaterialPlan }) => boolean) => plans.filter(f).length;
    const byException: Record<string, number> = {};
    for (const { p } of plans) for (const e of p.exceptions) byException[e.code] = (byException[e.code] ?? 0) + 1;
    const byMovement: Record<string, number> = {};
    for (const { p } of plans) byMovement[p.classification.movement] = (byMovement[p.classification.movement] ?? 0) + 1;
    // Estimated replenishment cost per currency — never added across currencies.
    const costByCurrency: Record<string, { first: number; horizon: number; lines: number }> = {};
    let linesWithoutCost = 0;
    for (const { p } of plans) {
      if (p.suggested.qty <= 0) continue;
      if (p.cost.unitCost === null) { linesWithoutCost += 1; continue; }
      const k = p.cost.currency ?? 'UNSPECIFIED';
      const c = (costByCurrency[k] ??= { first: 0, horizon: 0, lines: 0 });
      c.first = round(c.first + (p.cost.estimatedCost ?? 0), 2);
      c.horizon = round(c.horizon + (p.cost.horizonCost ?? 0), 2);
      c.lines += 1;
    }
    // Pooled forecast accuracy of the chosen method across materials with a sufficient back-test.
    let absErr = 0; let actual = 0; let n = 0; let materials = 0;
    for (const { p } of plans) {
      const a = p.accuracy.find((x) => x.method === p.forecastMethod);
      if (!a?.sufficient) continue;
      materials += 1;
      for (const pt of a.points) { absErr += Math.abs(pt.forecast - pt.actual); actual += pt.actual; n += 1; }
    }
    const series = new Map<string, number>();
    const fcast = new Map<string, number>();
    for (const { p } of plans) {
      for (const pt of p.usage.series.points) series.set(pt.start, round((series.get(pt.start) ?? 0) + pt.qty));
      p.plan.buckets.forEach((b) => fcast.set(b.start, round((fcast.get(b.start) ?? 0) + b.forecast)));
    }
    return {
      materials: plans.length,
      planned: count(({ p }) => p.planningStatus !== 'NOT_PLANNED'),
      orderNow: count(({ p }) => p.planningStatus === 'ORDER_NOW'),
      plannedLater: count(({ p }) => p.planningStatus === 'PLANNED'),
      notPlanned: count(({ p }) => p.planningStatus === 'NOT_PLANNED'),
      belowSafetyStock: count(({ p }) => p.planningStatus !== 'NOT_PLANNED' && p.position.usable < p.safetyStock),
      projectedShortage: count(({ p }) => p.planningStatus !== 'NOT_PLANNED' && !!p.plan.firstShortage),
      lateOrders: count(({ p }) => p.suggested.late),
      overduePoLines: plans.reduce((a, { p }) => a + p.supply.lines.filter((l) => l.overdue).length, 0),
      missingParameters: byException.MISSING_PARAMETERS ?? 0,
      byException,
      byMovement,
      excessMaterials: count(({ p }) => (p.classification.excessQty ?? 0) > 0),
      potentialObsolete: count(({ p }) => p.classification.potentialObsolete),
      costByCurrency,
      linesWithoutCost,
      accuracy: { method: 'pooled WAPE of each material\'s chosen method', materials, points: n, wape: actual > 0 ? round(absErr / actual, 4) : null },
      usageTrend: [...series.entries()].sort().map(([start, qty]) => ({ start, qty })),
      forecastTrend: [...fcast.entries()].sort().map(([start, qty]) => ({ start, qty })),
      granularity: cfg.granularity,
      thresholdsApproved: cfg.thresholdsApproved,
    };
  }

  async listRuns(u: Principal, limit = 30) {
    const runs = await this.prisma.mrpRun.findMany({
      orderBy: { startedAt: 'desc' }, take: 200,
      select: { id: true, runNumber: true, status: true, asOf: true, warehouseId: true, scope: true, lineCount: true, summary: true, warnings: true, note: true, startedById: true, startedAt: true, durationMs: true, inputHash: true, configVersion: true },
    });
    const visible = runs.filter(this.visibleRunFilter(u)).slice(0, limit);
    const users = await this.prisma.user.findMany({ where: { id: { in: visible.map((r) => r.startedById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const name = new Map(users.map((x) => [x.id, x.fullName]));
    const cost = this.canSeeCost(u);
    return visible.map((r) => ({ ...r, summary: cost ? r.summary : this.redactSummary(r.summary), startedBy: r.startedById ? name.get(r.startedById) ?? null : null }));
  }

  private redactSummary(s: Prisma.JsonValue) {
    const o = { ...(s as Record<string, unknown>) };
    delete o.costByCurrency;
    delete o.linesWithoutCost;
    return o;
  }

  async getRun(u: Principal, id: string) {
    const run = await this.prisma.mrpRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Planning run not found');
    this.assertRunVisible(u, run);
    return { ...run, summary: this.canSeeCost(u) ? run.summary : this.redactSummary(run.summary) };
  }

  async latestRun(u: Principal) {
    const runs = await this.prisma.mrpRun.findMany({ orderBy: { startedAt: 'desc' }, take: 50, select: { id: true, scope: true } });
    const r = runs.find(this.visibleRunFilter(u));
    return r ? this.getRun(u, r.id) : null;
  }

  async lines(u: Principal, runId: string, q: Record<string, string | undefined>) {
    await this.getRun(u, runId);
    const where: Prisma.MrpRunLineWhereInput = { runId };
    if (q.status) where.planningStatus = q.status;
    if (q.exception) where.exceptionCodes = { has: q.exception };
    if (q.movement) where.movementClass = q.movement;
    if (q.category) where.category = q.category;
    if (q.vendorId) where.vendorId = q.vendorId;
    if (q.search) where.OR = [{ sku: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }, { vendorName: { contains: q.search, mode: 'insensitive' } }];
    if (q.actionOnly === 'true') where.suggestedQty = { gt: 0 };
    const cost = this.canSeeCost(u);
    let sort = q.sort && LINE_SORT.has(q.sort) ? q.sort : 'urgency';
    if (sort === 'estCost' && !cost) sort = 'urgency';
    const order: Prisma.SortOrder = q.order === 'asc' ? 'asc' : q.order === 'desc' ? 'desc' : sort === 'sku' ? 'asc' : 'desc';
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const [total, rows] = await Promise.all([
      this.prisma.mrpRunLine.count({ where }),
      this.prisma.mrpRunLine.findMany({
        where, orderBy: [NULLABLE_SORT.has(sort) ? { [sort]: { sort: order, nulls: 'last' } } : { [sort]: order }, { sku: 'asc' }], skip: (page - 1) * pageSize, take: pageSize,
        omit: { detail: true },
      }),
    ]);
    return { total, page, pageSize, canSeeCost: cost, data: rows.map((r) => (cost ? r : this.redactLine(r))) };
  }

  private redactLine<T extends Record<string, unknown>>(r: T): T {
    return { ...r, unitCost: null, estCost: null, costSource: null, currency: null };
  }

  async line(u: Principal, runId: string, lineId: string) {
    await this.getRun(u, runId);
    const line = await this.prisma.mrpRunLine.findFirst({ where: { id: lineId, runId } });
    if (!line) throw new NotFoundException('Plan line not found');
    if (this.canSeeCost(u)) return line;
    const detail = JSON.parse(JSON.stringify(line.detail)) as { snapshot: MaterialSnapshot; plan: MaterialPlan };
    detail.plan.cost = { unitCost: null, currency: null, source: null, label: 'Hidden (no cost permission)', estimatedCost: null, horizonCost: null };
    detail.plan.alternatives = detail.plan.alternatives.map((a) => ({ ...a, unitPrice: null, cost: null, currency: null }));
    detail.snapshot.productUnitCost = null;
    if (detail.snapshot.params) detail.snapshot.params = { ...detail.snapshot.params, unitCost: null, currency: null };
    for (const s of [detail.snapshot.supplier, ...detail.snapshot.alternatives]) if (s) { s.unitPrice = null; s.currency = null; }
    detail.snapshot.poLines = detail.snapshot.poLines.map((l) => ({ ...l, unitCost: null, currency: null }));
    return { ...this.redactLine(line), detail };
  }

  /** Recalculates every line from its stored snapshot + the run's stored config and reports differences. */
  async verify(u: Principal, runId: string) {
    const run = await this.getRun(u, runId);
    const lines = await this.prisma.mrpRunLine.findMany({ where: { runId }, select: { id: true, sku: true, suggestedQty: true, netReq: true, grossReq: true, projectedShortage: true, planningStatus: true, detail: true } });
    const cfg = run.configSnapshot as unknown as MrpConfigShape;
    const mismatches: Array<{ sku: string; field: string; stored: unknown; recalculated: unknown }> = [];
    for (const l of lines) {
      const d = l.detail as unknown as { snapshot: MaterialSnapshot };
      const p = planMaterial(d.snapshot, cfg);
      const check: Array<[string, unknown, unknown]> = [
        ['suggestedQty', l.suggestedQty, p.suggested.qty], ['netReq', l.netReq, p.plan.totals.net],
        ['grossReq', l.grossReq, p.plan.totals.gross], ['projectedShortage', l.projectedShortage, p.plan.maxShortage],
        ['planningStatus', l.planningStatus, p.planningStatus],
      ];
      for (const [field, a, b] of check) if (a !== b) mismatches.push({ sku: l.sku, field, stored: a, recalculated: b });
    }
    const hash = hashInputs(cfg, lines.map((l) => (l.detail as unknown as { snapshot: MaterialSnapshot }).snapshot));
    return { runId, lines: lines.length, reproducible: mismatches.length === 0, mismatches, inputHashMatches: hash === run.inputHash };
  }

  async compare(u: Principal, baseId: string, targetId: string) {
    const [base, target] = await Promise.all([this.getRun(u, baseId), this.getRun(u, targetId)]);
    const pick = { productId: true, warehouseId: true, sku: true, description: true, planningStatus: true, suggestedQty: true, netReq: true, forecastQty: true, available: true, openPoQty: true, exceptionCodes: true, suggestedOrderDate: true } as const;
    const [a, b] = await Promise.all([
      this.prisma.mrpRunLine.findMany({ where: { runId: baseId }, select: pick }),
      this.prisma.mrpRunLine.findMany({ where: { runId: targetId }, select: pick }),
    ]);
    // Runs of different scope (network vs one warehouse) are compared material by material.
    const scopeChanged = (base.warehouseId ?? null) !== (target.warehouseId ?? null);
    const key = (x: { productId: string; warehouseId: string | null }) => (scopeChanged ? x.productId : `${x.productId}|${x.warehouseId ?? ''}`);
    const am = new Map(a.map((x) => [key(x), x]));
    const bm = new Map(b.map((x) => [key(x), x]));
    const changes: Array<Record<string, unknown>> = [];
    for (const k of new Set([...am.keys(), ...bm.keys()])) {
      const x = am.get(k);
      const y = bm.get(k);
      if (!x || !y) { changes.push({ sku: (x ?? y)!.sku, description: (x ?? y)!.description, change: x ? 'REMOVED' : 'ADDED', base: x ?? null, target: y ?? null }); continue; }
      const diff: string[] = [];
      if (x.planningStatus !== y.planningStatus) diff.push('status');
      if (x.suggestedQty !== y.suggestedQty) diff.push('suggestedQty');
      if (x.netReq !== y.netReq) diff.push('netReq');
      if (x.forecastQty !== y.forecastQty) diff.push('forecast');
      if (x.available !== y.available) diff.push('available');
      if (x.openPoQty !== y.openPoQty) diff.push('openPo');
      const added = y.exceptionCodes.filter((c) => !x.exceptionCodes.includes(c));
      const cleared = x.exceptionCodes.filter((c) => !y.exceptionCodes.includes(c));
      if (added.length || cleared.length) diff.push('exceptions');
      if (diff.length) changes.push({ sku: x.sku, description: x.description, change: 'CHANGED', fields: diff, base: x, target: y, exceptionsAdded: added, exceptionsCleared: cleared, suggestedQtyDelta: round(y.suggestedQty - x.suggestedQty) });
    }
    return {
      base: { id: base.id, runNumber: base.runNumber, asOf: base.asOf, warehouseId: base.warehouseId, configVersion: base.configVersion, inputHash: base.inputHash },
      target: { id: target.id, runNumber: target.runNumber, asOf: target.asOf, warehouseId: target.warehouseId, configVersion: target.configVersion, inputHash: target.inputHash },
      sameInputs: base.inputHash === target.inputHash,
      scopeChanged,
      configChanged: JSON.stringify(base.configSnapshot) !== JSON.stringify(target.configSnapshot),
      changes: changes.sort((p, q) => String(p.sku).localeCompare(String(q.sku))),
    };
  }

  async exportCsv(u: Principal, runId: string): Promise<{ filename: string; csv: string }> {
    const run = await this.getRun(u, runId);
    const lines = await this.prisma.mrpRunLine.findMany({ where: { runId }, orderBy: [{ urgency: 'desc' }, { sku: 'asc' }], omit: { detail: true } });
    const cost = this.canSeeCost(u);
    const cols: Array<[string, (l: (typeof lines)[number]) => unknown]> = [
      ['SKU', (l) => l.sku], ['Description', (l) => l.description], ['Category', (l) => l.category], ['Warehouse', (l) => l.warehouseId ?? 'ALL'],
      ['Supplier', (l) => l.vendorName], ['Planning status', (l) => l.planningStatus], ['Avg monthly usage', (l) => l.avgMonthlyUsage],
      ['Forecast method', (l) => l.forecastMethod], ['Forecast qty (horizon)', (l) => l.forecastQty], ['On hand', (l) => l.onHand],
      ['Available', (l) => l.available], ['Allocated', (l) => l.allocated], ['Blocked/inspection', (l) => l.blocked], ['Safety stock', (l) => l.safetyStock],
      ['Open PO qty', (l) => l.openPoQty], ['Next inbound', (l) => iso(l.nextInboundDate)], ['Gross requirement', (l) => l.grossReq],
      ['Net requirement', (l) => l.netReq], ['Projected shortage', (l) => l.projectedShortage], ['Suggested order qty', (l) => l.suggestedQty],
      ['Suggested order date', (l) => iso(l.suggestedOrderDate)], ['Required arrival', (l) => iso(l.requiredDate)], ['Lead time (days)', (l) => l.leadTimeDays],
      ['MOQ', (l) => l.moq], ['Order multiple', (l) => l.orderMultiple],
      ...(cost ? ([['Unit cost (estimate)', (l) => l.unitCost], ['Currency', (l) => l.currency], ['Cost source', (l) => l.costSource], ['Estimated cost', (l) => l.estCost]] as Array<[string, (l: (typeof lines)[number]) => unknown]>) : []),
      ['Exceptions', (l) => l.exceptionCodes.join(' ')],
    ];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.map(([h]) => h).join(','), ...lines.map((l) => cols.map(([, f]) => esc(f(l))).join(','))].join('\n');
    await this.prisma.auditLog.create({ data: { userId: u.id, action: 'MRP_EXPORT', entityType: 'MrpRun', entityId: runId, detail: `${run.runNumber} (${lines.length} lines, cost ${cost ? 'included' : 'excluded'})` } });
    return { filename: `${run.runNumber}.csv`, csv };
  }

  // ── Dashboard ──────────────────────────────────────────────────────────
  async dashboard(u: Principal) {
    const run = await this.latestRun(u);
    const scope = scopedWarehouseIds(u);
    const today = new Date();
    const overdue = await this.prisma.inboundSupplyLine.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL'] }, expectedDate: { lt: today }, ...(scope ? { warehouseId: { in: scope } } : {}) },
      orderBy: { expectedDate: 'asc' }, take: 10,
    });
    const products = await this.prisma.product.findMany({ where: { id: { in: overdue.map((o) => o.productId) } }, select: { id: true, code: true } });
    const code = new Map(products.map((p) => [p.id, p.code]));
    const cost = this.canSeeCost(u);
    const urgent = run
      ? await this.prisma.mrpRunLine.findMany({
          where: { runId: run.id, planningStatus: 'ORDER_NOW' }, orderBy: [{ urgency: 'desc' }, { sku: 'asc' }], take: 10, omit: { detail: true },
        })
      : [];
    return {
      run,
      urgent: urgent.map((l) => (cost ? l : this.redactLine(l))),
      overduePo: overdue.map((o) => ({
        id: o.id, poNumber: o.poNumber, lineNumber: o.lineNumber, sku: code.get(o.productId) ?? o.productId, vendorName: o.vendorName,
        expectedDate: o.expectedDate, outstanding: round(o.orderedQty - o.cancelledQty - o.receivedQty), isConfirmed: o.isConfirmed,
      })),
      canSeeCost: cost,
    };
  }

  // ── Analysis (live, single material) ──────────────────────────────────
  private async single(u: Principal, productId: string, warehouseId?: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const scope = this.runScope(u, warehouseId);
    const { config } = await this.data.loadConfig();
    const { snapshots, warnings } = await this.data.buildSnapshots({ asOf: new Date(), warehouseId: warehouseId ?? null, scope, productIds: [productId] }, config);
    return { snapshot: snapshots[0], config, warnings };
  }

  async usage(u: Principal, productId: string, q: { warehouseId?: string; granularity?: string; periods?: string }) {
    const g = (['DAY', 'WEEK', 'MONTH'].includes(q.granularity ?? '') ? q.granularity : 'MONTH') as Granularity;
    const periods = Math.min(g === 'DAY' ? 366 : 156, Math.max(2, Number(q.periods) || (g === 'MONTH' ? 24 : g === 'WEEK' ? 26 : 60)));
    const { snapshot, config, warnings } = await this.single(u, productId, q.warehouseId);
    const asOf = new Date(snapshot.asOf);
    // The snapshot holds the configured history window; reload events for the requested window.
    const scope = this.runScope(u, q.warehouseId);
    const opts = { asOf, warehouseId: q.warehouseId ?? null, scope, productIds: [productId] };
    const from = periodsBack(asOf, g, periods);
    const raw = await this.data.usageEvents(opts, from);
    const firstIso = (await this.data.firstUsageInWindow(opts, from, raw)).get(productId);
    const first = firstIso ? new Date(firstIso) : null;
    const events = raw.map((e) => ({ ...e, date: new Date(e.date) }));
    const series = buildSeries(events, asOf, periods, g, config.usageBasis, first);
    const confirmed = buildSeries(events, asOf, periods, g, 'CONFIRMED_USAGE', first);
    const issues = events.filter((e) => e.kind === 'ISSUE').reduce((a, e) => a + e.qty, 0);
    const returns = events.filter((e) => e.kind === 'RETURN').reduce((a, e) => a + e.qty, 0);
    const consumed = events.filter((e) => e.kind === 'CONSUMED').reduce((a, e) => a + e.qty, 0);
    return {
      product: { id: snapshot.productId, sku: snapshot.sku, description: snapshot.description, unit: snapshot.unit },
      granularity: g,
      basis: config.usageBasis,
      series,
      confirmedSeries: confirmed,
      stats: usageStats(series, config.pattern),
      comparisons: comparePeriods(series),
      totals: { issues: round(issues), unusedReturns: round(returns), confirmedConsumption: round(consumed), repairRelated: round(consumed) },
      sources: events.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 200).map((e) => ({ date: e.date.toISOString(), kind: e.kind, qty: e.qty, ref: e.ref, warehouseId: e.warehouseId })),
      notes: [
        'Usage = goods issued at shipment dispatch, minus unused goods returned to stock (NET_ISSUES), or only usage confirmed as USED (CONFIRMED_USAGE).',
        'Receipts, transfers, adjustments and PO quantities are never counted as usage.',
        'Confirmed consumption is usage reported against an RMA case, so it is the repair-related consumption.',
        'History starts at the first recorded goods issue: periods before it are left out rather than counted as zero demand.',
        ...warnings,
      ],
    };
  }

  async forecastWorkbench(u: Principal, productId: string, warehouseId?: string) {
    const { snapshot, config, warnings } = await this.single(u, productId, warehouseId);
    const plan = planMaterial(snapshot, config);
    const history = plan.usage.series.points.map((p) => p.qty);
    const methods = FORECAST_METHODS.map((m) => ({
      ...forecast(history, methodSpec(config, m), config.horizonPeriods),
      accuracy: backtest(history, methodSpec(config, m), config.accuracy.evalPeriods, config.accuracy.minPoints),
      chosen: m === plan.forecastMethod,
    }));
    const overrides = await this.prisma.forecastOverride.findMany({ where: { productId, warehouseId: warehouseId ?? null }, orderBy: { periodStart: 'asc' } });
    return {
      product: { id: snapshot.productId, sku: snapshot.sku, description: snapshot.description, unit: snapshot.unit },
      granularity: config.granularity,
      history: plan.usage.series,
      stats: plan.usage.stats,
      chosenMethod: plan.forecastMethod,
      methodSelection: plan.methodSelection,
      methods,
      buckets: plan.plan.buckets.map((b, i) => ({ start: b.start, statistical: plan.forecast.perPeriod[i], final: plan.forecastFinal[i], bucketForecast: b.forecast })),
      overrides,
      overrideRequiresApproval: config.overrideRequiresApproval,
      warnings,
    };
  }

  /** Live plan for one material (same engine as a run, not stored). */
  async preview(u: Principal, productId: string, warehouseId?: string) {
    const { snapshot, config, warnings } = await this.single(u, productId, warehouseId);
    const plan = planMaterial(snapshot, config);
    if (!this.canSeeCost(u)) {
      plan.cost = { unitCost: null, currency: null, source: null, label: 'Hidden (no cost permission)', estimatedCost: null, horizonCost: null };
      plan.alternatives = plan.alternatives.map((a) => ({ ...a, unitPrice: null, cost: null, currency: null }));
    }
    return { plan, warnings, asOf: snapshot.asOf };
  }
}

/** SHA-256 of the run inputs with object keys sorted, so it survives JSONB storage (which reorders keys). */
export function hashInputs(config: unknown, snapshots: MaterialSnapshot[]): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v;
  const sorted = [...snapshots].sort((a, b) => a.sku.localeCompare(b.sku) || a.productId.localeCompare(b.productId));
  return createHash('sha256').update(JSON.stringify(stable({ config, snapshots: sorted }))).digest('hex');
}

function iso(d: Date | null) {
  return d ? d.toISOString().slice(0, 10) : '';
}

function periodsBack(asOf: Date, g: Granularity, n: number): Date {
  const s = periodStart(asOf, g);
  if (g === 'MONTH') return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - n, 1));
  return new Date(s.getTime() - n * (g === 'WEEK' ? 7 : 1) * 86_400_000);
}
