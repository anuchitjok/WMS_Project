import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

/**
 * Rate limiting keyed by who is calling, not only where from.
 *
 * - `default` throttler: per authenticated user when the request carries a
 *   valid access token (signature + expiry verified, so a forged or expired
 *   token cannot mint a fresh bucket), otherwise per client IP. Users sharing
 *   one office NAT no longer share one quota.
 * - `ip` throttler: always per client IP, with a higher ceiling. It caps
 *   abuse from a single address (including unauthenticated floods) without
 *   being the everyday limit for a shared NAT.
 *
 * The client IP is `req.ip`, which honours `trust proxy` (see main.ts): only
 * the configured number of proxy hops is trusted, so a client-supplied
 * X-Forwarded-For cannot pick its own bucket.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const header: unknown = req.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      try {
        const payload = this.jwt.verify<{ sub?: string }>(header.slice(7));
        if (payload?.sub) return `user:${payload.sub}`;
      } catch {
        /* invalid / expired → fall back to IP */
      }
    }
    return `ip:${req.ip}`;
  }
}

function intFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Throttler definitions, overridable per deployment. */
export function throttlerConfig(): ThrottlerOptions[] {
  return [
    {
      name: 'default',
      ttl: 60_000,
      limit: intFromEnv('THROTTLE_USER_LIMIT', 100),
    },
    {
      name: 'ip',
      ttl: 60_000,
      limit: intFromEnv('THROTTLE_IP_LIMIT', 600),
      getTracker: (req: Record<string, any>) => `ip:${req.ip}`,
    },
  ];
}

/** Proxy hops to trust for req.ip. Production sits behind one proxy (Render); local/dev behind none. */
export function trustProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return process.env.NODE_ENV === 'production' ? 1 : 0;
}
