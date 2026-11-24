import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
}

export type DebtStatus = 'unpaid' | 'pending_confirmation' | 'paid' | 'cancelled';

export interface DebtRecord {
  id: number;
  creditorId: number;
  creditorUsername: string;
  creditorName: string;
  debtorId: number;
  debtorUsername: string;
  debtorName: string;
  amountIdr: number;
  description: string;
  dueDate: string | null;
  status: DebtStatus;
  paymentNote: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseOptions {
  url?: string;
  authToken?: string;
}

const initPromises = new WeakMap<Client, Promise<void>>();

function resolveDatabaseUrl(explicitUrl?: string): string {
  if (explicitUrl) return explicitUrl;
  if (process.env.TURSO_DATABASE_URL) {
    return process.env.TURSO_DATABASE_URL.trim();
  }
  const localPath = path.resolve(process.cwd(), 'data', 'buku-utang.db');
  return `file:${localPath}`;
}

export function createDatabase(options: DatabaseOptions = {}): Client {
  const url = resolveDatabaseUrl(options.url);
  const authToken = options.authToken ?? process.env.TURSO_AUTH_TOKEN?.trim();

  if (url.startsWith('file:')) {
    const filePath = url.slice('file:'.length);
    const dir = path.dirname(filePath);
    if (dir && dir !== '.') {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  return createClient({
    url,
    authToken: authToken || undefined
  });
}

// Lazy-initialized once per client instance so it works cleanly in Vercel serverless cold starts
export function ensureDatabaseReady(db: Client): Promise<void> {
  const existing = initPromises.get(db);
  if (existing) return existing;

  const promise = db
    .batch(
      [
        'PRAGMA foreign_keys = ON',
        `CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
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
    )
    .then(() => undefined)
    .catch((err) => {
      initPromises.delete(db);
      throw err;
    });

  initPromises.set(db, promise);
  return promise;
}
