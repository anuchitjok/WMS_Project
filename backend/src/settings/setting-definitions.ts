import { getReservationMode } from '../common/feature-flags';

/**
 * The system settings catalogue: what each key means, what values it accepts,
 * and whether it actually drives business logic.
 *
 * Value states (see SettingValue):
 *  - missing    — no row in the Setting table: the feature keeps its built-in
 *                 behaviour (the behaviour before the setting existed).
 *  - disabled   — explicitly switched off ("disabled"): feature off.
 *  - configured — a valid value: applied.
 *  - invalid    — a stored value that fails validation (e.g. edited in the DB):
 *                 treated like missing, and reported so an admin can fix it.
 *
 * Settings marked `effect: 'informational'` are kept for display only — they are
 * controlled elsewhere (environment flags) and cannot be changed here, so the UI
 * never suggests a switch that does nothing.
 */
export type SettingEffect = 'enforced' | 'informational';

export interface SettingDefinition {
  key: string;
  label: string;
  category: 'workflow' | 'validation' | 'inventory' | 'sla' | 'notification' | 'ui';
  effect: SettingEffect;
  /** Seed value written when the table is first initialised (unchanged from before). */
  seed: string;
  /** Human description of accepted values, shown in the UI. */
  accepts: string;
  /** What the setting does, shown in the UI. */
  description: string;
  /** Allowed literal values (select), or undefined for numeric settings. */
  options?: string[];
  min?: number;
  max?: number;
  /** Can be set to "disabled". */
  canDisable?: boolean;
  /**
   * Comma-separated list setting: every entry must be one of these values.
   * An empty value is a valid, explicit "none".
   */
  list?: readonly string[];
}

/**
 * Optional modules that can be hidden from menus (P7 7.1, P1 1.8). Hidden
 * modules keep their data and code; the web app only takes them out of the
 * menu and shows a "not enabled" notice on their pages. Must match ModuleKey in
 * frontend/src/lib/feature-flags.ts.
 */
export const MODULE_KEYS = ['warranty', 'mrp', 'floorPlan2d'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export const HIDDEN_MODULES_KEY = 'ui.hiddenModules';
/** Built-in behaviour while the setting is missing or invalid: all three hidden. */
export const DEFAULT_HIDDEN_MODULES: readonly ModuleKey[] = ['warranty', 'mrp', 'floorPlan2d'];

export const DISABLED = 'disabled';

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: 'stock.lowThreshold',
    label: 'Low stock threshold',
    category: 'inventory',
    effect: 'enforced',
    seed: '5',
    accepts: 'Whole number of units (1–100000), or disabled',
    min: 1,
    max: 100000,
    canDisable: true,
    description:
      'Default minimum for products that have no Min Stock of their own. A product is low when its available units in the warehouse(s) you can see fall below it. Products with their own Min Stock always use that.',
  },
  {
    key: 'rtv.agingSla',
    label: 'RTV aging SLA (days)',
    category: 'sla',
    effect: 'enforced',
    seed: '7',
    accepts: 'Whole number of days (1–365), or disabled',
    min: 1,
    max: 365,
    canDisable: true,
    description:
      'An open RTV case older than this many days (counted from creation, in elapsed 24-hour days) is marked overdue on the RTV list and dashboard.',
  },
  {
    key: 'serial.duplicate',
    label: 'Serial number duplicate control',
    category: 'validation',
    effect: 'enforced',
    seed: 'strict',
    accepts: 'strict',
    options: ['strict'],
    description:
      'A serial number may exist only once in active stock (receiving, manual stock creation and imports). Locked to strict by requirement 7.1 — it cannot be relaxed.',
  },
  {
    key: 'audit.retention',
    label: 'Audit log retention (days)',
    category: 'validation',
    effect: 'enforced',
    seed: '365',
    accepts: 'Whole number of days (90–3650), or disabled',
    min: 90,
    max: 3650,
    canDisable: true,
    description:
      'Operational audit entries older than this can be moved to the audit archive by an administrator (preview first). Nothing is deleted automatically, and security entries (logins, users, roles, settings, approvals) are never archived.',
  },
  {
    key: 'cycleCount.frequency',
    label: 'Cycle count frequency',
    category: 'inventory',
    effect: 'enforced',
    seed: 'monthly',
    accepts: 'weekly, monthly, quarterly, or disabled',
    options: ['weekly', 'monthly', 'quarterly'],
    canDisable: true,
    description:
      'How often each warehouse must complete an approved cycle count. Drives the due / overdue status on the Cycle Count page. Counts are never created automatically.',
  },
  {
    key: 'approval.workflow',
    label: 'Approval workflow by role and department',
    category: 'workflow',
    effect: 'informational',
    seed: 'enabled',
    accepts: 'Set by the ENABLE_APPROVAL_ENGINE environment flag',
    description:
      'Multi-step approval rules apply only when the server runs with ENABLE_APPROVAL_ENGINE=true. Configure the rules on the Approval Rules page.',
  },
  {
    key: 'stock.reservation',
    label: 'Stock reservation and release rule',
    category: 'workflow',
    effect: 'informational',
    seed: 'auto',
    accepts: 'Set by the ENABLE_UNIFIED_RESERVATION environment flag',
    // Read at request time so the text always matches the mode the server runs in.
    get description() {
      return `${getReservationMode().summary} Changing the reservation model is a deployment decision, not a runtime setting.`;
    },
  },
  {
    key: HIDDEN_MODULES_KEY,
    label: 'Hidden modules',
    category: 'ui',
    effect: 'enforced',
    seed: DEFAULT_HIDDEN_MODULES.join(','),
    accepts: `Comma-separated list of: ${MODULE_KEYS.join(', ')} (empty = show all)`,
    list: MODULE_KEYS,
    description:
      'Modules taken out of the menu. Their pages show a "not enabled" notice instead. Data and code are kept, so a module can be switched back on at any time.',
  },
  {
    key: 'notification.template',
    label: 'Notification template',
    category: 'notification',
    effect: 'informational',
    seed: 'default',
    accepts: 'Managed on the Notification Templates page',
    description: 'Each notification type has its own editable template.',
  },
  {
    key: 'warehouse.capacityRule',
    label: 'Warehouse capacity rule',
    category: 'inventory',
    effect: 'informational',
    seed: 'enabled',
    accepts: 'Always on',
    description:
      'Putaway checks slot capacity before confirming. This is part of the putaway workflow and is not switchable.',
  },
];

export const SETTING_BY_KEY = new Map(
  SETTING_DEFINITIONS.map((d) => [d.key, d]),
);

export type SettingValue<T> =
  | { state: 'missing' }
  | { state: 'disabled' }
  | { state: 'invalid'; raw: string; reason: string }
  | { state: 'configured'; value: T };

/** Parses a stored value against its definition. */
export function parseSetting(
  def: SettingDefinition,
  raw: string | null | undefined,
): SettingValue<string | number> {
  if (raw === null || raw === undefined) return { state: 'missing' };
  const v = raw.trim();
  if (def.list) return parseList(def, raw, v);
  if (v.toLowerCase() === DISABLED) {
    return def.canDisable
      ? { state: 'disabled' }
      : { state: 'invalid', raw, reason: `${def.label} cannot be disabled` };
  }
  if (def.options) {
    return def.options.includes(v)
      ? { state: 'configured', value: v }
      : {
          state: 'invalid',
          raw,
          reason: `Must be one of: ${def.options.join(', ')}`,
        };
  }
  if (def.min !== undefined) {
    if (!/^\d+$/.test(v))
      return { state: 'invalid', raw, reason: 'Must be a whole number' };
    const n = Number(v);
    if (n < def.min || n > (def.max ?? Number.MAX_SAFE_INTEGER))
      return {
        state: 'invalid',
        raw,
        reason: `Must be between ${def.min} and ${def.max}`,
      };
    return { state: 'configured', value: n };
  }
  return { state: 'configured', value: v };
}

/**
 * List settings: entries are trimmed, de-duplicated and stored in catalogue
 * order, so equal selections always store the same value. Unknown entries make
 * the whole value invalid (nothing is silently dropped).
 */
function parseList(
  def: SettingDefinition,
  raw: string,
  v: string,
): SettingValue<string | number> {
  const allowed = def.list ?? [];
  if (v.toLowerCase() === DISABLED && !allowed.includes(v)) {
    return { state: 'invalid', raw, reason: `${def.label} cannot be disabled` };
  }
  const parts = v
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const unknown = parts.filter((p) => !allowed.includes(p));
  if (unknown.length) {
    return {
      state: 'invalid',
      raw,
      reason: `Unknown value: ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}`,
    };
  }
  const set = new Set(parts);
  return {
    state: 'configured',
    value: allowed.filter((a) => set.has(a)).join(','),
  };
}

/** Hidden modules in force: the configured list, or the built-in default when missing/invalid. */
export function hiddenModulesFrom(
  parsed: SettingValue<string | number>,
): ModuleKey[] {
  if (parsed.state !== 'configured') return [...DEFAULT_HIDDEN_MODULES];
  const value = String(parsed.value);
  return value ? (value.split(',') as ModuleKey[]) : [];
}
