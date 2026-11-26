import crypto from 'node:crypto';
import type { Context, Next } from 'hono';

export const SESSION_COOKIE_NAME = 'bukuutang_sid';
export const SESSION_TTL_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;

  const expectedBuf = Buffer.from(keyHex, 'hex');
  const actualBuf = crypto.scryptSync(password, salt, 64);
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Store only token hash in SQLite so database exposure does not leak live sessions
export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  const isSecureEnv =
    process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isSecureEnv) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookie(): string {
  return buildSessionCookie('', 0);
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const pairs = header.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    if (key === name) {
      return pair.slice(idx + 1).trim();
    }
  }
  return null;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(windowMs: number, maxRequests: number) {
  const buckets = new Map<string, RateBucket>();

  return async function rateLimitMiddleware(c: Context, next: Next) {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'local';
    const key = `${c.req.path}:${ip}`;
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || now > existing.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (existing.count >= maxRequests) {
      return c.json(
        { error: 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.' },
        429
      );
    }

    existing.count += 1;
    return next();
  };
}

// Mitigate cross-site state-changing requests by requiring an explicit custom header
export async function csrfGuard(c: Context, next: Next) {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const requestedWith = c.req.header('x-requested-with');
  if (requestedWith !== 'BukuUtang') {
    return c.json({ error: 'Permintaan tidak valid (header keamanan tidak sesuai).' }, 403);
  }

  return next();
}

export async function securityHeaders(c: Context, next: Next) {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none';"
  );
}
