import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createDatabase } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3001);
const db = createDatabase();
const { app } = createApp({ db });

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

serve(
  {
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1'
  },
  (info) => {
    console.log(`BukuUtang server aktif di http://127.0.0.1:${info.port}`);
  }
);
