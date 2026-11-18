import { buildContainerCode, generateContainerCode, isContainerCode, nextContainerNumber } from './container-code';

// RQ17 — the code on the sticker. Global, never reused, six digits.

describe('container codes', () => {
  it('starts at BOX-000001 in an empty database', () => {
    expect(generateContainerCode([])).toBe('BOX-000001');
  });

  it('continues past the highest number already used', () => {
    expect(generateContainerCode(['BOX-000001', 'BOX-000042', 'BOX-000007'])).toBe('BOX-000043');
  });

  it('ignores anything that is not one of its own codes', () => {
    expect(nextContainerNumber(['PALLET-9', 'BOX-12', 'WH-MAIN', '', null, undefined])).toBe(1);
  });

  it('counts a code whatever case it is written in', () => {
    expect(generateContainerCode(['box-000009'])).toBe('BOX-000010');
  });

  it('keeps counting past six digits', () => {
    expect(buildContainerCode(1_000_000)).toBe('BOX-1000000');
    expect(nextContainerNumber(['BOX-999999'])).toBe(1_000_000);
  });

  it('recognises its own codes and nothing else', () => {
    expect(isContainerCode('BOX-000123')).toBe(true);
    expect(isContainerCode('BOX-123')).toBe(false);
    expect(isContainerCode('CARTON-000123')).toBe(false);
  });
});
