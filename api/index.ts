import { handle } from 'hono/vercel';
import { createApp } from '../server/app.ts';

const { app } = createApp({
  serveDist: false
});

export default handle(app);
