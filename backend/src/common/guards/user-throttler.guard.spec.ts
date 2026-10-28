import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import {
  UserThrottlerGuard,
  throttlerConfig,
  trustProxyHops,
} from './user-throttler.guard';

@Controller()
class PingController {
  @Get('ping') ping() {
    return { ok: true };
  }
  @Post('login')
  @Throttle({
    default: {
      limit: 2,
      ttl: 60_000,
      getTracker: (req: Record<string, any>) => `ip:${req.ip}`,
    },
  })
  login() {
    return { ok: true };
  }
}

describe('UserThrottlerGuard', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const SECRET = 'throttle-test-secret-0123456789';

  async function build(userLimit: number, ipLimit: number, trustProxy = 0) {
    process.env.THROTTLE_USER_LIMIT = String(userLimit);
    process.env.THROTTLE_IP_LIMIT = String(ipLimit);
    const mod = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot(throttlerConfig()),
        JwtModule.register({
          secret: SECRET,
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [PingController],
      providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
    }).compile();
    app = mod.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
    await app.init();
    jwt = app.get(JwtService);
  }

  afterEach(async () => {
    await app?.close();
    delete process.env.THROTTLE_USER_LIMIT;
    delete process.env.THROTTLE_IP_LIMIT;
  });

  const get = (token?: string, xff?: string) => {
    const r = request(app.getHttpServer()).get('/ping');
    if (token) r.set('Authorization', `Bearer ${token}`);
    if (xff) r.set('X-Forwarded-For', xff);
    return r;
  };

  it('gives each authenticated user behind one IP their own quota', async () => {
    await build(3, 100);
    const alice = jwt.sign({ sub: 'alice' });
    const bob = jwt.sign({ sub: 'bob' });
    for (let i = 0; i < 3; i++) await get(alice).expect(200);
    await get(alice).expect(429); // alice exhausted
    for (let i = 0; i < 3; i++) await get(bob).expect(200); // bob unaffected, same IP
  });

  it('limits repeated requests from one user', async () => {
    await build(2, 100);
    const t = jwt.sign({ sub: 'carol' });
    await get(t).expect(200);
    await get(t).expect(200);
    const res = await get(t).expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('limits unauthenticated callers per IP', async () => {
    await build(2, 100);
    await get().expect(200);
    await get().expect(200);
    await get().expect(429);
  });

  it('forged or expired tokens fall back to the IP bucket (no fresh quota per fake user)', async () => {
    await build(2, 100);
    const forged = (sub: string) =>
      new JwtService({ secret: 'wrong-secret' }).sign({ sub });
    await get(forged('x1')).expect(200);
    await get(forged('x2')).expect(200);
    await get(forged('x3')).expect(429);
    const expired = new JwtService({ secret: SECRET }).sign({
      sub: 'y',
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    await get(expired).expect(429);
  });

  it('the per-IP ceiling still caps many users on one address', async () => {
    await build(100, 4);
    for (let i = 0; i < 4; i++)
      await get(jwt.sign({ sub: `u${i}` })).expect(200);
    await get(jwt.sign({ sub: 'u-next' })).expect(429);
  });

  it('a spoofed X-Forwarded-For does not change the bucket when no proxy is trusted', async () => {
    await build(2, 100, 0);
    await get(undefined, '1.1.1.1').expect(200);
    await get(undefined, '2.2.2.2').expect(200);
    await get(undefined, '3.3.3.3').expect(429);
  });

  it('login stays per-IP even when a valid token is sent', async () => {
    await build(100, 100);
    const post = (sub: string) =>
      request(app.getHttpServer())
        .post('/login')
        .set('Authorization', `Bearer ${jwt.sign({ sub })}`);
    await post('a').expect(201);
    await post('b').expect(201);
    await post('c').expect(429);
  });

  it('trustProxyHops: 1 in production, 0 otherwise, env override wins', () => {
    const prev = {
      env: process.env.NODE_ENV,
      hops: process.env.TRUST_PROXY_HOPS,
    };
    delete process.env.TRUST_PROXY_HOPS;
    process.env.NODE_ENV = 'production';
    expect(trustProxyHops()).toBe(1);
    process.env.NODE_ENV = 'development';
    expect(trustProxyHops()).toBe(0);
    process.env.TRUST_PROXY_HOPS = '2';
    expect(trustProxyHops()).toBe(2);
    process.env.NODE_ENV = prev.env;
    if (prev.hops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = prev.hops;
  });
});
