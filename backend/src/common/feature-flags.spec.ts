import { getReservationMode } from './feature-flags';
import { SETTING_BY_KEY } from '../settings/setting-definitions';

// Phase 1: the reservation wording must describe the mode the server really runs in.
describe('getReservationMode', () => {
  const original = process.env.ENABLE_UNIFIED_RESERVATION;
  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_UNIFIED_RESERVATION;
    else process.env.ENABLE_UNIFIED_RESERVATION = original;
  });

  it('is APPROVAL when the flag is off or unset (code default)', () => {
    delete process.env.ENABLE_UNIFIED_RESERVATION;
    expect(getReservationMode().mode).toBe('APPROVAL');
    process.env.ENABLE_UNIFIED_RESERVATION = 'false';
    expect(getReservationMode().mode).toBe('APPROVAL');
  });

  it('is ALLOCATION when ENABLE_UNIFIED_RESERVATION=true', () => {
    process.env.ENABLE_UNIFIED_RESERVATION = 'true';
    expect(getReservationMode()).toMatchObject({ mode: 'ALLOCATION' });
    expect(getReservationMode().summary).toMatch(/Approval reserves nothing/);
  });

  it('the Settings card text is read at request time and follows the flag', () => {
    const def = SETTING_BY_KEY.get('stock.reservation')!;
    process.env.ENABLE_UNIFIED_RESERVATION = 'false';
    expect(def.description).toMatch(/reserved when the request is approved/);
    process.env.ENABLE_UNIFIED_RESERVATION = 'true';
    expect(def.description).toMatch(/reserved when the warehouse allocates/);
    expect(def.description).not.toMatch(/current mode/);
  });
});
