import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, authMiddleware } from '../index.js';
import {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  isValidEmail,
  isValidPassword,
} from '../auth.js';
import { _resetUsersCache } from '../users.js';
import { Hono } from 'hono';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.resolve(__dirname, '../../../data/users.json');

describe('Auth unit & endpoint tests', () => {
  beforeEach(() => {
    // Reset users.json for clean test state
    if (fs.existsSync(USERS_FILE)) {
      fs.unlinkSync(USERS_FILE);
    }
    _resetUsersCache();
  });

  describe('validation & crypto', () => {
    it('validates email format', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name+tag@sub.domain.co')).toBe(true);
      expect(isValidEmail('invalid-email')).toBe(false);
      expect(isValidEmail('@nodomain.com')).toBe(false);
      expect(isValidEmail('noatsign.com')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });

    it('validates password length (min 8 chars)', () => {
      expect(isValidPassword('12345678')).toBe(true);
      expect(isValidPassword('short')).toBe(false);
      expect(isValidPassword('')).toBe(false);
    });

    it('hashes and verifies password using scrypt', async () => {
      const hash = await hashPassword('my-secret-pass-123');
      expect(hash).toContain(':');
      expect(await verifyPassword('my-secret-pass-123', hash)).toBe(true);
      expect(await verifyPassword('wrong-password', hash)).toBe(false);
    });

    it('signs and verifies HMAC session tokens', () => {
      const token = createToken('user-123');
      expect(token).toContain('.');
      const session = verifyToken(token);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('user-123');

      // Tampered token fails
      expect(verifyToken(token + 'tamper')).toBeNull();
      expect(verifyToken('invalid.token')).toBeNull();
      expect(verifyToken('')).toBeNull();
    });
  });

  describe('/api/auth endpoints', () => {
    it('registers a new user and returns token + safe user', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ahmed@example.com',
          password: 'password123',
          name: 'أحمد',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data).toBeDefined();
      expect(body.data.token).toBeDefined();
      expect(body.data.user.email).toBe('ahmed@example.com');
      expect(body.data.user.name).toBe('أحمد');
      expect(body.data.user.id).toBeDefined();
      expect(body.data.user.passwordHash).toBeUndefined();
    });

    it('rejects registration with invalid email or password < 8', async () => {
      const badEmail = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bad-email', password: 'password123' }),
      });
      expect(badEmail.status).toBe(400);

      const badPass = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'valid@example.com', password: 'short' }),
      });
      expect(badPass.status).toBe(400);
    });

    it('rejects duplicate email with 409', async () => {
      await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dup@example.com', password: 'password123' }),
      });

      const dup = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dup@example.com', password: 'anotherpassword' }),
      });

      expect(dup.status).toBe(409);
      const json = (await dup.json()) as any;
      expect(json.error).toBeDefined();
    });

    it('logs in successfully and rejects wrong password or unknown email', async () => {
      await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'login@example.com', password: 'correctpass123' }),
      });

      // Successful login
      const good = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'login@example.com', password: 'correctpass123' }),
      });
      expect(good.status).toBe(200);
      const goodBody = (await good.json()) as any;
      expect(goodBody.data.token).toBeDefined();
      expect(goodBody.data.user.email).toBe('login@example.com');

      // Wrong password
      const badPass = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'login@example.com', password: 'wrongpassword' }),
      });
      expect(badPass.status).toBe(401);

      // Unknown email
      const badUser = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'unknown@example.com', password: 'correctpass123' }),
      });
      expect(badUser.status).toBe(401);
    });

    it('gets current user via /api/auth/me with Bearer token', async () => {
      const reg = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'me@example.com', password: 'password123', name: 'سارة' }),
      });
      const { data } = (await reg.json()) as any;
      const token = data.token;

      // Good token
      const me = await app.request('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(me.status).toBe(200);
      const meBody = (await me.json()) as any;
      expect(meBody.data.user.email).toBe('me@example.com');
      expect(meBody.data.user.name).toBe('سارة');

      // Bad token
      const badMe = await app.request('/api/auth/me', {
        headers: { Authorization: 'Bearer bad-token-xyz' },
      });
      expect(badMe.status).toBe(401);

      // Missing token
      const noMe = await app.request('/api/auth/me');
      expect(noMe.status).toBe(401);
    });

    it('logs out with valid token', async () => {
      const reg = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'logout@example.com', password: 'password123' }),
      });
      const { data } = (await reg.json()) as any;

      const logout = await app.request('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.token}` },
      });
      expect(logout.status).toBe(200);
    });

    it('authMiddleware protects downstream routes and attaches user', async () => {
      const testApp = new Hono();
      testApp.use('/protected/*', authMiddleware);
      testApp.get('/protected/test', (c) => {
        return c.json({ data: { userId: c.get('userId' as never) } });
      });

      const reg = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'mw@example.com', password: 'password123' }),
      });
      const { data } = (await reg.json()) as any;

      // Access protected route
      const ok = await testApp.request('/protected/test', {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      expect(ok.status).toBe(200);
      const okBody = (await ok.json()) as any;
      expect(okBody.data.userId).toBe(data.user.id);

      // Unauthorized without token
      const unauth = await testApp.request('/protected/test');
      expect(unauth.status).toBe(401);
    });
  });
});
