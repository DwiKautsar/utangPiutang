import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';

export type UserRole = 'user' | 'admin';

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
}

export type DebtStatus = 'unpaid' | 'pending_confirmation' | 'paid' | 'cancelled';

export interface DebtRecord {
  id: number;
  displayNumber: number;
  creditorId: number | null;
  creditorUsername: string | null;
  creditorName: string;
  debtorId: number | null;
  debtorUsername: string | null;
  debtorName: string;
  isManual: boolean;
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
