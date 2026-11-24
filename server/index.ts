import { serve } from '@hono/node-server';
import { createApp } from './app.ts';

const port = Number(process.env.PORT || 3001);
const { app } = createApp({ serveDist: true });

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
