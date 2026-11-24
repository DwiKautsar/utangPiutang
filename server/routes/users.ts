import type { Client } from '@libsql/client';
import { Hono } from 'hono';
import type { AuthEnv } from './auth.ts';

export function createUsersRoutes(db: Client) {
  const router = new Hono<AuthEnv>();

  router.get('/', async (c) => {
    const currentUser = c.get('user');
    const res = await db.execute({
      sql: `SELECT id, username, display_name
            FROM users
            WHERE id != ?
            ORDER BY display_name COLLATE NOCASE ASC
            LIMIT 200`,
      args: [currentUser.id]
    });

    return c.json({
      users: res.rows.map((row) => ({
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name)
      }))
    });
  });

  return router;
}
