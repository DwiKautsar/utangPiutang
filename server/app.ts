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

  // Single-roundtrip initial load for authenticated users (eliminates /me -> /users + /debts waterfall)
  app.get('/api/bootstrap', async (c) => {
    const user = await getAuthenticatedUser(db, c.req.header('cookie'));
    if (!user) {
      return c.json({ user: null });
    }
    if (user.role === 'admin') {
      return c.json({ user });
    }

    const [usersRes, debtsRes, summaryRes] = await db.batch(
      [
        {
          sql: `SELECT id, username, display_name
                FROM users
                WHERE id != ? AND role != 'admin'
                ORDER BY display_name COLLATE NOCASE ASC
                LIMIT 200`,
          args: [user.id]
        },
        {
          sql: `WITH numbered_debts AS (
            SELECT d.*, ROW_NUMBER() OVER (ORDER BY d.created_at ASC, d.id ASC) AS display_number
            FROM debts d
          )
          SELECT
            d.id,
            d.display_number,
            d.creditor_id,
            c.username AS creditor_username,
            c.display_name AS creditor_name,
            d.creditor_manual_name,
            d.debtor_id,
            b.username AS debtor_username,
            b.display_name AS debtor_name,
            d.debtor_manual_name,
            d.amount_idr,
            d.description,
            d.due_date,
            d.status,
            d.payment_note,
            d.paid_at,
            d.created_at,
            d.updated_at
          FROM numbered_debts d
          LEFT JOIN users c ON c.id = d.creditor_id
          LEFT JOIN users b ON b.id = d.debtor_id
          WHERE d.debtor_id = ?
          ORDER BY
            CASE d.status
              WHEN 'pending_confirmation' THEN 0
              WHEN 'unpaid' THEN 1
              WHEN 'paid' THEN 2
              ELSE 3
            END,
            d.created_at DESC,
            d.id DESC
          LIMIT 200`,
          args: [user.id]
        },
        {
          sql: `SELECT
            COALESCE(SUM(CASE WHEN creditor_id = ? AND status IN ('unpaid', 'pending_confirmation') THEN amount_idr ELSE 0 END), 0) AS total_receivable,
            COALESCE(SUM(CASE WHEN debtor_id = ? AND status IN ('unpaid', 'pending_confirmation') THEN amount_idr ELSE 0 END), 0) AS total_payable,
            COALESCE(SUM(CASE WHEN creditor_id = ? AND status = 'pending_confirmation' THEN 1 ELSE 0 END), 0) AS pending_confirmations,
            COALESCE(SUM(CASE WHEN debtor_id = ? AND status IN ('unpaid', 'pending_confirmation') THEN 1 ELSE 0 END), 0) AS active_bills
          FROM debts
          WHERE creditor_id = ? OR debtor_id = ?`,
          args: [user.id, user.id, user.id, user.id, user.id, user.id]
        }
      ],
      'read'
    );

    const s = summaryRes.rows[0];
    const totalReceivable = Number(s?.total_receivable ?? 0);
    const totalPayable = Number(s?.total_payable ?? 0);

    return c.json({
      user,
      users: usersRes.rows.map((row) => ({
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        role: 'user' as const
      })),
      summary: {
        totalReceivableIdr: totalReceivable,
        totalPayableIdr: totalPayable,
        netBalanceIdr: totalReceivable - totalPayable,
        pendingConfirmationCount: Number(s?.pending_confirmations ?? 0),
        activeBillCount: Number(s?.active_bills ?? 0)
      },
      items: debtsRes.rows.map((row) => {
        const creditorId = row.creditor_id === null ? null : Number(row.creditor_id);
        const debtorId = row.debtor_id === null ? null : Number(row.debtor_id);
        return {
          id: Number(row.id),
          displayNumber: Number(row.display_number ?? row.id),
          creditorId,
          creditorUsername: row.creditor_username === null ? null : String(row.creditor_username),
          creditorName: String(row.creditor_name ?? row.creditor_manual_name ?? 'Pemberi Utang'),
          debtorId,
          debtorUsername: row.debtor_username === null ? null : String(row.debtor_username),
          debtorName: String(row.debtor_name ?? row.debtor_manual_name ?? 'Peminjam'),
          isManual: creditorId === null || debtorId === null,
          amountIdr: Number(row.amount_idr),
          description: String(row.description),
          dueDate: row.due_date === null ? null : String(row.due_date),
          status: String(row.status),
          paymentNote: row.payment_note === null ? null : String(row.payment_note),
          paidAt: row.paid_at === null ? null : String(row.paid_at),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at)
        };
      })
    });
  });

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
