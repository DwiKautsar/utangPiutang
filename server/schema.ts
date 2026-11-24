import type { Client } from '@libsql/client';

const initPromises = new WeakMap<Client, Promise<void>>();

// Isolated from @libsql/client native entry so Vercel serverless only bundles @libsql/client/web
export function ensureDatabaseReady(db: Client): Promise<void> {
  const existing = initPromises.get(db);
  if (existing) return existing;

  const promise = (async () => {
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
          creditor_id INTEGER NOT NULL REFERENCES users(id),
          debtor_id INTEGER NOT NULL REFERENCES users(id),
          amount_idr INTEGER NOT NULL CHECK (amount_idr > 0),
          description TEXT NOT NULL,
          due_date TEXT,
          status TEXT NOT NULL DEFAULT 'unpaid'
            CHECK (status IN ('unpaid', 'pending_confirmation', 'paid', 'cancelled')),
          payment_note TEXT,
          paid_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (creditor_id != debtor_id)
        )`,
        'CREATE INDEX IF NOT EXISTS idx_debts_creditor ON debts(creditor_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_debts_debtor ON debts(debtor_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'
      ],
      'write'
    );

    // Safe migration for existing Turso databases created before the role column existed
    const tableInfo = await db.execute('PRAGMA table_info(users)');
    const hasRoleColumn = tableInfo.rows.some((row) => String(row.name) === 'role');
    if (!hasRoleColumn) {
      await db.execute(
        "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))"
      );
    }

    // Optional env-driven admin bootstrap so existing production accounts can be promoted safely
    const envAdmin = process.env.ADMIN_USERNAME?.trim().toLowerCase();
    if (envAdmin) {
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
