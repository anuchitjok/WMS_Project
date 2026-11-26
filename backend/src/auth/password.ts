import * as bcrypt from 'bcryptjs';

/**
 * Password hashing cost, in one place.
 *
 * Every password in this application used to be hashed at bcrypt cost 12, written
 * out as a literal in seven different files. Cost 12 is roughly four times the work
 * of cost 10 — about 254 ms of pure CPU on a developer laptop. That is a sound
 * choice on a machine with a CPU to spare.
 *
 * Production is not such a machine. The API runs on a Render free instance with
 * **0.1 CPU**, and bcrypt is CPU-bound with no I/O to overlap, so the same hash that
 * costs 254 ms here costs seconds there. It is the single largest component of the
 * login time a user actually feels, larger than the network round trip to Singapore
 * and larger than all the database work put together.
 *
 * Measured here with `bcryptjs`, which is what this application uses, on a developer
 * laptop at full CPU:
 *
 *     cost 10   compare  74 ms    hash  68 ms
 *     cost 11   compare 124 ms    hash 127 ms
 *     cost 12   compare 252 ms    hash 253 ms
 *
 * Each step up doubles the work, as it is meant to. Divide a tenth of a CPU into
 * those numbers to see what production pays.
 *
 * So the cost is now configurable, and the default is 10 — bcrypt's own default, and
 * still the common recommendation. The floor is 10: BCRYPT_COST cannot be used to
 * weaken hashing below that, however it is set, because a misconfigured environment
 * variable must not be able to silently turn password storage into something trivial
 * to crack. The ceiling of 14 is there to stop a typo making login take a minute.
 *
 * To go back to the old behaviour, set BCRYPT_COST=12.
 */
const DEFAULT_COST = 10;
const MIN_COST = 10;
const MAX_COST = 14;

export function bcryptCost(): number {
  const raw = process.env.BCRYPT_COST;
  if (raw === undefined || raw === '') return DEFAULT_COST;
  const n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULT_COST;
  return Math.min(MAX_COST, Math.max(MIN_COST, n));
}

/** Hash a new password at the configured cost. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, bcryptCost());
}

/**
 * The cost a stored hash was created with, or null if it is not a bcrypt hash we
 * recognise. A bcrypt hash looks like `$2b$12$<22 chars of salt><31 chars of digest>`.
 */
export function costOf(hash: string): number | null {
  const m = /^\$2[aby]?\$(\d{2})\$/.exec(hash ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) ? n : null;
}

/**
 * Whether a stored hash should be replaced on the next successful login.
 *
 * The cost a password was hashed with is embedded in the hash itself, so changing
 * `BCRYPT_COST` does nothing for anyone who already has an account — their old hash
 * keeps verifying at its old cost forever. Re-hashing on login is how the change
 * actually reaches existing users, without forcing a password reset on anybody.
 *
 * Only a cost *mismatch* triggers it, in either direction: lowering the cost speeds
 * existing accounts up, and raising it later strengthens them again.
 */
export function needsRehash(hash: string): boolean {
  const c = costOf(hash);
  return c !== null && c !== bcryptCost();
}
