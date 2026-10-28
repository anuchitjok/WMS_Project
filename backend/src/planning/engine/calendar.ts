import { CalendarInput } from './types';

const DAY_MS = 86_400_000;
const MAX_DAYS = 3660; // ~10 years: a hard stop for loops over the calendar

export function parseDay(d: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
    throw new Error(`Invalid date '${d}' (expected YYYY-MM-DD)`);
  const t = new Date(`${d}T00:00:00.000Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d)
    throw new Error(`Invalid date '${d}'`);
  return t;
}

export function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return fmtDay(new Date(parseDay(d).getTime() + n * DAY_MS));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY_MS);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(d: string): number {
  const w = parseDay(d).getUTCDay();
  return w === 0 ? 7 : w;
}

export function isValidDay(d: unknown): d is string {
  if (typeof d !== 'string') return false;
  try {
    parseDay(d);
    return true;
  } catch {
    return false;
  }
}

/**
 * Working calendar of one project scenario.
 *
 * Clock hours count net working time (breaks excluded) from the first working
 * hour of `start`. Every working day contributes `clockHoursPerDay`; weekends
 * and holidays contribute nothing.
 */
export class WorkCalendar {
  readonly netShiftHours: number;
  readonly clockHoursPerDay: number;
  private readonly holidays: Set<string>;
  private readonly days: string[] = [];

  constructor(
    private readonly cal: CalendarInput,
    readonly start: string,
  ) {
    this.netShiftHours = cal.hoursPerShift - cal.breakMinutesPerShift / 60;
    this.clockHoursPerDay = cal.shiftsPerDay * this.netShiftHours;
    this.holidays = new Set(cal.holidays);
  }

  isWorkingDay(d: string): boolean {
    return (
      this.cal.workingDays.includes(isoWeekday(d)) && !this.holidays.has(d)
    );
  }

  /** The n-th working day on or after the start (0-based). */
  workingDay(n: number): string {
    let cursor = this.days.length
      ? addDays(this.days[this.days.length - 1], 1)
      : this.start;
    let guard = 0;
    while (this.days.length <= n) {
      if (this.isWorkingDay(cursor)) this.days.push(cursor);
      cursor = addDays(cursor, 1);
      if (++guard > MAX_DAYS * 2)
        throw new Error('The working calendar has no working days in range');
    }
    return this.days[n];
  }

  /** Working days in [from, to], both inclusive (0 when to < from). */
  workingDaysBetween(from: string, to: string): number {
    if (daysBetween(from, to) < 0) return 0;
    let n = 0;
    let d = from;
    for (let i = 0; i <= MAX_DAYS && daysBetween(d, to) >= 0; i++) {
      if (this.isWorkingDay(d)) n++;
      d = addDays(d, 1);
    }
    return n;
  }

  /** Date on which work at clock hour `h` happens; `end` puts an exact day boundary on the earlier day. */
  dateAt(h: number, mode: 'start' | 'end'): string {
    const D = this.clockHoursPerDay;
    const eps = 1e-9;
    const idx =
      mode === 'end'
        ? Math.max(0, Math.ceil(h / D - eps) - 1)
        : Math.max(0, Math.floor(h / D + eps));
    if (idx > MAX_DAYS)
      throw new Error('Schedule extends beyond 10 years — check the inputs');
    return this.workingDay(idx);
  }

  /** Clock hour at which a date becomes usable (start of that day, or of the next working day). */
  hourAtDate(d: string): number {
    if (daysBetween(this.start, d) <= 0) return 0;
    return (
      this.workingDaysBetween(this.start, addDays(d, -1)) *
      this.clockHoursPerDay
    );
  }

  /** Working days needed to cover `h` clock hours (for display). */
  workingDaysFor(h: number): number {
    return Math.round((h / this.clockHoursPerDay) * 100) / 100;
  }
}
