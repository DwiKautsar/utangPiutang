import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { createDatabase, ensureDatabaseReady } from './db.ts';
import { csrfGuard, securityHeaders } from './security.ts';
import { createAuthRoutes, getAuthenticatedUser, type AuthEnv } from './routes/auth.ts';
import { createUsersRoutes } from './routes/users.ts';
import { createDebtsRoutes } from './routes/debts.ts';

export interface AppOptions {
  dbUrl?: string;
  dbAuthToken?: string;
  enableRateLimit?: boolean;
  serveDist?: boolean;
}

export function createApp(options: AppOptions = {}) {
  const db = createDatabase({
    url: options.dbUrl,
    authToken: options.dbAuthToken
  });
  const app = new Hono<AuthEnv>();

  app.use('*', securityHeaders);
  app.use('/api/*', csrfGuard);
  app.use('/api/*', async (_c, next) => {
    await ensureDatabaseReady(db);
    return next();
  });

  app.get('/api/health', (c) => c.json({ status: 'ok' }));
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

  app.use('/api/users/*', requireAuth);
  app.use('/api/users', requireAuth);
  app.route('/api/users', createUsersRoutes(db));

  app.use('/api/debts/*', requireAuth);
  app.use('/api/debts', requireAuth);
  app.route('/api/debts', createDebtsRoutes(db));

  app.onError((_err, c) => {
    return c.json({ error: 'Terjadi gangguan pada server. Coba beberapa saat lagi.' }, 500);
  });

  if (options.serveDist) {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use('/assets/*', serveStatic({ root: './dist' }));
      app.get('*', (c) => {
        if (c.req.path.startsWith('/api/')) {
          return c.json({ error: 'Endpoint tidak ditemukan.' }, 404);
        }
        const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
        return c.html(indexHtml);
      });
    }
  }

  return { app, db };
}
