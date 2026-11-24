import type { Client } from '@libsql/client';
import { Hono } from 'hono';
import type { PublicUser } from '../db.ts';
import {
  buildSessionCookie,
  clearSessionCookie,
  createRateLimiter,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_DAYS,
  verifyPassword
} from '../security.ts';
import { validateLoginInput, validateRegisterInput } from '../validators.ts';

export interface AuthEnv {
  Variables: {
    user: PublicUser;
  };
}

export async function getAuthenticatedUser(
  db: Client,
  cookieHeader: string | undefined
): Promise<PublicUser | null> {
  const rawToken = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);
  const res = await db.execute({
    sql: `SELECT u.id, u.username, u.display_name
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    args: [tokenHash]
  });

  const row = res.rows[0];
  if (!row) return null;

  return {
    id: Number(row.id),
    username: String(row.username),
    displayName: String(row.display_name)
  };
}

async function issueSession(db: Client, userId: number): Promise<{ cookie: string }> {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;

  await db.execute({
    sql: `INSERT INTO sessions (token_hash, user_id, expires_at)
          VALUES (?, ?, datetime('now', ?))`,
    args: [tokenHash, userId, `+${SESSION_TTL_DAYS} days`]
  });

  return { cookie: buildSessionCookie(rawToken, maxAge) };
}

export function createAuthRoutes(db: Client, enableRateLimit = true) {
  const router = new Hono();
  const authLimiter = createRateLimiter(60_000, 20);

  if (enableRateLimit) {
    router.use('/login', authLimiter);
    router.use('/register', authLimiter);
  }

  router.post('/register', async (c) => {
    const body = await c.req.json().catch(() => null);
    const validated = validateRegisterInput(body);
    if (!validated.ok || !validated.data) {
      return c.json({ error: validated.error }, 400);
    }

    const { username, displayName, password } = validated.data;
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE username = ?',
      args: [username]
    });

    if (existing.rows.length > 0) {
      return c.json({ error: 'Username sudah terdaftar. Pilih username lain.' }, 409);
    }

    const passwordHash = hashPassword(password);
    const result = await db.execute({
      sql: 'INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)',
      args: [username, displayName, passwordHash]
    });

    const userId = Number(result.lastInsertRowid);
    const { cookie } = await issueSession(db, userId);
    c.header('Set-Cookie', cookie);

    return c.json(
      {
        user: {
          id: userId,
          username,
          displayName
        }
      },
      201
    );
  });

  router.post('/login', async (c) => {
    const body = await c.req.json().catch(() => null);
    const validated = validateLoginInput(body);
    if (!validated.ok || !validated.data) {
      return c.json({ error: validated.error }, 400);
    }

    const { username, password } = validated.data;
    const res = await db.execute({
      sql: 'SELECT id, username, display_name, password_hash FROM users WHERE username = ?',
      args: [username]
    });

    const row = res.rows[0];
    if (!row || !verifyPassword(password, String(row.password_hash))) {
      return c.json({ error: 'Username atau password salah.' }, 401);
    }

    const userId = Number(row.id);
    const { cookie } = await issueSession(db, userId);
    c.header('Set-Cookie', cookie);

    return c.json({
      user: {
        id: userId,
        username: String(row.username),
        displayName: String(row.display_name)
      }
    });
  });

  router.post('/logout', async (c) => {
    const rawToken = parseCookie(c.req.header('cookie'), SESSION_COOKIE_NAME);
    if (rawToken) {
      const tokenHash = hashSessionToken(rawToken);
      await db.execute({
        sql: 'DELETE FROM sessions WHERE token_hash = ?',
        args: [tokenHash]
      });
    }
    c.header('Set-Cookie', clearSessionCookie());
    return c.json({ ok: true });
  });

  router.get('/me', async (c) => {
    const user = await getAuthenticatedUser(db, c.req.header('cookie'));
    return c.json({ user: user ?? null });
  });

  return router;
}
