import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ReceivingItemDto } from './dto/create-receiving.dto';
import { conditionLabel, parseItemCondition, sourceTypeLabel, sourceTypeMatches } from './receiving-display';

describe('receiving display rules', () => {
  it('shows the stored RTV Replacement value as "RTV Return" and leaves others alone', () => {
    expect(sourceTypeLabel('RTV Replacement')).toBe('RTV Return');
    expect(sourceTypeLabel('Brand Owner')).toBe('Brand Owner');
    expect(sourceTypeLabel('Customer Return')).toBe('Customer Return');
    expect(sourceTypeLabel(null)).toBe('');
  });

  it('matches a search by stored value or by display label', () => {
    expect(sourceTypeMatches('RTV Replacement', 'rtv return')).toBe(true);
    expect(sourceTypeMatches('RTV Replacement', 'replacement')).toBe(true);
    expect(sourceTypeMatches('Vendor', 'rtv')).toBe(false);
    expect(sourceTypeMatches(null, 'x')).toBe(false);
    expect(sourceTypeMatches(null, '  ')).toBe(true);
  });

  it('parses item condition leniently for imports', () => {
    expect(parseItemCondition(undefined)).toBeNull();
    expect(parseItemCondition('')).toBeNull();
    expect(parseItemCondition(' new ')).toBe('NEW');
    expect(parseItemCondition('Refurbish')).toBe('REFURBISH');
    expect(parseItemCondition('REFURBISHED')).toBe('REFURBISH');
    expect(parseItemCondition('used')).toBeUndefined();
  });

  it('labels condition, falling back to the QC condition for older receipts', () => {
    expect(conditionLabel('NEW', 'good')).toBe('New');
    expect(conditionLabel('REFURBISH', 'damaged')).toBe('Refurbish');
    expect(conditionLabel(null, 'good')).toBe('QC: good');
    expect(conditionLabel(null, null)).toBe('');
  });
});

describe('ReceivingItemDto.itemCondition validation', () => {
  const errorsFor = (extra: Record<string, unknown>) =>
    validateSync(plainToInstance(ReceivingItemDto, { productId: 'p1', quantity: 1, ...extra }))
      .filter((e) => e.property === 'itemCondition');

  it('is optional for older clients', () => {
    expect(errorsFor({})).toHaveLength(0);
  });
  it('accepts NEW and REFURBISH', () => {
    expect(errorsFor({ itemCondition: 'NEW' })).toHaveLength(0);
    expect(errorsFor({ itemCondition: 'REFURBISH' })).toHaveLength(0);
  });
  it('rejects anything else', () => {
    expect(errorsFor({ itemCondition: 'USED' })).toHaveLength(1);
    expect(errorsFor({ itemCondition: 'new' })).toHaveLength(1);
    expect(errorsFor({ itemCondition: 'good' })).toHaveLength(1);
  });
});
