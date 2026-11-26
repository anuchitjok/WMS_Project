import * as bcrypt from 'bcryptjs';
import { bcryptCost, hashPassword, costOf, needsRehash } from './password';

describe('password hashing cost (WMS-08-002)', () => {
  const saved = process.env.BCRYPT_COST;
  afterEach(() => {
    if (saved === undefined) delete process.env.BCRYPT_COST;
    else process.env.BCRYPT_COST = saved;
  });

  describe('bcryptCost', () => {
    it('defaults to 10 when BCRYPT_COST is unset or empty', () => {
      delete process.env.BCRYPT_COST;
      expect(bcryptCost()).toBe(10);
      process.env.BCRYPT_COST = '';
      expect(bcryptCost()).toBe(10);
    });

    it('honours a sensible value', () => {
      process.env.BCRYPT_COST = '12';
      expect(bcryptCost()).toBe(12);
    });

    it('never drops below 10, however it is set', () => {
      // The point of the floor: a stray environment variable must not be able to
      // turn password storage into something trivial to crack.
      for (const bad of ['4', '1', '0', '-5']) {
        process.env.BCRYPT_COST = bad;
        expect(bcryptCost()).toBe(10);
      }
    });

    it('never rises above 14, so a typo cannot make login take a minute', () => {
      process.env.BCRYPT_COST = '31';
      expect(bcryptCost()).toBe(14);
      // '1e3' parses to 1000, which is a whole number, so it clamps rather than
      // falling back to the default.
      process.env.BCRYPT_COST = '1e3';
      expect(bcryptCost()).toBe(14);
    });

    it('ignores values that are not whole numbers', () => {
      for (const bad of ['abc', '10.5', 'NaN', '']) {
        process.env.BCRYPT_COST = bad;
        expect(bcryptCost()).toBe(10);
      }
    });
  });

  describe('costOf', () => {
    it('reads the cost embedded in a real hash', async () => {
      const h = await bcrypt.hash('x', 10);
      expect(costOf(h)).toBe(10);
    });

    it('returns null for anything that is not a bcrypt hash', () => {
      for (const bad of ['', 'plaintext', 'md5:abcdef', '$1$abc$def']) {
        expect(costOf(bad)).toBeNull();
      }
    });

    it('handles every bcrypt variant prefix', () => {
      expect(costOf('$2a$12$' + 'x'.repeat(53))).toBe(12);
      expect(costOf('$2b$11$' + 'x'.repeat(53))).toBe(11);
      expect(costOf('$2y$10$' + 'x'.repeat(53))).toBe(10);
    });
  });

  describe('needsRehash', () => {
    it('is true for a hash made at a different cost', () => {
      process.env.BCRYPT_COST = '10';
      expect(needsRehash('$2b$12$' + 'x'.repeat(53))).toBe(true);
    });

    it('is false once the hash matches the configured cost', () => {
      process.env.BCRYPT_COST = '10';
      expect(needsRehash('$2b$10$' + 'x'.repeat(53))).toBe(false);
    });

    it('is true when the cost is raised again, not only lowered', () => {
      process.env.BCRYPT_COST = '13';
      expect(needsRehash('$2b$10$' + 'x'.repeat(53))).toBe(true);
    });

    it('is false for something it cannot parse, so login never re-hashes blindly', () => {
      expect(needsRehash('not-a-hash')).toBe(false);
      expect(needsRehash('')).toBe(false);
    });
  });

  describe('hashPassword', () => {
    it('produces a verifiable hash at the configured cost', async () => {
      process.env.BCRYPT_COST = '10';
      const h = await hashPassword('Admin@123');
      expect(costOf(h)).toBe(10);
      await expect(bcrypt.compare('Admin@123', h)).resolves.toBe(true);
      await expect(bcrypt.compare('wrong', h)).resolves.toBe(false);
    });

    it('still verifies passwords hashed at the old cost 12', async () => {
      // The whole point of re-hashing on login: existing hashes must keep working
      // in the meantime, or everybody is locked out the moment the cost changes.
      const old = await bcrypt.hash('Admin@123', 12);
      process.env.BCRYPT_COST = '10';
      await expect(bcrypt.compare('Admin@123', old)).resolves.toBe(true);
      expect(needsRehash(old)).toBe(true);
    });
  });
});
