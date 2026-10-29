/**
 * Calendar buckets for usage history and planning. All dates are UTC.
 * DAY = calendar day, WEEK = ISO week starting Monday, MONTH = calendar month.
 */
export type Granularity = 'DAY' | 'WEEK' | 'MONTH';

export const GRANULARITIES: Granularity[] = ['DAY', 'WEEK', 'MONTH'];

/** Average days per period, used only to convert rates (e.g. average daily usage). */
export const DAYS_PER_PERIOD: Record<Granularity, number> = {
  DAY: 1,
  WEEK: 7,
  MONTH: 365.25 / 12,
};

const DAY_MS = 86_400_000;

export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function periodStart(d: Date, g: Granularity): Date {
  const day = startOfDay(d);
  if (g === 'DAY') return day;
  if (g === 'WEEK') {
    const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
    return new Date(day.getTime() - dow * DAY_MS);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function addPeriods(start: Date, n: number, g: Granularity): Date {
  if (g === 'DAY') return new Date(start.getTime() + n * DAY_MS);
  if (g === 'WEEK') return new Date(start.getTime() + n * 7 * DAY_MS);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function daysBetween(a: Date, b: Date): number {
  return (startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS;
}

/** Start dates of every period from the one containing `from` to the one containing `to`, inclusive. */
export function periodStarts(from: Date, to: Date, g: Granularity): Date[] {
  const out: Date[] = [];
  const last = periodStart(to, g).getTime();
  for (let p = periodStart(from, g); p.getTime() <= last; p = addPeriods(p, 1, g)) out.push(p);
  return out;
}

export function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
