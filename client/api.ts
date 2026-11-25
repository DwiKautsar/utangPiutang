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
}

export type DebtStatus = 'unpaid' | 'pending_confirmation' | 'paid' | 'cancelled';

export interface DebtItem {
  id: number;
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

  confirmPaidByCreditor: (id: number) =>
    request<{ ok: boolean; status: DebtStatus }>(`/api/debts/${id}/confirm`, {
      method: 'PATCH'
    }),

  rejectPaymentByCreditor: (id: number) =>
    request<{ ok: boolean; status: DebtStatus }>(`/api/debts/${id}/reject`, {
      method: 'PATCH'
    }),

  cancelDebtByCreditor: (id: number) =>
    request<{ ok: boolean; status: DebtStatus }>(`/api/debts/${id}/cancel`, {
      method: 'PATCH'
    }),

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
