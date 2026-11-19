// RQ17 — the code printed on a box's label: BOX-000123.
//
// Pure, like warehouse-code.ts, and for the same reason: the code goes on a
// sticker and into a QR, so the rule that makes it has to be testable on its
// own. The number is global and never reused — the caller feeds in every code
// the database holds, deleted boxes included, and the unique index on
// Container.code is the final guard.

export const CONTAINER_PREFIX = 'BOX';

/** Codes this module makes: BOX- followed by at least six digits. */
const GENERATED = /^BOX-(\d{6,})$/;

/** One past the highest number already used. Anything else is ignored. */
export function nextContainerNumber(codes: Iterable<string | null | undefined>): number {
  let max = 0;
  for (const raw of codes) {
    const m = GENERATED.exec(String(raw ?? '').trim().toUpperCase());
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** BOX-000123 — six digits, more once the sequence passes 999,999. */
export function buildContainerCode(n: number): string {
  return `${CONTAINER_PREFIX}-${String(Math.max(1, Math.trunc(n))).padStart(6, '0')}`;
}

/** Every code in the database → the code to store on the next container. */
export function generateContainerCode(existing: Iterable<string | null | undefined>): string {
  return buildContainerCode(nextContainerNumber(existing));
}

/** What goes in the QR on the box: BOX|BOX-000123 — the scanner reads this. */
export function containerPayload(code: string): string {
  return `${CONTAINER_PREFIX}|${String(code ?? '').trim().toUpperCase()}`;
}

export function isContainerCode(code: string): boolean {
  return GENERATED.test(String(code ?? '').trim().toUpperCase());
}
