import { RuleLike, UnitFacts, addDuration, evaluateWarranty, expiryDate, validateRule } from './warranty-engine';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const rule = (over: Partial<RuleLike>): RuleLike => ({
  id: over.ruleCode ?? 'r', ruleCode: 'R', version: 1, name: 'n', warrantyType: 'Manufacturer',
  scopeType: 'PRODUCT', scopeValue: 'p1', startBasis: 'RECEIPT_DATE', durationValue: 12, durationUnit: 'MONTHS',
  priority: 0, status: 'ACTIVE', effectiveFrom: D('2020-01-01'), effectiveTo: null, ...over,
});
const unit: UnitFacts = {
  serialNumber: 'SN-1', productId: 'p1', model: 'X100', category: 'Fan', brandId: 'b1', productType: 'SPARE_PART',
  vendorIds: ['v1'], dates: { RECEIPT_DATE: D('2026-01-31') },
};

describe('warranty dates', () => {
  it('adds calendar months with end-of-month clamping', () => {
    expect(iso(addDuration(D('2026-01-31'), 1, 'MONTHS'))).toBe('2026-02-28');
    expect(iso(addDuration(D('2028-01-31'), 1, 'MONTHS'))).toBe('2028-02-29');
    expect(iso(addDuration(D('2026-03-15'), 2, 'YEARS'))).toBe('2028-03-15');
    expect(iso(addDuration(D('2026-03-15'), 30, 'DAYS'))).toBe('2026-04-14');
  });
  it('expiry is the last covered day (inclusive)', () => {
    expect(iso(expiryDate(D('2026-01-01'), 12, 'MONTHS'))).toBe('2026-12-31');
    expect(iso(expiryDate(D('2026-01-01'), 90, 'DAYS'))).toBe('2026-03-31');
  });
});

describe('warranty status', () => {
  const r = [rule({ ruleCode: 'P12' })];
  it('active, expired, not started', () => {
    const a = evaluateWarranty(r, unit, D('2026-06-01'));
    expect(a.status).toBe('ACTIVE');
    expect(iso(a.startDate)).toBe('2026-01-31');
    expect(iso(a.expiryDate)).toBe('2027-01-30');
    expect(evaluateWarranty(r, unit, D('2027-01-30')).status).toBe('ACTIVE'); // last day covered
    expect(evaluateWarranty(r, unit, D('2027-01-31')).status).toBe('EXPIRED');
    expect(evaluateWarranty(r, unit, D('2026-01-30')).status).toBe('NOT_STARTED');
  });
  it('no matching rule', () => {
    expect(evaluateWarranty([rule({ scopeValue: 'other' })], unit, D('2026-06-01')).status).toBe('NO_RULE');
    expect(evaluateWarranty([rule({ status: 'DRAFT' })], unit, D('2026-06-01')).status).toBe('NO_RULE');
  });
  it('missing start date is reported, never guessed', () => {
    const d = evaluateWarranty([rule({ startBasis: 'INSTALLATION_DATE' })], unit, D('2026-06-01'));
    expect(d.status).toBe('START_DATE_UNKNOWN');
    expect(d.expiryDate).toBeNull();
  });
  it('missing serial: serial rules cannot match, product rules still apply', () => {
    const u = { ...unit, serialNumber: null };
    expect(evaluateWarranty([rule({ scopeType: 'SERIAL', scopeValue: 'SN-1' })], u, D('2026-06-01')).status).toBe('NO_RULE');
    expect(evaluateWarranty([rule({})], u, D('2026-06-01')).status).toBe('ACTIVE');
  });
  it('rule must be in effect on the start date', () => {
    const d = evaluateWarranty([rule({ effectiveFrom: D('2026-02-01') })], unit, D('2026-06-01'));
    expect(d.status).toBe('NO_RULE');
    expect(d.reason).toMatch(/none was in effect/);
  });
});

describe('overlapping rules', () => {
  it('more specific scope wins over priority', () => {
    const d = evaluateWarranty(
      [rule({ ruleCode: 'BRAND24', scopeType: 'BRAND', scopeValue: 'b1', durationValue: 24, priority: 99 }), rule({ ruleCode: 'SER6', scopeType: 'SERIAL', scopeValue: 'sn-1', durationValue: 6 })],
      unit, D('2026-06-01'),
    );
    expect(d.rule!.ruleCode).toBe('SER6');
    expect(d.candidates).toHaveLength(2);
    expect(iso(d.expiryDate)).toBe('2026-07-30');
  });
  it('equal specificity: higher priority wins', () => {
    const d = evaluateWarranty([rule({ ruleCode: 'A', priority: 1 }), rule({ ruleCode: 'B', priority: 5, durationValue: 3 })], unit, D('2026-06-01'));
    expect(d.rule!.ruleCode).toBe('B');
    expect(d.status).toBe('EXPIRED');
  });
  it('equal specificity and priority = CONFLICT, no decision', () => {
    const d = evaluateWarranty([rule({ ruleCode: 'A' }), rule({ ruleCode: 'B' })], unit, D('2026-06-01'));
    expect(d.status).toBe('CONFLICT');
    expect(d.conflictingRules.map((r) => r.ruleCode)).toEqual(['A', 'B']);
    expect(d.expiryDate).toBeNull();
  });
  it('a rule not in effect does not cause a conflict', () => {
    const d = evaluateWarranty([rule({ ruleCode: 'A' }), rule({ ruleCode: 'OLD', effectiveTo: D('2025-01-01') })], unit, D('2026-06-01'));
    expect(d.rule!.ruleCode).toBe('A');
  });
});

describe('rule validation', () => {
  it('rejects invalid durations and windows', () => {
    expect(validateRule({ durationValue: 0, durationUnit: 'MONTHS', effectiveFrom: D('2026-01-01'), effectiveTo: null, scopeValue: 'x' })).toHaveLength(1);
    expect(validateRule({ durationValue: 12, durationUnit: 'MONTHS', effectiveFrom: D('2026-01-01'), effectiveTo: D('2025-01-01'), scopeValue: 'x' })).toHaveLength(1);
    expect(validateRule({ durationValue: 12, durationUnit: 'MONTHS', effectiveFrom: D('2026-01-01'), effectiveTo: null, scopeValue: ' ' })).toHaveLength(1);
  });
});
