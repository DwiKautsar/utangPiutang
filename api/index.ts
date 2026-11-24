import { handle } from 'hono/vercel';
import { createClient } from '@libsql/client/web';
import { createApp } from '../server/app.js';

const rawUrl = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

const configError = !rawUrl
  ? 'Konfigurasi TURSO_DATABASE_URL belum diatur di Environment Variables Vercel.'
  : undefined;

const db = createClient({
  url: rawUrl || 'https://unconfigured.turso.invalid',
  authToken: authToken || undefined
});

const { app } = createApp({ db, configError });
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
