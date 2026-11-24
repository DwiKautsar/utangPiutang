import type { Client } from '@libsql/client';
import { Hono } from 'hono';
import { ensureDatabaseReady } from './schema.js';
import { csrfGuard, securityHeaders } from './security.js';
import { createAuthRoutes, getAuthenticatedUser, type AuthEnv } from './routes/auth.js';
import { createUsersRoutes } from './routes/users.js';
import { createDebtsRoutes } from './routes/debts.js';
import { createAdminRoutes } from './routes/admin.js';

export interface AppOptions {
  db: Client;
  enableRateLimit?: boolean;
  configError?: string;
}

export function createApp(options: AppOptions) {
  const { db, configError } = options;
  const app = new Hono<AuthEnv>();

  app.use('*', securityHeaders);
  app.use('/api/*', csrfGuard);

  app.get('/api/health', (c) =>
    c.json({
      status: configError ? 'misconfigured' : 'ok',
      error: configError ?? null
    })
  );

  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next();
    if (configError) {
      return c.json({ error: configError }, 500);
    }
    await ensureDatabaseReady(db);
    return next();
  });

  app.route('/api/auth', createAuthRoutes(db, options.enableRateLimit ?? true));

  const requireAuth = async (
    c: Parameters<typeof csrfGuard>[0],
    next: Parameters<typeof csrfGuard>[1]
  ) => {
    const user = await getAuthenticatedUser(db, c.req.header('cookie'));
    if (!user) {
      return c.json({ error: 'Silakan masuk terlebih dahulu.' }, 401);
    }
    c.set('user', user);
    return next();
  };

  const requireAdmin = async (
    c: Parameters<typeof csrfGuard>[0],
    next: Parameters<typeof csrfGuard>[1]
  ) => {
    const user = c.get('user');
    if (!user || user.role !== 'admin') {
      return c.json({ error: 'Akses ditolak. Hanya admin yang diizinkan.' }, 403);
    }
    return next();
  };

  app.use('/api/users/*', requireAuth);
  app.use('/api/users', requireAuth);
  app.route('/api/users', createUsersRoutes(db));

  app.use('/api/debts/*', requireAuth);
  app.use('/api/debts', requireAuth);
  app.route('/api/debts', createDebtsRoutes(db));

  app.use('/api/admin/*', requireAuth, requireAdmin);
  app.use('/api/admin', requireAuth, requireAdmin);
  app.route('/api/admin', createAdminRoutes(db));

  app.onError((_err, c) => {
    return c.json({ error: 'Terjadi gangguan pada server. Coba beberapa saat lagi.' }, 500);
  });

  return { app, db };
}
