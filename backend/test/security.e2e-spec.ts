/**
 * Security end-to-end tests: authentication, roles, rate limiting, headers, validation and socket auth.
 * Needs the Docker stack running:  npm run test:e2e
 */
import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { io } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/auth.types';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../src/auth/decorators';
import { bootTestApp, cleanUpTestQueue, clearRateLimits, client, TEST_PASSWORD, TestTokens } from './helpers';

const UUID = '00000000-0000-4000-a000-000000000000';

describe('Security (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let url: string;
  let tokens: TestTokens;

  beforeAll(async () => {
    ({ app, db, url, tokens } = await bootTestApp());
  });

  afterAll(async () => {
    if (app) await cleanUpTestQueue(app);
    await app?.close();
  });

  const anonymous = () => client(app);
  const admin = () => client(app, tokens.admin);
  const viewer = () => client(app, tokens.viewer);

  describe('authentication (401)', () => {
    it('rejects requests without a token, but keeps health checks public', async () => {
      await anonymous().get('/api/assets').expect(401);
      await anonymous().get('/api/findings').expect(401);
      await anonymous().get('/api/health').expect(200);
    });

    it('rejects garbage, wrongly signed, expired and "alg: none" tokens', async () => {
      const jwt = app.get(JwtService);
      const claims = { sub: UUID, email: 'x@test.local', role: 'admin' };
      const base64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

      const bad = [
        'not-a-jwt',
        jwt.sign(claims, { secret: 'a-completely-different-secret-of-32+chars', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }),
        jwt.sign(claims, { expiresIn: -10, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }),
        jwt.sign(claims, { issuer: 'someone-else', audience: JWT_AUDIENCE }),
        // Classic attack: claim "no algorithm" and drop the signature.
        `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ ...claims, iss: JWT_ISSUER, aud: JWT_AUDIENCE })}.`,
      ];
      for (const token of bad) {
        await client(app, token).get('/api/assets').expect(401);
      }
    });
  });

  describe('login', () => {
    beforeEach(() => clearRateLimits(app));

    it('returns a working token for correct credentials, without the password hash', async () => {
      const { body } = await anonymous()
        .post('/api/auth/login')
        .send({ email: '  Admin@TEST.local ', password: TEST_PASSWORD }) // normalised: trimmed + lower-cased
        .expect(200);

      expect(body).toMatchObject({ tokenType: 'Bearer', user: { email: 'admin@test.local', role: 'admin' } });
      expect(JSON.stringify(body)).not.toMatch(/password/i);
      const me = await client(app, body.accessToken).get('/api/auth/me').expect(200);
      expect(me.body).toMatchObject({ email: 'admin@test.local', role: 'admin' });
    });

    it('gives the SAME answer for a wrong password and an unknown email (no account enumeration)', async () => {
      const wrongPassword = await anonymous().post('/api/auth/login').send({ email: 'admin@test.local', password: 'nope-nope-nope' }).expect(401);
      const unknownUser = await anonymous().post('/api/auth/login').send({ email: 'ghost@test.local', password: 'nope-nope-nope' }).expect(401);

      expect(wrongPassword.body.message).toBe(unknownUser.body.message);
    });

    it('rate-limits login attempts per client (5 per minute)', async () => {
      const attempt = () => anonymous().post('/api/auth/login').send({ email: 'admin@test.local', password: 'guess-guess-guess' });
      for (let i = 0; i < 5; i++) await attempt().expect(401);

      const blocked = await attempt().expect(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    });

    afterAll(() => clearRateLimits(app));
  });

  describe('authorisation (403)', () => {
    it('lets a viewer read', async () => {
      await viewer().get('/api/assets').expect(200);
      await viewer().get('/api/findings').expect(200);
      await viewer().get('/api/risk/rules').expect(200);
    });

    it.each([
      ['POST', '/api/assets'],
      ['PATCH', `/api/assets/${UUID}`],
      ['DELETE', `/api/assets/${UUID}`],
      ['POST', `/api/assets/${UUID}/scans`],
      ['POST', '/api/scan-jobs'],
      ['POST', '/api/scanner/scan'],
      ['POST', '/api/users'],
      ['GET', '/api/users'],
      ['POST', '/api/crypto/sign'],
    ])('forbids a viewer from %s %s', async (method, path) => {
      const req = viewer()[method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](path);
      await req.send({}).expect(403);
    });

    it('lets an admin create a viewer, and never returns password hashes', async () => {
      const created = await admin()
        .post('/api/users')
        .send({ email: 'new.viewer@test.local', password: 'a-long-enough-password', role: 'viewer' })
        .expect(201);
      expect(created.body).toMatchObject({ email: 'new.viewer@test.local', role: 'viewer' });

      const list = await admin().get('/api/users').expect(200);
      expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|scrypt\$/);
      const [row] = await db.query(`SELECT password_hash FROM users WHERE email = 'new.viewer@test.local'`);
      expect(row.password_hash).toMatch(/^scrypt\$131072\$8\$1\$/); // stored hashed with production parameters
    });

    it('enforces the password policy', async () => {
      await admin().post('/api/users').send({ email: 'weak@test.local', password: 'short', role: 'viewer' }).expect(400);
      await admin().post('/api/users').send({ email: 'x@test.local', password: 'a-long-enough-password', role: 'root' }).expect(400);
    });

    it('every route that changes data is either admin-only or explicitly public (audit of all controllers)', () => {
      const unprotected: string[] = [];
      for (const module of app.get(ModulesContainer).values()) {
        for (const wrapper of module.controllers.values()) {
          const controller = wrapper.metatype as { prototype: Record<string, unknown> } | null;
          if (!controller) continue;
          for (const name of Object.getOwnPropertyNames(controller.prototype)) {
            const handler = controller.prototype[name];
            if (typeof handler !== 'function') continue;
            const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
            if (method === undefined || method === RequestMethod.GET) continue;

            const roles: string[] = Reflect.getMetadata(ROLES_KEY, handler) ?? Reflect.getMetadata(ROLES_KEY, controller) ?? [];
            const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? Reflect.getMetadata(IS_PUBLIC_KEY, controller);
            if (!isPublic && !roles.includes('admin')) {
              unprotected.push(`${RequestMethod[method]} ${Reflect.getMetadata(PATH_METADATA, handler)} (${name})`);
            }
          }
        }
      }
      expect(unprotected).toEqual([]);
    });
  });

  describe('hardening', () => {
    it('sends security headers (helmet) and hides the framework', async () => {
      const res = await anonymous().get('/api/health').expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('rejects unknown fields and oversized bodies', async () => {
      await admin().post('/api/assets').send({ host: 'ok.com', isAdmin: true }).expect(400);
      await admin().post('/api/scan-jobs').send({ assetIds: ['x'.repeat(200_000)] }).expect(413);
    });
  });

  describe('Socket.IO authentication', () => {
    const connect = (auth: object) =>
      new Promise<string>((resolve) => {
        const socket = io(`${url}/scans`, { transports: ['websocket'], auth, reconnection: false });
        socket.on('connect', () => {
          socket.disconnect();
          resolve('connected');
        });
        socket.on('connect_error', (err) => resolve(err.message));
      });

    it('refuses connections without a valid token and accepts a viewer token', async () => {
      expect(await connect({})).toBe('Unauthorized: missing token');
      expect(await connect({ token: 'garbage' })).toBe('Unauthorized: invalid or expired token');
      expect(await connect({ token: tokens.viewer })).toBe('connected');
    });
  });
});

describe('Crypto-agility API (e2e)', () => {
  let app: INestApplication;
  let tokens: TestTokens;

  beforeAll(async () => {
    ({ app, tokens } = await bootTestApp());
  });

  afterAll(async () => {
    if (app) await cleanUpTestQueue(app);
    await app?.close();
  });

  it('lists providers with the active one marked', async () => {
    const { body } = await client(app, tokens.viewer).get('/api/crypto/providers').expect(200);

    expect(body.map((p: { algorithm: string }) => p.algorithm)).toContain('ML-DSA-65');
    expect(body.find((p: { active: boolean }) => p.active)).toMatchObject({ algorithm: 'ECDSA-P256-SHA256', available: true });
  });

  it('admin signs; a viewer verifies; tampering is detected', async () => {
    const signed = await client(app, tokens.admin).post('/api/crypto/sign').send({ message: 'scan report #42' }).expect(200);
    expect(signed.body).toMatchObject({ algorithm: 'ECDSA-P256-SHA256', quantumSafe: false });

    const envelope = { algorithm: signed.body.algorithm, signature: signed.body.signature, keyId: signed.body.keyId };
    const ok = await client(app, tokens.viewer).post('/api/crypto/verify').send({ message: 'scan report #42', ...envelope }).expect(200);
    const tampered = await client(app, tokens.viewer).post('/api/crypto/verify').send({ message: 'scan report #43', ...envelope }).expect(200);

    expect(ok.body.valid).toBe(true);
    expect(tampered.body.valid).toBe(false);
  });

  it('rejects unknown algorithms and bad signatures at the validation layer', async () => {
    await client(app, tokens.admin).post('/api/crypto/sign').send({ message: 'x', algorithm: 'MD5-RSA' }).expect(400);
    await client(app, tokens.viewer)
      .post('/api/crypto/verify')
      .send({ message: 'x', algorithm: 'ECDSA-P256-SHA256', signature: 'not base64!!', keyId: '0123456789abcdef' })
      .expect(400);
  });
});
