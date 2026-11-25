import type { Client, Row } from '@libsql/client';
import { Hono } from 'hono';
import type { DebtRecord, DebtStatus, UserRole } from '../db.js';
import { hashPassword } from '../security.js';
import type { AuthEnv } from './auth.js';

const VALID_DEBT_STATUSES = new Set<DebtStatus>([
  'unpaid',
  'pending_confirmation',
  'paid',
  'cancelled'
]);

const VALID_FILTERS = new Set([
  'all',
  'active',
  'unpaid',
  'pending_confirmation',
  'paid',
  'cancelled'
]);

function parsePositiveId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function mapDebtRow(row: Row): DebtRecord {
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
    status: String(row.status) as DebtStatus,
    paymentNote: row.payment_note === null ? null : String(row.payment_note),
    paidAt: row.paid_at === null ? null : String(row.paid_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function createAdminRoutes(db: Client) {
  const router = new Hono<AuthEnv>();

  router.get('/overview', async (c) => {
    const [userStats, debtStats] = await db.batch(
      [
        `SELECT
          COUNT(*) AS total_users,
          COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) AS total_admins
        FROM users`,
        `SELECT
          COALESCE(SUM(CASE WHEN status IN ('unpaid', 'pending_confirmation') THEN 1 ELSE 0 END), 0) AS active_count,
          COALESCE(SUM(CASE WHEN status IN ('unpaid', 'pending_confirmation') THEN amount_idr ELSE 0 END), 0) AS active_amount_idr,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_count
        FROM debts`
      ],
      'read'
    );

    const u = userStats.rows[0];
    const d = debtStats.rows[0];
    return c.json({
      overview: {
        totalUsers: Number(u?.total_users ?? 0),
        totalAdmins: Number(u?.total_admins ?? 0),
        activeDebtCount: Number(d?.active_count ?? 0),
        activeDebtAmountIdr: Number(d?.active_amount_idr ?? 0),
        paidDebtCount: Number(d?.paid_count ?? 0)
      }
    });
  });

  router.get('/users', async (c) => {
    const res = await db.execute(
      `SELECT
        u.id,
        u.username,
        u.display_name,
        u.role,
        u.created_at,
        (SELECT COUNT(*) FROM debts d WHERE d.creditor_id = u.id AND d.status IN ('unpaid', 'pending_confirmation')) AS active_receivable_count,
        (SELECT COUNT(*) FROM debts d WHERE d.debtor_id = u.id AND d.status IN ('unpaid', 'pending_confirmation')) AS active_payable_count
      FROM users u
      ORDER BY CASE u.role WHEN 'admin' THEN 0 ELSE 1 END, u.created_at ASC
      LIMIT 300`
    );

    return c.json({
      users: res.rows.map((row) => ({
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        role: (String(row.role) === 'admin' ? 'admin' : 'user') as UserRole,
        createdAt: String(row.created_at),
        activeReceivableCount: Number(row.active_receivable_count ?? 0),
        activePayableCount: Number(row.active_payable_count ?? 0)
      }))
    });
  });

  router.patch('/users/:id/role', async (c) => {
    const admin = c.get('user');
    const targetId = parsePositiveId(c.req.param('id'));
    if (!targetId) return c.json({ error: 'ID pengguna tidak valid.' }, 400);

    const body = (await c.req.json().catch(() => null)) as { role?: unknown } | null;
    const nextRole = body?.role;
    if (nextRole !== 'admin' && nextRole !== 'user') {
      return c.json({ error: 'Role harus bernilai admin atau user.' }, 400);
    }

    if (targetId === admin.id && nextRole !== 'admin') {
      return c.json({ error: 'Tidak dapat menurunkan role akun admin Anda sendiri.' }, 400);
    }

    const targetRes = await db.execute({
      sql: 'SELECT id, role FROM users WHERE id = ?',
      args: [targetId]
    });
    const target = targetRes.rows[0];
    if (!target) return c.json({ error: 'Akun tidak ditemukan.' }, 404);

    if (String(target.role) === 'admin' && nextRole === 'user') {
      const adminCountRes = await db.execute(
        "SELECT COUNT(*) AS total FROM users WHERE role = 'admin'"
      );
      if (Number(adminCountRes.rows[0]?.total ?? 0) <= 1) {
        return c.json({ error: 'Minimal harus ada satu akun admin aktif.' }, 409);
      }
    }

    await db.execute({
      sql: 'UPDATE users SET role = ? WHERE id = ?',
      args: [nextRole, targetId]
    });

    return c.json({ ok: true, role: nextRole });
  });

  router.patch('/users/:id/reset-password', async (c) => {
    const targetId = parsePositiveId(c.req.param('id'));
    if (!targetId) return c.json({ error: 'ID pengguna tidak valid.' }, 400);

    const body = (await c.req.json().catch(() => null)) as { newPassword?: unknown } | null;
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
    if (newPassword.length < 6 || newPassword.length > 128) {
      return c.json({ error: 'Password baru minimal 6 karakter dan maksimal 128 karakter.' }, 400);
    }

    const exists = await db.execute({
      sql: 'SELECT id FROM users WHERE id = ?',
      args: [targetId]
    });
    if (exists.rows.length === 0) {
      return c.json({ error: 'Akun tidak ditemukan.' }, 404);
    }

    const passwordHash = hashPassword(newPassword);
    // Invalidate existing sessions after password reset so old tokens cannot be reused
    await db.batch(
      [
        {
          sql: 'UPDATE users SET password_hash = ? WHERE id = ?',
          args: [passwordHash, targetId]
        },
        {
          sql: 'DELETE FROM sessions WHERE user_id = ?',
          args: [targetId]
        }
      ],
      'write'
    );

    return c.json({ ok: true });
  });

  router.delete('/users/:id', async (c) => {
    const admin = c.get('user');
    const targetId = parsePositiveId(c.req.param('id'));
    if (!targetId) return c.json({ error: 'ID pengguna tidak valid.' }, 400);

    if (targetId === admin.id) {
      return c.json({ error: 'Tidak dapat menghapus akun Anda sendiri.' }, 400);
    }

    const targetRes = await db.execute({
      sql: 'SELECT id, role FROM users WHERE id = ?',
      args: [targetId]
    });
    const target = targetRes.rows[0];
    if (!target) return c.json({ error: 'Akun tidak ditemukan.' }, 404);

    if (String(target.role) === 'admin') {
      const adminCountRes = await db.execute(
        "SELECT COUNT(*) AS total FROM users WHERE role = 'admin'"
      );
      if (Number(adminCountRes.rows[0]?.total ?? 0) <= 1) {
        return c.json({ error: 'Tidak dapat menghapus admin terakhir.' }, 409);
      }
    }

    await db.batch(
      [
        { sql: 'DELETE FROM sessions WHERE user_id = ?', args: [targetId] },
        { sql: 'DELETE FROM debts WHERE creditor_id = ? OR debtor_id = ?', args: [targetId, targetId] },
        { sql: 'DELETE FROM users WHERE id = ?', args: [targetId] }
      ],
      'write'
    );

    return c.json({ ok: true });
  });

  router.get('/debts', async (c) => {
    const statusFilter = c.req.query('status') || 'all';
    if (!VALID_FILTERS.has(statusFilter)) {
      return c.json({ error: 'Parameter status tidak valid.' }, 400);
    }

    let whereClause = '';
    const args: Array<string | number> = [];

    if (statusFilter === 'active') {
      whereClause = "WHERE d.status IN ('unpaid', 'pending_confirmation')";
    } else if (statusFilter !== 'all') {
      whereClause = 'WHERE d.status = ?';
      args.push(statusFilter);
    }

    const res = await db.execute({
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
      ${whereClause}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 300`,
      args
    });

    return c.json({
      items: res.rows.map(mapDebtRow)
    });
  });

  router.patch('/debts/:id/status', async (c) => {
    const debtId = parsePositiveId(c.req.param('id'));
    if (!debtId) return c.json({ error: 'ID transaksi tidak valid.' }, 400);

    const body = (await c.req.json().catch(() => null)) as { status?: unknown } | null;
    const nextStatus = typeof body?.status === 'string' ? (body.status as DebtStatus) : null;
    if (!nextStatus || !VALID_DEBT_STATUSES.has(nextStatus)) {
      return c.json({ error: 'Status transaksi tidak valid.' }, 400);
    }

    const exists = await db.execute({
      sql: 'SELECT id FROM debts WHERE id = ?',
      args: [debtId]
    });
    if (exists.rows.length === 0) {
      return c.json({ error: 'Catatan transaksi tidak ditemukan.' }, 404);
    }

    if (nextStatus === 'paid') {
      await db.execute({
        sql: `UPDATE debts
              SET status = 'paid', paid_at = COALESCE(paid_at, datetime('now')), updated_at = datetime('now')
              WHERE id = ?`,
        args: [debtId]
      });
    } else {
      await db.execute({
        sql: `UPDATE debts
              SET status = ?, paid_at = NULL, updated_at = datetime('now')
              WHERE id = ?`,
        args: [nextStatus, debtId]
      });
    }

    return c.json({ ok: true, status: nextStatus });
  });

  router.delete('/debts/:id', async (c) => {
    const debtId = parsePositiveId(c.req.param('id'));
    if (!debtId) return c.json({ error: 'ID transaksi tidak valid.' }, 400);

    const exists = await db.execute({
      sql: 'SELECT id FROM debts WHERE id = ?',
      args: [debtId]
    });
    if (exists.rows.length === 0) {
      return c.json({ error: 'Catatan transaksi tidak ditemukan.' }, 404);
    }

    await db.execute({
      sql: 'DELETE FROM debts WHERE id = ?',
      args: [debtId]
    });

    return c.json({ ok: true });
  });

  function parseArchiveMonths(raw: string | undefined): number {
    const num = Number(raw ?? 3);
    if (!Number.isInteger(num) || num < 1 || num > 24) return 3;
    return num;
  }

  // Mitigate Excel/CSV Formula Injection (OWASP) by neutralizing leading formula characters
  function escapeCsvCell(value: string | number | null | undefined): string {
    const raw = value === null || value === undefined ? '' : String(value);
    const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    const escaped = neutralized.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  const STATUS_TEXT_ID: Record<DebtStatus, string> = {
    unpaid: 'Belum Dibayar',
    pending_confirmation: 'Menunggu Konfirmasi',
    paid: 'Lunas',
    cancelled: 'Dibatalkan'
  };

  router.get('/archive/preview', async (c) => {
    const months = parseArchiveMonths(c.req.query('months'));
    const includeUnpaid = c.req.query('includeUnpaid') === '1';
    const statusClause = includeUnpaid ? '' : "AND status IN ('paid', 'cancelled')";

    const res = await db.execute({
      sql: `SELECT
              COUNT(*) AS total_count,
              COALESCE(SUM(amount_idr), 0) AS total_amount
            FROM debts
            WHERE created_at <= datetime('now', ?) ${statusClause}`,
      args: [`-${months} months`]
    });

    const row = res.rows[0];
    return c.json({
      preview: {
        months,
        includeUnpaid,
        count: Number(row?.total_count ?? 0),
        totalAmountIdr: Number(row?.total_amount ?? 0)
      }
    });
  });

  router.get('/archive/export', async (c) => {
    const scope = c.req.query('scope') === 'all' ? 'all' : 'archive';
    const months = parseArchiveMonths(c.req.query('months'));
    const includeUnpaid = c.req.query('includeUnpaid') === '1';

    let whereClause = '';
    const args: Array<string | number> = [];

    if (scope === 'archive') {
      whereClause = includeUnpaid
        ? "WHERE d.created_at <= datetime('now', ?)"
        : "WHERE d.created_at <= datetime('now', ?) AND d.status IN ('paid', 'cancelled')";
      args.push(`-${months} months`);
    }

    const res = await db.execute({
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
      ${whereClause}
      ORDER BY d.created_at ASC, d.id ASC`,
      args
    });

    const header = [
      'No',
      'Tanggal Catat',
      'Pemberi Utang',
      'Peminjam',
      'Nominal (Rp)',
      'Keterangan',
      'Jatuh Tempo',
      'Status',
      'Catatan Pembayaran',
      'Tanggal Lunas'
    ];

    const lines = [header.map(escapeCsvCell).join(',')];
    for (const row of res.rows) {
      const item = mapDebtRow(row);
      const creditorLabel = item.creditorUsername
        ? `${item.creditorName} (@${item.creditorUsername})`
        : `${item.creditorName} (Manual)`;
      const debtorLabel = item.debtorUsername
        ? `${item.debtorName} (@${item.debtorUsername})`
        : `${item.debtorName} (Manual)`;

      lines.push(
        [
          `#${String(item.displayNumber).padStart(3, '0')}`,
          item.createdAt,
          creditorLabel,
          debtorLabel,
          item.amountIdr,
          item.description,
          item.dueDate ?? '-',
          STATUS_TEXT_ID[item.status] ?? item.status,
          item.paymentNote ?? '-',
          item.paidAt ?? '-'
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const filename =
      scope === 'all'
        ? `bukuutang-semua-${today}.csv`
        : `bukuutang-arsip-${months}bulan-${today}.csv`;

    // UTF-8 BOM ensures Microsoft Excel opens Indonesian characters cleanly
    const csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;
    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store'
      }
    });
  });

  router.post('/archive/purge', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      months?: unknown;
      includeUnpaid?: unknown;
    } | null;

    const months = parseArchiveMonths(
      body?.months !== undefined ? String(body.months) : undefined
    );
    const includeUnpaid = body?.includeUnpaid === true;
    const statusClause = includeUnpaid ? '' : "AND status IN ('paid', 'cancelled')";

    const delRes = await db.execute({
      sql: `DELETE FROM debts WHERE created_at <= datetime('now', ?) ${statusClause}`,
      args: [`-${months} months`]
    });

    return c.json({
      ok: true,
      deletedCount: Number(delRes.rowsAffected ?? 0),
      months,
      includeUnpaid
    });
  });

  return router;
}
