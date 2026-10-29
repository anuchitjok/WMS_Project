import request from 'supertest';
import { UserRole } from '@prisma/client';
import { Fixture, TestUser, expectStatus } from './harness';

/** Minimal PNG header: signature + IHDR with the given size (enough for content checks). */
function png(width: number, height: number, padTo = 0) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 6; // RGBA
  const b = Buffer.concat([sig, ihdr]);
  return padTo > b.length ? Buffer.concat([b, Buffer.alloc(padTo - b.length)]) : b;
}

/** Minimal JPEG: SOI, APP0 (JFIF), SOF0 with the given size, EOI. */
function jpeg(width: number, height: number) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

describe('Company profile and official logo (integration)', () => {
  let fx: Fixture;
  let admin: TestUser;
  let manager: TestUser;
  let requester: TestUser;

  const upload = (u: TestUser, buf: Buffer, filename: string, contentType: string) =>
    request(fx.app.getHttpServer())
      .post('/api/company-profile/logo')
      .set('Authorization', `Bearer ${fx.token(u)}`)
      .attach('file', buf, { filename, contentType });

  beforeAll(async () => {
    fx = await Fixture.start();
    admin = await fx.user(UserRole.SYSTEM_ADMIN);
    manager = await fx.user(UserRole.WAREHOUSE_MANAGER);
    requester = await fx.user(UserRole.REQUESTER);
  });
  afterAll(() => fx?.stop());

  it('starts empty — nothing is seeded', async () => {
    const res = await fx.as(manager).get('/company-profile');
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ legalName: null, hasLogo: false, configured: false, canEdit: false });
    expect((await fx.as(manager).get('/company-profile/logo')).body).toEqual({ dataUrl: null });
  });

  it('only settings administrators can change the company details', async () => {
    expectStatus(await fx.as(manager).put('/company-profile', { legalName: 'X' }), 403);
    expectStatus(await fx.as(requester).put('/company-profile', { legalName: 'X' }), 403);
    const res = await fx.as(admin).put('/company-profile', {
      legalName: 'Example Services Co., Ltd.', displayName: 'Example Services',
      address: '1 Test Road, Bangkok', phone: '+66 2 000 0000', email: 'sales@example.test',
      website: 'www.example.test', defaultTerms: 'Payment: as agreed in the purchase order\nPrices exclude transport',
    });
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ configured: true, canEdit: true, version: 0 });
    expectStatus(await fx.as(admin).put('/company-profile', { email: 'not-an-email', version: 0 }), 400);
    // Optimistic lock.
    expectStatus(await fx.as(admin).put('/company-profile', { phone: '1', version: 7 }), 409);
    const again = await fx.as(requester).get('/company-profile');
    expect(again.body).toMatchObject({ legalName: 'Example Services Co., Ltd.', canEdit: false });
  });

  it('accepts PNG and JPEG by content, refuses anything else', async () => {
    expectStatus(await upload(manager, png(400, 120), 'logo.png', 'image/png'), 403);
    // An SVG renamed .png with an image/png type is still refused (content is checked).
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const bad = await upload(admin, svg, 'logo.png', 'image/png');
    expectStatus(bad, 400);
    expect(bad.body.message).toContain('Only PNG or JPEG');
    // Too small, too narrow, too big.
    expect((await upload(admin, png(100, 20), 'a.png', 'image/png')).body.message).toContain('too small');
    expect((await upload(admin, png(3000, 100), 'a.png', 'image/png')).body.message).toContain('too narrow');
    const big = await upload(admin, png(400, 120, 1024 * 1024 + 10), 'a.png', 'image/png');
    expect([400, 413]).toContain(big.status);
    expect(big.body.message).toMatch(/1 MB|too large/i);
    expectStatus(await upload(admin, Buffer.alloc(0), 'a.png', 'image/png'), 400);

    // A JPEG sent with a misleading type is stored as what it really is.
    const ok = await upload(admin, jpeg(600, 200), 'logo.gif', 'image/gif');
    expectStatus(ok, 201);
    expect(ok.body).toMatchObject({ hasLogo: true, logoMime: 'image/jpeg', logoWidth: 600, logoHeight: 200 });
  });

  it('replaces, persists and removes the logo', async () => {
    const rep = await upload(admin, png(800, 240), 'new.png', 'image/png');
    expectStatus(rep, 201);
    expect(rep.body).toMatchObject({ logoMime: 'image/png', logoWidth: 800, logoHeight: 240 });
    const logo = await fx.as(requester).get('/company-profile/logo');
    expectStatus(logo, 200);
    expect(logo.body.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(logo.body.dataUrl.split(',')[1], 'base64').equals(png(800, 240))).toBe(true);

    expectStatus(await fx.as(manager).delete('/company-profile/logo'), 403);
    const del = await fx.as(admin).delete('/company-profile/logo');
    expectStatus(del, 200);
    expect(del.body).toMatchObject({ hasLogo: false, logoMime: null, legalName: 'Example Services Co., Ltd.' });
    expect((await fx.as(admin).get('/company-profile/logo')).body).toEqual({ dataUrl: null });

    const actions = await fx.prisma.auditLog.findMany({ where: { entityType: 'CompanyProfile' }, select: { action: true } });
    expect(new Set(actions.map((a) => a.action))).toEqual(
      new Set(['COMPANY_PROFILE_UPDATE', 'COMPANY_LOGO_UPLOAD', 'COMPANY_LOGO_REPLACE', 'COMPANY_LOGO_REMOVE']),
    );
  });
});
