import type { Client, Row } from '@libsql/client';
import { Hono } from 'hono';
import type { DebtRecord, DebtStatus } from '../db.js';
import { validateCreateDebtsInput, validatePaymentNote } from '../validators.js';
import type { AuthEnv } from './auth.js';

function mapDebtRow(row: Row): DebtRecord {
  const creditorId = row.creditor_id === null ? null : Number(row.creditor_id);
  const debtorId = row.debtor_id === null ? null : Number(row.debtor_id);
  const creditorUsername =
    row.creditor_username === null ? null : String(row.creditor_username);
  const debtorUsername = row.debtor_username === null ? null : String(row.debtor_username);

  return {
    id: Number(row.id),
    creditorId,
    creditorUsername,
    creditorName: String(row.creditor_name ?? row.creditor_manual_name ?? 'Pemberi Utang'),
    debtorId,
    debtorUsername,
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

const VALID_STATUS_FILTERS = new Set([
  'all',
  'active',
  'unpaid',
  'pending_confirmation',
  'paid',
  'cancelled'
]);

const SELECT_DEBT_JOIN = `
  SELECT
    d.id,
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
  FROM debts d
  LEFT JOIN users c ON c.id = d.creditor_id
  LEFT JOIN users b ON b.id = d.debtor_id
`;

export function createDebtsRoutes(db: Client) {
  const router = new Hono<AuthEnv>();

  router.get('/', async (c) => {
    const user = c.get('user');
    const role = c.req.query('role') || 'all';
    const statusFilter = c.req.query('status') || 'all';

    if (!['all', 'debtor', 'creditor'].includes(role)) {
      return c.json({ error: 'Parameter role tidak valid.' }, 400);
    }
    if (!VALID_STATUS_FILTERS.has(statusFilter)) {
      return c.json({ error: 'Parameter status tidak valid.' }, 400);
    }

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (role === 'debtor') {
      conditions.push('d.debtor_id = ?');
      params.push(user.id);
    } else if (role === 'creditor') {
      conditions.push('d.creditor_id = ?');
      params.push(user.id);
    } else {
      conditions.push('(d.creditor_id = ? OR d.debtor_id = ?)');
      params.push(user.id, user.id);
    }

    if (statusFilter === 'active') {
      conditions.push("d.status IN ('unpaid', 'pending_confirmation')");
    } else if (statusFilter !== 'all') {
      conditions.push('d.status = ?');
      params.push(statusFilter);
    }

    const [listRes, summaryRes] = await db.batch(
      [
        {
          sql: `${SELECT_DEBT_JOIN}
          WHERE ${conditions.join(' AND ')}
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
          args: params
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

    const summaryRow = summaryRes.rows[0];
    const totalReceivable = Number(summaryRow?.total_receivable ?? 0);
    const totalPayable = Number(summaryRow?.total_payable ?? 0);

    return c.json({
      summary: {
        totalReceivableIdr: totalReceivable,
        totalPayableIdr: totalPayable,
        netBalanceIdr: totalReceivable - totalPayable,
        pendingConfirmationCount: Number(summaryRow?.pending_confirmations ?? 0),
        activeBillCount: Number(summaryRow?.active_bills ?? 0)
      },
      items: listRes.rows.map(mapDebtRow)
    });
  });

  router.post('/', async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const validated = validateCreateDebtsInput(body);
    if (!validated.ok || !validated.data) {
      return c.json({ error: validated.error }, 400);
    }

    const items = validated.data;
    const linkedDebtorIds = Array.from(
      new Set(
        items
          .filter((item) => item.recordType === 'receivable' && item.debtorId !== null)
          .map((item) => item.debtorId as number)
      )
    );

    for (const debtorId of linkedDebtorIds) {
      if (debtorId === user.id) {
        return c.json({ error: 'Tidak bisa mencatat piutang ke akun sendiri.' }, 400);
      }
    }

    if (linkedDebtorIds.length > 0) {
      const placeholders = linkedDebtorIds.map(() => '?').join(',');
      const foundUsers = await db.execute({
        sql: `SELECT id, role FROM users WHERE id IN (${placeholders})`,
        args: linkedDebtorIds
      });

      if (foundUsers.rows.length !== linkedDebtorIds.length) {
        return c.json({ error: 'Salah satu akun peminjam tidak ditemukan.' }, 404);
      }

      // Enforce server-side policy: admin accounts cannot be tagged as debtors
      const hasAdminTarget = foundUsers.rows.some((row) => String(row.role) === 'admin');
      if (hasAdminTarget) {
        return c.json({ error: 'Akun admin tidak dapat ditagih sebagai peminjam.' }, 400);
      }
    }

    const batchResults = await db.batch(
      items.map((item) => {
        if (item.recordType === 'payable') {
          return {
            sql: `INSERT INTO debts (creditor_id, debtor_id, creditor_manual_name, debtor_manual_name, amount_idr, description, due_date)
                  VALUES (NULL, ?, ?, NULL, ?, ?, ?)`,
            args: [user.id, item.creditorName, item.amountIdr, item.description, item.dueDate]
          };
        }
        return {
          sql: `INSERT INTO debts (creditor_id, debtor_id, creditor_manual_name, debtor_manual_name, amount_idr, description, due_date)
                VALUES (?, ?, NULL, ?, ?, ?, ?)`,
          args: [user.id, item.debtorId, item.debtorName, item.amountIdr, item.description, item.dueDate]
        };
      }),
      'write'
    );

    const createdIds = batchResults.map((res) => Number(res.lastInsertRowid));
    const idPlaceholders = createdIds.map(() => '?').join(',');
    const createdRes = await db.execute({
      sql: `${SELECT_DEBT_JOIN}
      WHERE d.id IN (${idPlaceholders})
      ORDER BY d.id ASC`,
      args: createdIds
    });

    return c.json({ items: createdRes.rows.map(mapDebtRow) }, 201);
  });

  async function findOwnedDebt(debtId: number) {
    const res = await db.execute({
      sql: 'SELECT id, creditor_id, debtor_id, status FROM debts WHERE id = ?',
      args: [debtId]
    });
    const row = res.rows[0];
    if (!row) return undefined;
    return {
      id: Number(row.id),
      creditor_id: row.creditor_id === null ? null : Number(row.creditor_id),
      debtor_id: row.debtor_id === null ? null : Number(row.debtor_id),
      status: String(row.status) as DebtStatus
    };
  }

  function parseDebtId(raw: string): number | null {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  router.patch('/:id/pay', async (c) => {
    const user = c.get('user');
    const debtId = parseDebtId(c.req.param('id'));
    if (!debtId) return c.json({ error: 'ID transaksi tidak valid.' }, 400);

    const debt = await findOwnedDebt(debtId);
    if (!debt) return c.json({ error: 'Catatan tidak ditemukan.' }, 404);
    if (debt.debtor_id !== user.id || debt.creditor_id === null) {
      return c.json({ error: 'Hanya peminjam pada tagihan terhubung yang dapat mengajukan konfirmasi bayar.' }, 403);
    }
    if (debt.status !== 'unpaid') {
      return c.json({ error: 'Tagihan ini tidak berada dalam status belum dibayar.' }, 409);
    }

    const body = await c.req.json().catch(() => null);
    const noteResult = validatePaymentNote(body);
    if (!noteResult.ok) {
      return c.json({ error: noteResult.error }, 400);
    }

    await db.execute({
      sql: `UPDATE debts
            SET status = 'pending_confirmation', payment_note = ?, updated_at = datetime('now')
            WHERE id = ?`,
      args: [noteResult.data ?? null, debtId]
    });

    return c.json({ ok: true, status: 'pending_confirmation' });
  });

  router.patch('/:id/confirm', async (c) => {
    const user = c.get('user');
    const debtId = parseDebtId(c.req.param('id'));
    if (!debtId) return c.json({ error: 'ID transaksi tidak valid.' }, 400);

    const debt = await findOwnedDebt(debtId);
    if (!debt) return c.json({ error: 'Catatan tidak ditemukan.' }, 404);

    // Creditor can settle any receivable; debtor can settle only their own manual payable (no creditor account)
    const canSettle =
      debt.creditor_id === user.id || (debt.creditor_id === null && debt.debtor_id === user.id);
    if (!canSettle) {
      return c.json({ error: 'Hanya pemilik catatan yang dapat melunaskan transaksi ini.' }, 403);
    }
    if (debt.status !== 'unpaid' && debt.status !== 'pending_confirmation') {
      return c.json({ error: 'Catatan ini sudah lunas atau dibatalkan.' }, 409);
    }

    const body = await c.req.json().catch(() => null);
    const noteResult = validatePaymentNote(body);
    if (!noteResult.ok) {
      return c.json({ error: noteResult.error }, 400);
    }

    // Preserve debtor's existing payment_note when creditor leaves the note empty
    await db.execute({
      sql: `UPDATE debts
            SET status = 'paid',
                payment_note = COALESCE(?, payment_note),
                paid_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [noteResult.data ?? null, debtId]
    });

    return c.json({ ok: true, status: 'paid' });
  });

  router.patch('/:id/reject', async (c) => {
    const user = c.get('user');
    const debtId = parseDebtId(c.req.param('id'));
    if (!debtId) return c.json({ error: 'ID transaksi tidak valid.' }, 400);

    const debt = await findOwnedDebt(debtId);
    if (!debt) return c.json({ error: 'Catatan tidak ditemukan.' }, 404);
    if (debt.creditor_id !== user.id) {
      return c.json({ error: 'Hanya pemberi utang yang dapat menolak konfirmasi bayar.' }, 403);
    }
    if (debt.status !== 'pending_confirmation') {
      return c.json({ error: 'Catatan tidak sedang menunggu konfirmasi.' }, 409);
    }

    await db.execute({
      sql: `UPDATE debts
            SET status = 'unpaid', updated_at = datetime('now')
            WHERE id = ?`,
      args: [debtId]
    });

    return c.json({ ok: true, status: 'unpaid' });
  });

  router.patch('/:id/cancel', async (c) => {
    const user = c.get('user');
    const debtId = parseDebtId(c.req.param('id'));
    if (!debtId) return c.json({ error: 'ID transaksi tidak valid.' }, 400);

    const debt = await findOwnedDebt(debtId);
    if (!debt) return c.json({ error: 'Catatan tidak ditemukan.' }, 404);

    const canCancel =
      debt.creditor_id === user.id || (debt.creditor_id === null && debt.debtor_id === user.id);
    if (!canCancel) {
      return c.json({ error: 'Hanya pemilik catatan yang dapat membatalkan transaksi ini.' }, 403);
    }
    if (debt.status !== 'unpaid' && debt.status !== 'pending_confirmation') {
      return c.json({ error: 'Catatan yang sudah lunas atau batal tidak dapat dibatalkan lagi.' }, 409);
    }

    await db.execute({
      sql: `UPDATE debts
            SET status = 'cancelled', updated_at = datetime('now')
            WHERE id = ?`,
      args: [debtId]
    });

    return c.json({ ok: true, status: 'cancelled' });
  });

  return router;
}
