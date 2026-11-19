// Pure helpers for the 2D Floor Plan: snapping, the ruler and the scale bar.
//
// Deliberately a SEPARATE module from `floor-geometry.ts`. That file is a
// byte-for-byte mirror of the backend copy (a backend spec asserts the two are
// identical), so nothing frontend-only may be added to it. Shared primitives are
// imported from there; everything here is 2D-plan presentation maths and has no
// backend counterpart. The backend did the same with `layout-geometry.ts`.
//
// Nothing in here reads or writes stock. The plan is a drawing (decision C5).

/** Snap step for the Floor Plan editor, in plan units (RQ9 / C2: 10 cm). */
export const SNAP_STEP = 0.1;

/** Smallest drawable object, in plan units. One snap step. */
export const MIN_OBJECT_SIZE = 0.1;

/**
 * A grid tier is drawn only once one of its cells is at least this many screen
 * pixels across. Below that the lines merge into grey and only cost paint time.
 */
export const GRID_REVEAL_PX = 7;

/** One CSS pixel in metres (96 CSS px = 1 inch), for the 1:N scale ratio. */
export const CSS_PX_METRES = 0.0254 / 96;

/**
 * Snap to the 10 cm grid. Done on tenths rather than `n / 0.1` so the result is
 * a clean one-decimal number instead of 3.3000000000000003.
 */
export function snapToGrid(n: number, enabled: boolean): number {
  return enabled ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
}

/** Plan distance between two points, in plan units. */
export function planDistance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Nearest "round" number at or below `n`, from the 1 / 2 / 5 × 10ⁿ series that
 * map scale bars have always used. Returns 0 for a non-positive or unusable input.
 */
export function niceStep(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const exp = Math.floor(Math.log10(n));
  const pow = 10 ** exp;
  const f = n / pow;
  const lead = f >= 5 ? 5 : f >= 2 ? 2 : 1;
  return lead * pow;
}

/** Degrees folded into 0–359, so the control never shows -90° or 450°. */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((Math.round(deg) % 360) + 360) % 360;
}

export interface ScaleReadout {
  /** Length of the bar on screen, in CSS pixels. */
  barPx: number;
  /** What that bar is worth on the real floor, in metres. */
  barMetres: number;
  /** Denominator of the drawing scale, e.g. 500 for "SCALE 1:500". */
  ratio: number;
  /** Real metres per screen centimetre, for the tooltip. */
  metresPerScreenCm: number;
}

/**
 * Scale bar and 1:N ratio for the current zoom.
 *
 * `metresPerUnit` comes from the layout (saved by the 3D view) and may be null;
 * the plan's own unit label defaults to "m", so 1 unit is then taken as 1 metre
 * — the conservative reading, and the UI says so when it is assumed.
 */
export function scaleReadout(
  pxPerUnit: number,
  metresPerUnit: number | null | undefined,
  targetPx = 120,
): ScaleReadout {
  const mpu = metresPerUnit && metresPerUnit > 0 ? metresPerUnit : 1;
  const safePxPerUnit = Math.max(pxPerUnit, 1e-6);
  const metresPerPx = mpu / safePxPerUnit;
  const barMetres = niceStep(targetPx * metresPerPx) || metresPerPx;
  return {
    barPx: barMetres / metresPerPx,
    barMetres,
    ratio: Math.max(1, Math.round(metresPerPx / CSS_PX_METRES)),
    metresPerScreenCm: metresPerPx / (CSS_PX_METRES * 100),
  };
}
