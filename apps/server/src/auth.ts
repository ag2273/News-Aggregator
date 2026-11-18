import crypto from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { findUserById, toSafeUser, type SafeUser } from './users.js';

const AUTH_SECRET =
  process.env['AUTH_SECRET'] ||
  (() => {
    console.warn('[auth] WARNING: AUTH_SECRET not set, using dev fallback');
    return 'dev-insecure-secret-key-change-in-prod';
  })();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

export function isValidPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 8;
}

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = stored.split(':');
    if (!salt || !key) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      const keyBuffer = Buffer.from(key, 'hex');
      if (keyBuffer.length !== derivedKey.length) return resolve(false);
      resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
    });
  });
}

export function createToken(userId: string): string {
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // ~30 days
  const payload = Buffer.from(JSON.stringify({ userId, exp: expiresAt })).toString('base64url');
  const hmac = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${hmac}`;
}

export function verifyToken(token: string): { userId: string } | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) return null;

  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payloadStr).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));
    if (!payload.userId || typeof payload.exp !== 'number') return null;
    if (Date.now() > payload.exp) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

/**
 * Extracts and verifies the user ID from an Authorization header ("Bearer <token>").
 * Returns the verified userId or null if invalid/missing.
 */
export function extractUserId(authHeader?: string): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const session = verifyToken(token);
  return session ? session.userId : null;
}

export interface AuthContextVariables {
  userId: string;
  user: SafeUser;
}

/**
 * Auth middleware helper: verifies Bearer token, finds user, and attaches
 * userId and user to Hono context. Future protected routes (T5 follow, T6 save)
 * reuse this.
 */
export const authMiddleware: MiddlewareHandler<{ Variables: AuthContextVariables }> = async (
  c,
  next,
) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const user = findUserById(userId);
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('userId', user.id);
  c.set('user', toSafeUser(user));
  await next();
};
