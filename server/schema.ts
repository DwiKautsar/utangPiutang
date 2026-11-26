import type { Client } from '@libsql/client';

const initPromises = new WeakMap<Client, Promise<void>>();

// Fast-path schema check avoids running write DDL on every Vercel serverless cold start
export function ensureDatabaseReady(db: Client): Promise<void> {
  const existing = initPromises.get(db);
  if (existing) return existing;

  const promise = (async () => {
    const [tablesRes, usersInfo, debtsInfo] = await db.batch(
      [
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'sessions', 'debts')",
        'PRAGMA table_info(users)',
        'PRAGMA table_info(debts)'
      ],
      'read'
    );

    const existingTables = new Set(tablesRes.rows.map((r) => String(r.name)));
    const allTablesExist =
      existingTables.has('users') &&
      existingTables.has('sessions') &&
      existingTables.has('debts');
    const hasRoleColumn = usersInfo.rows.some((r) => String(r.name) === 'role');
    const hasManualColumns = debtsInfo.rows.some(
      (r) => String(r.name) === 'debtor_manual_name'
    );

    if (!allTablesExist) {
      await db.batch(
        [
          'PRAGMA foreign_keys = ON',
          `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )`,
          `CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )`,
          `CREATE TABLE IF NOT EXISTS debts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            creditor_id INTEGER REFERENCES users(id),
            debtor_id INTEGER REFERENCES users(id),
            creditor_manual_name TEXT,
            debtor_manual_name TEXT,
            amount_idr INTEGER NOT NULL CHECK (amount_idr > 0),
            description TEXT NOT NULL,
            due_date TEXT,
            status TEXT NOT NULL DEFAULT 'unpaid'
              CHECK (status IN ('unpaid', 'pending_confirmation', 'paid', 'cancelled')),
            payment_note TEXT,
            paid_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            CHECK (creditor_id IS NOT NULL OR creditor_manual_name IS NOT NULL),
            CHECK (debtor_id IS NOT NULL OR debtor_manual_name IS NOT NULL),
            CHECK (creditor_id IS NULL OR debtor_id IS NULL OR creditor_id != debtor_id)
          )`,
          'CREATE INDEX IF NOT EXISTS idx_debts_creditor ON debts(creditor_id, status)',
          'CREATE INDEX IF NOT EXISTS idx_debts_debtor ON debts(debtor_id, status)',
          'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'
        ],
        'write'
      );
    } else {
      if (!hasRoleColumn) {
        await db.execute(
          "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))"
        );
      }

      if (!hasManualColumns) {
        await db.batch(
          [
            'PRAGMA foreign_keys = OFF',
            `CREATE TABLE debts_migrated (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              creditor_id INTEGER REFERENCES users(id),
              debtor_id INTEGER REFERENCES users(id),
              creditor_manual_name TEXT,
              debtor_manual_name TEXT,
              amount_idr INTEGER NOT NULL CHECK (amount_idr > 0),
              description TEXT NOT NULL,
              due_date TEXT,
              status TEXT NOT NULL DEFAULT 'unpaid'
                CHECK (status IN ('unpaid', 'pending_confirmation', 'paid', 'cancelled')),
              payment_note TEXT,
              paid_at TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              CHECK (creditor_id IS NOT NULL OR creditor_manual_name IS NOT NULL),
              CHECK (debtor_id IS NOT NULL OR debtor_manual_name IS NOT NULL),
              CHECK (creditor_id IS NULL OR debtor_id IS NULL OR creditor_id != debtor_id)
            )`,
            `INSERT INTO debts_migrated (
              id, creditor_id, debtor_id, amount_idr, description, due_date,
              status, payment_note, paid_at, created_at, updated_at
            )
            SELECT
              id, creditor_id, debtor_id, amount_idr, description, due_date,
              status, payment_note, paid_at, created_at, updated_at
            FROM debts`,
            'DROP TABLE debts',
            'ALTER TABLE debts_migrated RENAME TO debts',
            'CREATE INDEX IF NOT EXISTS idx_debts_creditor ON debts(creditor_id, status)',
            'CREATE INDEX IF NOT EXISTS idx_debts_debtor ON debts(debtor_id, status)',
            'PRAGMA foreign_keys = ON'
          ],
          'write'
        );
      }
    }

    const envAdmin = process.env.ADMIN_USERNAME?.trim().toLowerCase();
    if (envAdmin && (!allTablesExist || !hasRoleColumn)) {
      await db.execute({
        sql: "UPDATE users SET role = 'admin' WHERE username = ?",
        args: [envAdmin]
      });
    }
  })().catch((err) => {
    initPromises.delete(db);
    throw err;
  });

  initPromises.set(db, promise);
  return promise;
}
