import { RequestStatus, SlotType, StockStatus, UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

// Project Planning through the real API on throwaway Postgres (PGlite).

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('Project Planning', () => {
  let fx: Fixture;
  let manager: TestUser;
  let manager2: TestUser;
  let supervisor: TestUser;
  let staff: TestUser;
  let requester: TestUser;
  let scoped: TestUser;
  let whId: string;
  let otherWhId: string;
  let partId: string;
  let projectId: string;
  let scenarioId: string;

  const fullInputs = (o: Record<string, unknown> = {}) => ({
    quantity: 50,
    calendar: {
      workingDays: [1, 2, 3, 4, 5],
      holidays: [],
      shiftsPerDay: 1,
      hoursPerShift: 8,
      breakMinutesPerShift: 0,
    },
    labor: {
      availableHeadcount: 5,
      absencePct: 0,
      utilizationPct: 100,
      laborRatePerHour: 150,
    },
    stages: [
      {
        key: 'INSP',
        name: 'Inspection',
        dependsOn: [],
        stdMinutesPerUnit: 6,
        workstations: 1,
        operatorsPerStation: 1,
        productivitySource: 'VALIDATED_STANDARD',
        benchAreaM2: 2,
        completionCriteria: 'Diagnosed',
      },
      {
        key: 'REPAIR',
        name: 'Repair',
        dependsOn: ['INSP'],
        stdMinutesPerUnit: 24,
        workstations: 2,
        operatorsPerStation: 1,
        productivitySource: 'VALIDATED_STANDARD',
        benchAreaM2: 3,
        completionCriteria: 'Repaired',
      },
      {
        key: 'QA',
        name: 'QA',
        dependsOn: ['REPAIR'],
        stdMinutesPerUnit: 6,
        workstations: 1,
        operatorsPerStation: 1,
        productivitySource: 'VALIDATED_STANDARD',
        benchAreaM2: 2,
        isQualityGate: true,
        completionCriteria: 'Passed',
      },
    ],
    materials: [
      {
        productId: partId,
        stageKey: 'REPAIR',
        qtyPerUnit: 1,
        scrapPct: 0,
        leadTimeDays: 5,
        unitsPerPallet: 100,
      },
    ],
    space: {
      unitsPerCarton: 5,
      cartonsPerPallet: 10,
      palletLengthM: 1.2,
      palletWidthM: 1,
      stackLevels: 1,
      overrideReceivingAreaM2: 50,
      overrideDispatchAreaM2: 50,
      overrideWorkAreaM2: 50,
    },
    costs: { masterCostCurrency: 'THB' },
    ...o,
  });

  beforeAll(async () => {
    fx = await Fixture.start();
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER);
    manager2 = await fx.user(UserRole.WAREHOUSE_MANAGER);
    supervisor = await fx.user(UserRole.WAREHOUSE_SUPERVISOR);
    staff = await fx.user(UserRole.WAREHOUSE_STAFF);
    requester = await fx.user(UserRole.REQUESTER);
    const { warehouse, rack } = await fx.location();
    whId = warehouse.id;
    await fx.prisma.slot.create({
      data: {
        rackId: rack.id,
        code: 'P1',
        slotType: SlotType.PALLET,
        capacity: 4,
      },
    });
    await fx.prisma.slot.create({
      data: {
        rackId: rack.id,
        code: 'P2',
        slotType: SlotType.PALLET,
        capacity: 4,
      },
    });
    otherWhId = (await fx.location()).warehouse.id;
    scoped = await fx.user(UserRole.WAREHOUSE_MANAGER);
    await fx.prisma.userWarehouse.create({
      data: { userId: scoped.id, warehouseId: otherWhId },
    });

    const part = await fx.product();
    partId = part.id;
    await fx.prisma.product.update({
      where: { id: partId },
      data: { unitCost: 40, minStock: 5 },
    });
    await fx.stock(partId, 30, { warehouseId: whId, serial: false }); // 30 available
    await fx.stock(partId, 4, {
      warehouseId: whId,
      serial: false,
      status: StockStatus.RESERVED,
    }); // already reserved
    await fx.stock(partId, 100, { warehouseId: otherWhId, serial: false }); // another warehouse — must not count
    // A submitted (not yet reserved) request for 3
    await fx.prisma.withdrawalRequest.create({
      data: {
        refNumber: fx.uid('WR'),
        requesterId: requester.id,
        department: 'Service',
        status: RequestStatus.SUBMITTED,
        items: { create: [{ productId: partId, quantityRequested: 3 }] },
      },
    });
  }, 180_000);

  afterAll(async () => {
    await fx?.stop();
  });

  it('only planning roles can create; requesters cannot read', async () => {
    const body = {
      name: 'Repair batch',
      projectType: 'REPAIR',
      warehouseId: whId,
      plannedStart: day(14),
      targetEnd: day(40),
      quantity: 50,
      currency: 'THB',
    };
    expectStatus(await fx.as(staff).post('/planning/projects', body), 403);
    expectStatus(await fx.as(requester).get('/planning/projects'), 403);
    const res = await fx.as(manager).post('/planning/projects', body);
    expectStatus(res, 201);
    projectId = res.body.id;
    expect(res.body.code).toMatch(/^PRJ-\d{8}-\d{4}$/);
    expect(res.body.planStatus).toBe('DRAFT');
  });

  it('creates a baseline scenario from the template without inventing productivity values', async () => {
    const res = await fx.as(manager).get(`/planning/projects/${projectId}`);
    expectStatus(res, 200);
    const base = res.body.scenarios[0];
    scenarioId = base.id;
    expect(base.isBaseline).toBe(true);
    expect(base.inputs.stages.map((s: { name: string }) => s.name)).toEqual([
      'Receiving',
      'Inspection',
      'Repair',
      'QA / Test',
      'Packing',
      'Dispatch',
    ]);
    expect(
      base.inputs.stages.every(
        (s: { stdMinutesPerUnit: unknown; workstations: unknown }) =>
          s.stdMinutesPerUnit === null && s.workstations === null,
      ),
    ).toBe(true);
  });

  it('a template-only scenario reports insufficient data instead of a plan', async () => {
    const res = await fx
      .as(manager)
      .post(
        `/planning/projects/${projectId}/scenarios/${scenarioId}/calculate`,
      );
    expectStatus(res, 201);
    expect(res.body.overallStatus).toBe('INSUFFICIENT_DATA');
    expect(res.body.result.errors.length).toBeGreaterThan(0);
  });

  it('calculates from live WMS data without changing any operational row', async () => {
    const put = await fx
      .as(manager)
      .patch(`/planning/projects/${projectId}/scenarios/${scenarioId}`, {
        inputs: fullInputs(),
        version: 0,
      });
    expectStatus(put, 200);

    const before = {
      stock: await fx.prisma.stockItem.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, status: true, quantity: true, warehouseId: true },
      }),
      requests: await fx.prisma.withdrawalRequest.findMany({
        select: { id: true, status: true, version: true },
      }),
      receiving: await fx.prisma.goodsReceiving.count(),
      tasks: await fx.prisma.fulfillmentTask.count(),
    };
    const res = await fx
      .as(manager)
      .post(
        `/planning/projects/${projectId}/scenarios/${scenarioId}/calculate`,
      );
    expectStatus(res, 201);
    expect(res.body.runNumber).toBe(2);
    const r = res.body.result;
    expect(r.errors).toEqual([]);

    // 50 units, Repair 24 min on 2 stations is the bottleneck: 2 × 8 × 60 ÷ 24 = 40/day
    expect(r.summary.bottleneckStage).toBe('Repair');
    expect(r.summary.lineThroughputPerDay).toBe(40);
    // Labour: 50 × (6 + 24 + 6) ÷ 60 = 30 h
    expect(r.summary.totalLaborHours).toBe(30);

    // Material: need 50. Available here 30 (reserved 4 and the other warehouse's 100 are not counted)
    // − safety 5 − submitted request 3 = 22 → net requirement 28, no inbound → shortage 28
    const m = r.materials[0];
    expect(m.onHand).toBe(30);
    expect(m.reserved).toBe(4);
    expect(m.pendingRequestDemand).toBe(3);
    expect(m.netAvailable).toBe(22);
    expect(m.shortage).toBe(28);
    expect(m.unitCost).toBe(40);
    expect(r.flags).toContain('MATERIAL_SHORTAGE');
    expect(r.overallStatus).toBe('NOT_READY');

    // Storage from the WMS: 2 PALLET slots × capacity 4 = 8 free; need ⌈50 ÷ 50⌉ + ⌈28 ÷ 100⌉ = 2
    const storage = r.space.find((s: { key: string }) => s.key === 'STORAGE');
    expect([
      storage.required,
      storage.available,
      storage.availableSource,
    ]).toEqual([2, 8, 'WMS']);

    const after = {
      stock: await fx.prisma.stockItem.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, status: true, quantity: true, warehouseId: true },
      }),
      requests: await fx.prisma.withdrawalRequest.findMany({
        select: { id: true, status: true, version: true },
      }),
      receiving: await fx.prisma.goodsReceiving.count(),
      tasks: await fx.prisma.fulfillmentTask.count(),
    };
    expect(after).toEqual(before);

    const audit = await fx.prisma.auditLog.findMany({
      where: { entityId: projectId, action: 'PLANNING_CALCULATE' },
    });
    expect(audit.length).toBe(2);
  });

  it('re-verifies a stored run from its own snapshot', async () => {
    const proj = await fx.as(manager).get(`/planning/projects/${projectId}`);
    const runId = proj.body.runs[0].id;
    const res = await fx
      .as(manager)
      .post(`/planning/projects/${projectId}/runs/${runId}/verify`);
    expectStatus(res, 201);
    expect(res.body).toMatchObject({
      inputsIntact: true,
      sameEngine: true,
      resultMatches: true,
    });
  });

  it('customer summary carries the schedule but nothing internal (whitelisted fields only)', async () => {
    const proj = await fx.as(manager).get(`/planning/projects/${projectId}`);
    const [good, insufficient] = proj.body.runs;
    const url = (rid: string) =>
      `/planning/projects/${projectId}/runs/${rid}/customer-summary`;
    expectStatus(await fx.as(requester).get(url(good.id)), 403);
    expectStatus(await fx.as(manager).get(url(insufficient.id)), 400);

    const res = await fx.as(manager).get(url(good.id));
    expectStatus(res, 200);
    const s = res.body;
    expect(s.project.name).toBe('Repair batch');
    expect(s.quantity).toBe(50);
    expect(s.estimatedFinish).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.outputPerDay).toBe(40);
    expect(s.stages.map((x: { name: string }) => x.name)).toEqual([
      'Inspection',
      'Repair',
      'QA',
    ]);
    expect(s.stages[2].isQualityGate).toBe(true);
    expect(s.notes.join(' ')).toContain('Mon, Tue, Wed, Thu, Fri');

    // Every key in the payload is on the whitelist — nothing about cost, stock or warehouse.
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
    };
    walk(s);
    const allowed = [
      'runId', 'runNumber', 'scenarioName', 'stale', 'asOf', 'generatedAt',
      'preparedBy', 'project', 'code', 'name', 'projectType', 'customer',
      'scope', 'product', 'quantity', 'plannedStart', 'targetEnd',
      'estimatedFinish', 'meetsTarget', 'durationWorkingDays', 'outputPerDay',
      'teamSize', 'shiftsPerDay', 'stages', 'startDate', 'finishDate',
      'workingDays', 'isQualityGate', 'completionCriteria', 'notes', 'quote',
      'price', 'pricePerUnit', 'currency', 'vatPct', 'vatAmount',
      'priceIncludingVat', 'validUntil', 'complete',
      // Proposal: document status, provider identity, contact and wording.
      'purpose', 'planApproved', 'company', 'legalName', 'address', 'phone',
      'email', 'website', 'taxId', 'hasLogo', 'contact', 'deliverables',
      'assumptions', 'exclusions', 'terms', 'termsSource',
    ];
    expect([...keys].filter((k) => !allowed.includes(k))).toEqual([]);
    const text = JSON.stringify(s);
    for (const leak of [whId, partId, '"150"', 'onHand', 'shortage'])
      expect(text).not.toContain(leak);
  });

  it('hides costs from users without cost visibility and keeps their cost inputs intact', async () => {
    const proj = await fx.as(supervisor).get(`/planning/projects/${projectId}`);
    expectStatus(proj, 200);
    expect(proj.body.canViewCost).toBe(false);
    const sc = proj.body.scenarios[0];
    expect(sc.inputs.labor.laborRatePerHour).toBeUndefined();
    expect(sc.inputs.costs).toBeUndefined();
    const run = await fx
      .as(supervisor)
      .get(`/planning/projects/${projectId}/runs/${proj.body.runs[0].id}`);
    expect(run.body.result.cost).toBeNull();
    expect(run.body.result.materials[0].unitCost).toBeNull();
    expect(run.body.data.products[0].standardUnitCost).toBe(0);

    // Supervisor edits the quantity; the hidden labour rate and cost settings survive.
    const upd = await fx
      .as(supervisor)
      .patch(`/planning/projects/${projectId}/scenarios/${sc.id}`, {
        inputs: { ...sc.inputs, quantity: 40 },
        version: sc.version,
      });
    expectStatus(upd, 200);
    const stored = JSON.parse(
      (
        await fx.prisma.planningScenario.findUniqueOrThrow({
          where: { id: sc.id },
        })
      ).inputs,
    );
    expect(stored.quantity).toBe(40);
    expect(stored.labor.laborRatePerHour).toBe(150);
    expect(stored.costs.masterCostCurrency).toBe('THB');
    const log = await fx.prisma.auditLog.findFirst({
      where: {
        entityId: projectId,
        action: 'PLANNING_SCENARIO_UPDATE',
        userId: supervisor.id,
      },
    });
    expect(log!.detail).toContain('quantity 50 → 40');
  });

  it('rejects a stale version (optimistic lock)', async () => {
    const res = await fx
      .as(manager)
      .patch(`/planning/projects/${projectId}/scenarios/${scenarioId}`, {
        name: 'x',
        version: 0,
      });
    expectStatus(res, 409);
  });

  it('enforces warehouse scope', async () => {
    expectStatus(
      await fx.as(scoped).get(`/planning/projects/${projectId}`),
      403,
    );
    const list = await fx.as(scoped).get('/planning/projects');
    expectStatus(list, 200);
    expect(
      list.body.find((p: { id: string }) => p.id === projectId),
    ).toBeUndefined();
    const own = await fx.as(scoped).post('/planning/projects', {
      name: 'Other',
      projectType: 'CUSTOM',
      warehouseId: whId,
      plannedStart: day(1),
      targetEnd: day(2),
      quantity: 1,
    });
    expectStatus(own, 403);
  });

  it('review: submit needs a fresh run, approval needs a different person', async () => {
    // The scenario changed after the last run → stale
    let proj = await fx.as(manager).get(`/planning/projects/${projectId}`);
    expectStatus(
      await fx.as(manager).post(`/planning/projects/${projectId}/submit`, {
        runId: proj.body.runs[0].id,
      }),
      409,
    );

    const calc = await fx
      .as(manager)
      .post(
        `/planning/projects/${projectId}/scenarios/${scenarioId}/calculate`,
      );
    expectStatus(calc, 201);
    expectStatus(
      await fx.as(manager).post(`/planning/projects/${projectId}/submit`, {
        runId: calc.body.id,
      }),
      201,
    );
    expectStatus(
      await fx.as(manager).post(`/planning/projects/${projectId}/approve`, {}),
      403,
    ); // maker ≠ checker
    expectStatus(
      await fx
        .as(supervisor)
        .post(`/planning/projects/${projectId}/approve`, {}),
      403,
    ); // no approve right
    expectStatus(
      await fx.as(manager2).post(`/planning/projects/${projectId}/reject`, {}),
      400,
    ); // reason required
    const ok = await fx
      .as(manager2)
      .post(`/planning/projects/${projectId}/approve`, {
        note: 'OK for planning',
      });
    expectStatus(ok, 201);
    expect(ok.body.planStatus).toBe('PLAN_APPROVED');

    const run = await fx
      .as(manager)
      .get(`/planning/projects/${projectId}/runs/${calc.body.id}`);
    expect(
      run.body.result.readiness.find(
        (x: { key: string }) => x.key === 'approvals',
      ).status,
    ).toBe('MET');

    // Approval changes nothing operational
    expect(
      await fx.prisma.stockItem.count({
        where: { status: StockStatus.RESERVED },
      }),
    ).toBe(4);
    proj = await fx.as(manager).get(`/planning/projects/${projectId}`);
    expect(proj.body.planStatus).toBe('PLAN_APPROVED');
  });

  it("another project's calculation counts this approved plan's demand once", async () => {
    const p2 = await fx.as(manager).post('/planning/projects', {
      name: 'Second',
      projectType: 'REPAIR',
      warehouseId: whId,
      plannedStart: day(14),
      targetEnd: day(40),
      quantity: 10,
    });
    expectStatus(p2, 201);
    const d = await fx.as(manager).get(`/planning/projects/${p2.body.id}`);
    const sc = d.body.scenarios[0];
    expectStatus(
      await fx
        .as(manager)
        .patch(`/planning/projects/${p2.body.id}/scenarios/${sc.id}`, {
          inputs: fullInputs({ quantity: 10 }),
          version: sc.version,
        }),
      200,
    );
    const calc = await fx
      .as(manager)
      .post(`/planning/projects/${p2.body.id}/scenarios/${sc.id}/calculate`);
    expectStatus(calc, 201);
    const m = calc.body.result.materials[0];
    expect(m.otherPlanDemand).toBe(40); // project 1 approved with 40 units × 1
    expect(m.netAvailable).toBe(0); // 30 − 5 − 3 − 40 < 0

    // Recalculating project 1 itself does not count its own approved demand
    const again = await fx
      .as(manager)
      .post(
        `/planning/projects/${projectId}/scenarios/${scenarioId}/calculate`,
      );
    expect(again.body.result.materials[0].otherPlanDemand).toBe(0);
  });

  it('editing an approved plan withdraws the approval', async () => {
    const proj = await fx.as(manager).get(`/planning/projects/${projectId}`);
    const sc = proj.body.scenarios[0];
    expectStatus(
      await fx
        .as(manager)
        .patch(`/planning/projects/${projectId}/scenarios/${sc.id}`, {
          notes: 'changed',
          version: sc.version,
        }),
      200,
    );
    const after = await fx.prisma.planningProject.findUniqueOrThrow({
      where: { id: projectId },
    });
    expect(after.planStatus).toBe('DRAFT');
    expect(after.approvedRunId).toBeNull();
    expect(
      await fx.prisma.auditLog.count({
        where: { entityId: projectId, action: 'PLANNING_APPROVAL_WITHDRAWN' },
      }),
    ).toBe(1);
  });

  it('compares scenarios side by side', async () => {
    const clone = await fx
      .as(manager)
      .post(`/planning/projects/${projectId}/scenarios`, {
        name: 'Two shifts',
        cloneFromId: scenarioId,
      });
    expectStatus(clone, 201);
    const inputs = {
      ...clone.body.inputs,
      calendar: { ...clone.body.inputs.calendar, shiftsPerDay: 2 },
    };
    expectStatus(
      await fx
        .as(manager)
        .patch(`/planning/projects/${projectId}/scenarios/${clone.body.id}`, {
          inputs,
          version: clone.body.version,
        }),
      200,
    );
    const a = await fx
      .as(manager)
      .post(
        `/planning/projects/${projectId}/scenarios/${scenarioId}/calculate`,
      );
    const b = await fx
      .as(manager)
      .post(
        `/planning/projects/${projectId}/scenarios/${clone.body.id}/calculate`,
      );
    const cmp = await fx
      .as(manager)
      .get(
        `/planning/projects/${projectId}/compare?runIds=${a.body.id},${b.body.id}`,
      );
    expectStatus(cmp, 200);
    expect(cmp.body.map((r: { shifts: number }) => r.shifts)).toEqual([1, 2]);
    expect(cmp.body[1].estimatedFinish <= cmp.body[0].estimatedFinish).toBe(
      true,
    );
    // Deleting a scenario with history is refused (kept for traceability)
    expectStatus(
      await fx
        .as(manager)
        .delete(`/planning/projects/${projectId}/scenarios/${clone.body.id}`),
      409,
    );
  });

  describe('sales simulation', () => {
    let salesId: string;
    let salesRunId: string;

    it('can be created without a warehouse; an operational project cannot', async () => {
      const base = {
        name: 'Quote: ACME refurbishment',
        projectType: 'REPAIR',
        plannedStart: day(30),
        targetEnd: day(60),
        quantity: 50,
      };
      expectStatus(await fx.as(manager).post('/planning/projects', base), 400);
      const res = await fx
        .as(manager)
        .post('/planning/projects', { ...base, purpose: 'SALES', customer: 'ACME' });
      expectStatus(res, 201);
      expect(res.body.purpose).toBe('SALES');
      expect(res.body.warehouseId).toBeNull();
      salesId = res.body.id;

      // A warehouse-scoped user can see it: it holds no warehouse data.
      const list = await fx.as(scoped).get('/planning/projects?purpose=SALES');
      expect(list.body.map((x: { id: string }) => x.id)).toContain(salesId);
      expectStatus(await fx.as(scoped).get(`/planning/projects/${salesId}`), 200);
      const ops = await fx.as(manager).get('/planning/projects?purpose=OPERATIONAL');
      expect(ops.body.map((x: { id: string }) => x.id)).not.toContain(salesId);
      // An operational project cannot drop its warehouse.
      const p1 = await fx.as(manager).get(`/planning/projects/${projectId}`);
      expectStatus(
        await fx.as(manager).patch(`/planning/projects/${projectId}`, {
          warehouseId: '',
          version: p1.body.version,
        }),
        400,
      );
    });

    it('calculates without reading stock and accepts free-text items', async () => {
      const d = await fx.as(manager).get(`/planning/projects/${salesId}`);
      const sc = d.body.scenarios[0];
      expectStatus(
        await fx.as(manager).patch(`/planning/projects/${salesId}/scenarios/${sc.id}`, {
          inputs: fullInputs({
            materials: [
              { productId: partId, stageKey: 'REPAIR', qtyPerUnit: 1, leadTimeDays: 5, unitsPerPallet: 100 },
              { productId: '', itemName: 'Thermal pad', unit: 'pcs', stageKey: 'REPAIR', qtyPerUnit: 2, unitCostOverride: 4, unitsPerPallet: 500 },
            ],
          }),
          version: sc.version,
        }),
        200,
      );
      const calc = await fx
        .as(manager)
        .post(`/planning/projects/${salesId}/scenarios/${sc.id}/calculate`);
      expectStatus(calc, 201);
      salesRunId = calc.body.id;
      const r = calc.body.result;
      expect(r.errors).toEqual([]);
      const [part, pad] = r.materials;
      // 30 units are available in the warehouse — a sales simulation never uses them.
      expect([part.supplyCheck, part.onHand, part.netRequirement, part.unitCost]).toEqual(['NOT_CHECKED', 0, 50, 40]);
      expect([pad.code, pad.totalRequirement, pad.totalCost]).toEqual(['Thermal pad', 100, 400]);
      expect(calc.body.data.products[0].available).toBe(0);
      expect(r.space.find((x: { key: string }) => x.key === 'STORAGE').status).toBe('NOT_CHECKED');
      expectStatus(
        await fx.as(manager).get(`/planning/projects/${salesId}/runs/${salesRunId}/customer-summary`),
        200,
      );
    });

    it('is never submitted for approval and never counts as demand for real plans', async () => {
      expectStatus(
        await fx.as(manager).post(`/planning/projects/${salesId}/submit`, { runId: salesRunId }),
        409,
      );
      // Even if a row were marked approved directly in the database, real plans ignore it.
      await fx.prisma.planningProject.update({
        where: { id: salesId },
        data: { planStatus: 'PLAN_APPROVED', approvedRunId: salesRunId },
      });
      const again = await fx
        .as(manager)
        .post(`/planning/projects/${projectId}/scenarios/${scenarioId}/calculate`);
      expectStatus(again, 201);
      expect(again.body.result.materials[0].otherPlanDemand).toBe(0);
      await fx.prisma.planningProject.update({
        where: { id: salesId },
        data: { planStatus: 'DRAFT', approvedRunId: null },
      });
    });

    it('quotes a price from cost: the customer sees the price, never the cost or margin', async () => {
      const d = await fx.as(manager).get(`/planning/projects/${salesId}`);
      const sc = d.body.scenarios[0];
      const pricing = { method: 'MARGIN', marginPct: 25, roundTo: 100, vatPct: 7, validityDays: 30 };
      expectStatus(
        await fx.as(manager).patch(`/planning/projects/${salesId}/scenarios/${sc.id}`, {
          inputs: fullInputs({ materials: [], costs: { masterCostCurrency: 'THB', pricing } }),
          version: sc.version,
        }),
        200,
      );
      const calc = await fx
        .as(manager)
        .post(`/planning/projects/${salesId}/scenarios/${sc.id}/calculate`);
      expectStatus(calc, 201);
      const c = calc.body.result.cost;
      // 50 units × (6 + 24 + 6) min = 30 h × 150 THB = 4,500 → ÷ 0.75 = 6,000
      expect([c.total, c.complete]).toEqual([4500, true]);
      expect(c.quote).toMatchObject({ price: 6000, marginAmount: 1500, marginPct: 25, vatAmount: 420, priceIncludingVat: 6420, complete: true });

      // A user without cost visibility: no cost or quote in the run, but the customer price is on the summary.
      const runAsSup = await fx
        .as(supervisor)
        .get(`/planning/projects/${salesId}/runs/${calc.body.id}`);
      expect(runAsSup.body.result.cost).toBeNull();
      const sum = await fx
        .as(supervisor)
        .get(`/planning/projects/${salesId}/runs/${calc.body.id}/customer-summary`);
      expectStatus(sum, 200);
      expect(sum.body.quote).toEqual({
        price: 6000, pricePerUnit: 120, currency: 'THB', vatPct: 7, vatAmount: 420,
        priceIncludingVat: 6420, validUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), complete: true,
      });
      expect(JSON.stringify(sum.body)).not.toMatch(/4500|1500|margin|cost/i);

      // Their edit keeps the hidden pricing.
      const asSup = await fx.as(supervisor).get(`/planning/projects/${salesId}`);
      const ssc = asSup.body.scenarios[0];
      expect(ssc.inputs.costs).toBeUndefined();
      expectStatus(
        await fx.as(supervisor).patch(`/planning/projects/${salesId}/scenarios/${ssc.id}`, {
          inputs: { ...ssc.inputs, quantity: 60 },
          version: ssc.version,
        }),
        200,
      );
      const stored = JSON.parse(
        (await fx.prisma.planningScenario.findUniqueOrThrow({ where: { id: ssc.id } })).inputs,
      );
      expect(stored.quantity).toBe(60);
      expect(stored.costs.pricing).toEqual(pricing);
    });

    it('proposal: provider identity, wording and terms — supplied, never invented', async () => {
      const url = `/planning/projects/${salesId}/runs/${salesRunId}/customer-summary`;
      // Nothing entered yet: no company, no wording, no terms.
      const empty = await fx.as(manager).get(url);
      expect(empty.body).toMatchObject({
        purpose: 'SALES', planApproved: false, company: null,
        deliverables: [], assumptions: [], exclusions: [], terms: [], termsSource: null,
      });
      expect(empty.body.contact.name).toBeTruthy();

      const p = await fx.as(manager).get(`/planning/projects/${salesId}`);
      expect(p.body.proposal).toEqual({ deliverables: '', assumptions: '', exclusions: '', terms: '' });
      expectStatus(
        await fx.as(manager).patch(`/planning/projects/${salesId}`, {
          proposal: { deliverables: '- Repaired units\n• Test report\n\n', assumptions: '1. Parts available', exclusions: '  ', terms: '' },
          version: p.body.version,
        }),
        200,
      );
      expectStatus(
        await fx.as(manager).patch(`/planning/projects/${salesId}`, { proposal: { deliverables: 'x'.repeat(4001) }, version: p.body.version + 1 }),
        400,
      );
      await fx.prisma.companyProfile.create({
        data: { legalName: 'Provider Co., Ltd.', address: '1 Road', defaultTerms: 'Payment as agreed\nValid as stated' },
      });
      const s = await fx.as(manager).get(url);
      expect(s.body.company).toMatchObject({ name: 'Provider Co., Ltd.', address: '1 Road', hasLogo: false });
      expect(s.body.deliverables).toEqual(['Repaired units', 'Test report']);
      expect(s.body.assumptions).toEqual(['Parts available']);
      expect(s.body.exclusions).toEqual([]);
      expect([s.body.terms, s.body.termsSource]).toEqual([['Payment as agreed', 'Valid as stated'], 'COMPANY']);
      // Project terms override the company default.
      const p2 = await fx.as(manager).get(`/planning/projects/${salesId}`);
      await fx.as(manager).patch(`/planning/projects/${salesId}`, { proposal: { ...p2.body.proposal, terms: '50% deposit' }, version: p2.body.version });
      const s2 = await fx.as(manager).get(url);
      expect([s2.body.terms, s2.body.termsSource]).toEqual([['50% deposit'], 'PROJECT']);
      await fx.prisma.companyProfile.deleteMany();

      // Editing only the proposal does not withdraw an approved operational plan.
      const op = await fx.prisma.planningProject.update({ where: { id: projectId }, data: { planStatus: 'PLAN_APPROVED' } });
      expectStatus(
        await fx.as(manager).patch(`/planning/projects/${projectId}`, { proposal: { deliverables: 'Units' }, version: op.version }),
        200,
      );
      expect((await fx.prisma.planningProject.findUniqueOrThrow({ where: { id: projectId } })).planStatus).toBe('PLAN_APPROVED');
      await fx.prisma.planningProject.update({ where: { id: projectId }, data: { planStatus: 'DRAFT', proposal: null } });
    });
  });

  describe('company templates', () => {
    let tplId: string;
    let goodRunId: string;

    it('saves a calculated run as a draft — standards only, never costs', async () => {
      const proj = await fx.as(manager).get(`/planning/projects/${projectId}`);
      const good = proj.body.runs.find((r: { overallStatus: string }) => r.overallStatus !== 'INSUFFICIENT_DATA');
      const bad = proj.body.runs.find((r: { overallStatus: string }) => r.overallStatus === 'INSUFFICIENT_DATA');
      goodRunId = good.id;
      expectStatus(await fx.as(manager).post('/planning/company-templates', { runId: bad.id, name: 'x' }), 400);
      expectStatus(await fx.as(requester).post('/planning/company-templates', { runId: good.id, name: 'x' }), 403);

      const res = await fx.as(manager).post('/planning/company-templates', {
        runId: good.id, name: 'Board repair — standard', description: 'Main board repair line',
      });
      expectStatus(res, 201);
      tplId = res.body.id;
      expect(res.body).toMatchObject({ code: 'TPL-0001', status: 'DRAFT', projectType: 'REPAIR', stageCount: 3 });
      expect(res.body.content.stages.map((s: { stdMinutesPerUnit: number }) => s.stdMinutesPerUnit)).toEqual([6, 24, 6]);
      expect(res.body.content.calendar.hoursPerShift).toBe(8);
      const raw = (await fx.prisma.planningTemplate.findUniqueOrThrow({ where: { id: tplId } })).content;
      for (const leak of ['laborRatePerHour', 'unitCostOverride', 'costs', 'pricing', 'availableHeadcount', 'holidays', 'warehouseId'])
        expect(raw).not.toContain(leak);
    });

    it('a draft starts no project; the author cannot confirm it; the basis is required', async () => {
      const base = { name: 'From template', projectType: 'REPAIR', purpose: 'SALES', plannedStart: day(30), targetEnd: day(60), quantity: 20, companyTemplateId: tplId };
      expectStatus(await fx.as(manager).post('/planning/projects', base), 400);
      expectStatus(await fx.as(supervisor).post(`/planning/company-templates/${tplId}/confirm`, { basis: 'x' }), 403);
      expectStatus(await fx.as(manager).post(`/planning/company-templates/${tplId}/confirm`, { basis: 'Time study' }), 403);
      expectStatus(await fx.as(manager2).post(`/planning/company-templates/${tplId}/confirm`, {}), 400);
      const ok = await fx.as(manager2).post(`/planning/company-templates/${tplId}/confirm`, { basis: 'Time study, line A, Sep 2026' });
      expectStatus(ok, 201);
      expect(ok.body).toMatchObject({ status: 'CONFIRMED', basis: 'Time study, line A, Sep 2026' });
      expect(ok.body.confirmedBy).toBeTruthy();
      // Confirmed numbers are frozen.
      expectStatus(await fx.as(manager).patch(`/planning/company-templates/${tplId}`, { name: 'changed' }), 409);
      expectStatus(await fx.as(manager).delete(`/planning/company-templates/${tplId}`), 409);
    });

    it('a confirmed template pre-fills a new project with validated standards', async () => {
      expectStatus(await fx.as(requester).get('/planning/company-templates'), 403);
      expectStatus(await fx.as(supervisor).get(`/planning/company-templates/${tplId}`), 200);
      const created = await fx.as(manager).post('/planning/projects', {
        name: 'Quote from template', projectType: 'REPAIR', purpose: 'SALES',
        plannedStart: day(30), targetEnd: day(60), quantity: 20, companyTemplateId: tplId,
      });
      expectStatus(created, 201);
      const p = await fx.as(manager).get(`/planning/projects/${created.body.id}`);
      expect(p.body.companyTemplate).toMatchObject({ code: 'TPL-0001', status: 'CONFIRMED' });
      const i = p.body.scenarios[0].inputs;
      expect(i.quantity).toBe(20);
      expect(i.stages.map((s: { key: string }) => s.key)).toEqual(['INSP', 'REPAIR', 'QA']);
      expect(i.stages.every((s: { productivitySource: string }) => s.productivitySource === 'VALIDATED_STANDARD')).toBe(true);
      expect(i.calendar.hoursPerShift).toBe(8);
      expect(i.labor.laborRatePerHour).toBeNull();
      expect(i.labor.availableHeadcount).toBeNull();
      expect(p.body.scenarios[0].notes).toContain('TPL-0001');
      const log = await fx.prisma.auditLog.findFirst({ where: { entityId: created.body.id, action: 'PLANNING_PROJECT_CREATE' } });
      expect(log!.detail).toContain('company template TPL-0001');
    });

    it('a replacement retires the old template once it is confirmed', async () => {
      const next = await fx.as(manager).post('/planning/company-templates', {
        runId: goodRunId, name: 'Board repair — standard v2', basis: 'Time study, Oct 2026', replacesId: tplId,
      });
      expectStatus(next, 201);
      // Someone else's draft: a user without approve rights cannot delete it.
      expectStatus(await fx.as(supervisor).delete(`/planning/company-templates/${next.body.id}`), 403);
      expectStatus(await fx.as(manager2).post(`/planning/company-templates/${next.body.id}/confirm`, {}), 201);
      const old = await fx.as(manager).get(`/planning/company-templates/${tplId}`);
      expect(old.body.status).toBe('RETIRED');
      const active = await fx.as(manager).get('/planning/company-templates');
      expect(active.body.rows.map((t: { id: string }) => t.id)).toEqual([next.body.id]);
      expect(active.body).toMatchObject({ canManage: true, canApprove: true });
      // A retired template starts nothing.
      expectStatus(
        await fx.as(manager).post('/planning/projects', {
          name: 'x', projectType: 'REPAIR', purpose: 'SALES', plannedStart: day(30), targetEnd: day(60), quantity: 5, companyTemplateId: tplId,
        }),
        400,
      );
      expectStatus(await fx.as(manager2).post(`/planning/company-templates/${next.body.id}/retire`, { note: 'superseded' }), 201);
      const actions = await fx.prisma.auditLog.findMany({ where: { entityType: 'PlanningTemplate' }, select: { action: true } });
      expect(new Set(actions.map((a) => a.action))).toEqual(
        new Set(['PLANNING_TEMPLATE_CREATE', 'PLANNING_TEMPLATE_CONFIRM', 'PLANNING_TEMPLATE_RETIRE']),
      );
    });
  });
});
