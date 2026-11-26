export type UserRole = 'user' | 'admin';

export interface UserProfile {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface AdminUserItem {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  activeReceivableCount: number;
  activePayableCount: number;
}

export interface AdminOverview {
  totalUsers: number;
  totalAdmins: number;
  activeDebtCount: number;
  activeDebtAmountIdr: number;
  paidDebtCount: number;
  paidDebtAmountIdr?: number;
}

export interface MonthlyTrendPoint {
  monthKey: string;
  recordedIdr: number;
  paidIdr: number;
  count: number;
}

export interface TopActiveDebtor {
  name: string;
  username: string | null;
  activeCount: number;
  activeIdr: number;
}

export interface AdminAnalytics {
  monthlyTrend: MonthlyTrendPoint[];
  statusBreakdown: Record<DebtStatus, { count: number; totalIdr: number }>;
  topActiveDebtors: TopActiveDebtor[];
}

export interface AdminBootstrapResponse {
  overview: AdminOverview;
  archivePreview: ArchivePreview;
  analytics: AdminAnalytics;
  users: AdminUserItem[];
  items: DebtItem[];
}

export interface UserBootstrapResponse {
  user: UserProfile | null;
  users?: UserProfile[];
  summary?: DebtSummary;
  items?: DebtItem[];
}

export interface ArchivePreview {
  months: number;
  includeUnpaid: boolean;
  count: number;
  totalAmountIdr: number;
}

export type DebtStatus = 'unpaid' | 'pending_confirmation' | 'paid' | 'cancelled';

export interface DebtItem {
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

export interface CreateDebtPayloadItem {
  recordType: 'receivable' | 'payable';
  debtorId?: number;
  debtorName?: string;
  creditorId?: number;
  creditorName?: string;
  amountIdr: number;
  description: string;
  dueDate?: string;
}

export interface DebtSummary {
  totalReceivableIdr: number;
  totalPayableIdr: number;
  netBalanceIdr: number;
  pendingConfirmationCount: number;
  activeBillCount: number;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'BukuUtang',
    ...(options.headers as Record<string, string> | undefined)
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload.error === 'string'
        ? payload.error
        : 'Permintaan gagal diproses. Coba lagi.';
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export const api = {
  getMe: () => request<{ user: UserProfile | null }>('/api/auth/me'),

  getBootstrap: () => request<UserBootstrapResponse>('/api/bootstrap'),

  register: (input: { username: string; displayName: string; password: string }) =>
    request<{ user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  login: (input: { username: string; password: string }) =>
    request<{ user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  logout: () =>
    request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST'
    }),

  listUsers: () => request<{ users: UserProfile[] }>('/api/users'),

  listDebts: (params: { role: 'debtor' | 'creditor'; status: string }) => {
    const query = new URLSearchParams({
      role: params.role,
      status: params.status
    });
    return request<{ summary: DebtSummary; items: DebtItem[] }>(`/api/debts?${query.toString()}`);
  },

  createDebts: (items: CreateDebtPayloadItem[]) =>
    request<{ items: DebtItem[] }>('/api/debts', {
      method: 'POST',
      body: JSON.stringify({ items })
    }),

  markPaidByDebtor: (id: number, paymentNote: string) =>
    request<{ ok: boolean; status: DebtStatus }>(`/api/debts/${id}/pay`, {
      method: 'PATCH',
      body: JSON.stringify({ paymentNote })
    }),

  confirmPaidByCreditor: (id: number, paymentNote?: string) =>
    request<{ ok: boolean; status: DebtStatus }>(`/api/debts/${id}/confirm`, {
      method: 'PATCH',
      body: JSON.stringify({ paymentNote: paymentNote ?? '' })
    }),

  rejectPaymentByCreditor: (id: number) =>
    request<{ ok: boolean; status: DebtStatus }>(`/api/debts/${id}/reject`, {
      method: 'PATCH'
    }),

  cancelDebtByCreditor: (id: number) =>
    request<{ ok: boolean; status: DebtStatus }>(`/api/debts/${id}/cancel`, {
      method: 'PATCH'
    }),

  adminBootstrap: (status = 'all', months = 3, includeUnpaid = false) =>
    request<AdminBootstrapResponse>(
      `/api/admin/bootstrap?status=${encodeURIComponent(status)}&months=${months}&includeUnpaid=${includeUnpaid ? '1' : '0'}`
    ),

  adminOverview: () => request<{ overview: AdminOverview }>('/api/admin/overview'),

  adminListUsers: () => request<{ users: AdminUserItem[] }>('/api/admin/users'),

  adminUpdateUserRole: (id: number, role: UserRole) =>
    request<{ ok: boolean; role: UserRole }>(`/api/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role })
    }),

  adminResetPassword: (id: number, newPassword: string) =>
    request<{ ok: boolean }>(`/api/admin/users/${id}/reset-password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword })
    }),

  adminDeleteUser: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/users/${id}`, {
      method: 'DELETE'
    }),

  adminListDebts: (status: string) =>
    request<{ items: DebtItem[] }>(`/api/admin/debts?status=${encodeURIComponent(status)}`),

  adminUpdateDebtStatus: (id: number, status: DebtStatus) =>
    request<{ ok: boolean; status: DebtStatus }>(`/api/admin/debts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    }),

  adminDeleteDebt: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/debts/${id}`, {
      method: 'DELETE'
    }),

  adminArchivePreview: (months = 3, includeUnpaid = false) =>
    request<{ preview: ArchivePreview }>(
      `/api/admin/archive/preview?months=${months}&includeUnpaid=${includeUnpaid ? '1' : '0'}`
    ),

  adminDownloadArchiveCsv: async (options: {
    scope: 'archive' | 'all';
    months?: number;
    includeUnpaid?: boolean;
  }) => {
    const query = new URLSearchParams({
      scope: options.scope,
      months: String(options.months ?? 3),
      includeUnpaid: options.includeUnpaid ? '1' : '0'
    });
    const res = await fetch(`/api/admin/archive/export?${query.toString()}`, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'BukuUtang' }
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new ApiError(
        payload?.error || 'Gagal mengunduh file arsip Excel.',
        res.status
      );
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `bukuutang-arsip-${new Date().toISOString().slice(0, 10)}.csv`;

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
    return filename;
  },

  adminPurgeArchive: (months = 3, includeUnpaid = false) =>
    request<{ ok: boolean; deletedCount: number }>('/api/admin/archive/purge', {
      method: 'POST',
      body: JSON.stringify({ months, includeUnpaid })
    })
};

export function formatRupiah(amount: number): string {
  const prefix = amount < 0 ? '-Rp' : 'Rp';
  return `${prefix}${Math.abs(amount).toLocaleString('id-ID')}`;
}

export function formatDateId(isoValue: string | null): string {
  if (!isoValue) return '-';
  const normalized = isoValue.includes('T') ? isoValue : `${isoValue.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return isoValue;
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}
