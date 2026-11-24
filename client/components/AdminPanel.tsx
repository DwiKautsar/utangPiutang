import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  api,
  ApiError,
  formatDateId,
  formatRupiah,
  type AdminOverview,
  type AdminUserItem,
  type DebtItem,
  type DebtStatus,
  type UserProfile
} from '../api';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminPanelProps {
  currentUser: UserProfile;
  onDataChanged: () => Promise<void>;
}

const STATUS_LABELS: Record<DebtStatus, string> = {
  unpaid: 'Belum Dibayar',
  pending_confirmation: 'Menunggu Konfirmasi',
  paid: 'Lunas',
  cancelled: 'Dibatalkan'
};

type AdminDialogAction =
  | { type: 'reset-password'; target: AdminUserItem }
  | { type: 'delete-user'; target: AdminUserItem }
  | { type: 'delete-debt'; target: DebtItem };

export function AdminPanel({ currentUser, onDataChanged }: AdminPanelProps) {
  const [tab, setTab] = useState<'users' | 'debts'>('users');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [debtFilter, setDebtFilter] = useState('all');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [dialog, setDialog] = useState<AdminDialogAction | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ovRes, usersRes, debtsRes] = await Promise.all([
        api.adminOverview(),
        api.adminListUsers(),
        api.adminListDebts(debtFilter)
      ]);
      setOverview(ovRes.overview);
      setUsers(usersRes.users);
      setDebts(debtsRes.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data panel admin.');
    } finally {
      setLoading(false);
    }
  }, [debtFilter]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleToggleRole(target: AdminUserItem) {
    const nextRole = target.role === 'admin' ? 'user' : 'admin';
    setBusyId(`role-${target.id}`);
    setFeedback(null);
    setError(null);
    try {
      await api.adminUpdateUserRole(target.id, nextRole);
      setFeedback(`Role @${target.username} diperbarui menjadi ${nextRole}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memperbarui role akun.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleChangeDebtStatus(item: DebtItem, nextStatus: DebtStatus) {
    if (item.status === nextStatus) return;
    setBusyId(`debt-${item.id}`);
    setFeedback(null);
    setError(null);
    try {
      await api.adminUpdateDebtStatus(item.id, nextStatus);
      setFeedback(`Status transaksi #${String(item.id).padStart(3, '0')} diubah ke ${STATUS_LABELS[nextStatus]}.`);
      await loadAll();
      await onDataChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memperbarui status transaksi.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmDialog() {
    if (!dialog) return;
    setDialogError(null);

    if (dialog.type === 'reset-password' && newPassword.length < 6) {
      setDialogError('Password baru minimal 6 karakter.');
      return;
    }

    setBusyId('dialog');
    try {
      if (dialog.type === 'reset-password') {
        await api.adminResetPassword(dialog.target.id, newPassword);
        setFeedback(`Password akun @${dialog.target.username} telah direset dan sesi lamanya dikeluarkan.`);
      } else if (dialog.type === 'delete-user') {
        await api.adminDeleteUser(dialog.target.id);
        setFeedback(`Akun @${dialog.target.username} beserta catatan terkait telah dihapus.`);
      } else if (dialog.type === 'delete-debt') {
        await api.adminDeleteDebt(dialog.target.id);
        setFeedback(`Catatan transaksi #${String(dialog.target.id).padStart(3, '0')} telah dihapus.`);
      }
      setDialog(null);
      setNewPassword('');
      await loadAll();
      await onDataChanged();
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : 'Aksi gagal diproses.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div class="dashboard-main">
      <section id="ringkasan" class="summary-strip" aria-labelledby="admin-summary-heading">
        <div class="summary-primary">
          <h1 id="admin-summary-heading" class="summary-label">
            Total Nominal Utang Aktif (Seluruh Akun)
          </h1>
          <p class="summary-net-amount tabular-num">
            {formatRupiah(overview?.activeDebtAmountIdr ?? 0)}
          </p>
          <p class="metric-sub">
            {overview?.activeDebtCount ?? 0} catatan aktif dan {overview?.paidDebtCount ?? 0} catatan lunas
          </p>
        </div>

        <div class="summary-metrics">
          <div class="metric-block">
            <span class="summary-label">Total Akun Terdaftar</span>
            <span class="metric-value tabular-num">{overview?.totalUsers ?? 0}</span>
            <span class="metric-sub">{overview?.totalAdmins ?? 0} akun memiliki akses admin</span>
          </div>

          <div class="metric-block">
            <span class="summary-label">Kontrol Moderasi</span>
            <span class="metric-value">Aktif</span>
            <span class="metric-sub">Kelola role, reset password, dan status transaksi</span>
          </div>
        </div>
      </section>

      <section class="panel" aria-labelledby="admin-panel-heading">
        <div class="panel-heading">
          <div>
            <h2 id="admin-panel-heading">Panel Pengelolaan Admin</h2>
            <p>Pantau seluruh akun pengguna dan koreksi status catatan utang piutang.</p>
          </div>
        </div>

        {feedback && (
          <div class="alert alert-success" role="status" style={{ marginBottom: '14px' }}>
            {feedback}
          </div>
        )}
        {error && (
          <div class="alert alert-error" role="alert" style={{ marginBottom: '14px' }}>
            {error}
          </div>
        )}

        <div class="ledger-controls">
          <div class="ledger-tabs" role="tablist" aria-label="Menu pengelolaan admin">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'users'}
              class="ledger-tab"
              onClick={() => setTab('users')}
            >
              <span>Kelola Akun</span>
              <span class="tab-count tabular-num">{users.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'debts'}
              class="ledger-tab"
              onClick={() => setTab('debts')}
            >
              <span>Kelola Utang Piutang</span>
              <span class="tab-count tabular-num">{debts.length}</span>
            </button>
          </div>

          <div class="filter-row">
            {tab === 'debts' && (
              <div class="filter-group">
                <label for="admin-status-filter">Status</label>
                <select
                  id="admin-status-filter"
                  class="select filter-select"
                  value={debtFilter}
                  onChange={(e) => setDebtFilter((e.target as HTMLSelectElement).value)}
                >
                  <option value="all">Semua Status</option>
                  <option value="active">Aktif (Belum Lunas)</option>
                  <option value="unpaid">Belum Dibayar</option>
                  <option value="pending_confirmation">Menunggu Konfirmasi</option>
                  <option value="paid">Lunas</option>
                  <option value="cancelled">Dibatalkan</option>
                </select>
              </div>
            )}

            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onClick={() => loadAll()}
              disabled={loading}
            >
              Muat Ulang
            </button>
          </div>
        </div>

        {loading ? (
          <div class="state-box" role="status">
            <h3>Memuat data admin...</h3>
            <p>Mengambil daftar akun dan transaksi dari database.</p>
          </div>
        ) : tab === 'users' ? (
          users.length === 0 ? (
            <div class="state-box">
              <h3>Belum ada akun terdaftar</h3>
              <p>Daftar pengguna akan tampil di sini setelah ada akun yang mendaftar.</p>
            </div>
          ) : (
            <ul class="ledger-list">
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                return (
                  <li class="ledger-item" key={u.id}>
                    <div class="ledger-item-top">
                      <div class="ledger-counterparty">
                        <span class="ledger-code tabular-num">
                          ID #{u.id} {isSelf ? '(Akun Anda)' : ''}
                        </span>
                        <span class="ledger-name">
                          {u.displayName} <span class="user-handle">@{u.username}</span>
                        </span>
                        <div class="ledger-meta">
                          <span>Daftar: {formatDateId(u.createdAt)}</span>
                          <span>Piutang aktif: {u.activeReceivableCount}</span>
                          <span>Tagihan aktif: {u.activePayableCount}</span>
                        </div>
                      </div>

                      <span class={`status-badge ${u.role === 'admin' ? 'status-paid' : 'status-cancelled'}`}>
                        {u.role === 'admin' ? 'Admin' : 'User'}
                      </span>
                    </div>

                    <div class="ledger-actions">
                      {!isSelf && (
                        <button
                          type="button"
                          class="btn btn-secondary btn-sm"
                          disabled={busyId === `role-${u.id}`}
                          onClick={() => handleToggleRole(u)}
                        >
                          {u.role === 'admin' ? 'Turunkan ke User' : 'Jadikan Admin'}
                        </button>
                      )}
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        onClick={() => {
                          setDialog({ type: 'reset-password', target: u });
                          setNewPassword('');
                          setDialogError(null);
                        }}
                      >
                        Reset Password
                      </button>
                      {!isSelf && (
                        <button
                          type="button"
                          class="btn btn-primary btn-sm"
                          onClick={() => {
                            setDialog({ type: 'delete-user', target: u });
                            setDialogError(null);
                          }}
                        >
                          Hapus Akun
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : debts.length === 0 ? (
          <div class="state-box">
            <h3>Belum ada transaksi pada filter ini</h3>
            <p>Ubah filter status untuk melihat catatan utang piutang lainnya.</p>
          </div>
        ) : (
          <ul class="ledger-list">
            {debts.map((item) => (
              <li class="ledger-item" key={item.id}>
                <div class="ledger-item-top">
                  <div class="ledger-counterparty">
                    <span class="ledger-code tabular-num">
                      #{String(item.id).padStart(3, '0')}
                    </span>
                    <span class="ledger-name">
                      {item.creditorName} (@{item.creditorUsername}) menagih {item.debtorName} (@{item.debtorUsername})
                    </span>
                    <p class="ledger-desc">{item.description}</p>
                  </div>

                  <div class="ledger-amount-wrap">
                    <span class="ledger-amount tabular-num">{formatRupiah(item.amountIdr)}</span>
                    <span class={`status-badge status-${item.status}`}>
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                </div>

                <div class="ledger-meta">
                  <span>Dicatat: {formatDateId(item.createdAt)}</span>
                  {item.dueDate && <span>Jatuh tempo: {formatDateId(item.dueDate)}</span>}
                  {item.paidAt && <span>Lunas: {formatDateId(item.paidAt)}</span>}
                </div>

                {item.paymentNote && (
                  <div class="ledger-note">Catatan pembayaran: {item.paymentNote}</div>
                )}

                <div class="ledger-actions">
                  <label class="sr-only" for={`admin-debt-status-${item.id}`}>
                    Ubah status transaksi #{item.id}
                  </label>
                  <select
                    id={`admin-debt-status-${item.id}`}
                    class="select admin-status-select"
                    value={item.status}
                    disabled={busyId === `debt-${item.id}`}
                    onChange={(e) =>
                      handleChangeDebtStatus(
                        item,
                        (e.target as HTMLSelectElement).value as DebtStatus
                      )
                    }
                  >
                    <option value="unpaid">Belum Dibayar</option>
                    <option value="pending_confirmation">Menunggu Konfirmasi</option>
                    <option value="paid">Lunas</option>
                    <option value="cancelled">Dibatalkan</option>
                  </select>

                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    onClick={() => {
                      setDialog({ type: 'delete-debt', target: item });
                      setDialogError(null);
                    }}
                  >
                    Hapus Catatan
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={dialog !== null}
        title={
          dialog?.type === 'reset-password'
            ? `Reset Password @${dialog.target.username}`
            : dialog?.type === 'delete-user'
              ? `Hapus Akun @${dialog.target.username}`
              : 'Hapus Catatan Utang Piutang'
        }
        description={
          dialog?.type === 'reset-password'
            ? 'Masukkan password baru untuk akun ini. Semua sesi login lama milik akun ini akan langsung dikeluarkan.'
            : dialog?.type === 'delete-user'
              ? `Akun ${dialog.target.displayName} (@${dialog.target.username}) beserta seluruh catatan utang piutang yang terkait akan dihapus permanen.`
              : dialog
                ? `Hapus catatan #${String(dialog.target.id).padStart(3, '0')} (${formatRupiah(dialog.target.amountIdr)}) secara permanen?`
                : ''
        }
        confirmLabel={
          dialog?.type === 'reset-password'
            ? 'Simpan Password Baru'
            : dialog?.type === 'delete-user'
              ? 'Ya, Hapus Akun'
              : 'Ya, Hapus Catatan'
        }
        confirmVariant={dialog?.type === 'reset-password' ? 'credit' : 'primary'}
        busy={busyId === 'dialog'}
        onClose={() => setDialog(null)}
        onConfirm={handleConfirmDialog}
      >
        {dialogError && (
          <div class="alert alert-error" role="alert">
            {dialogError}
          </div>
        )}
        {dialog?.type === 'reset-password' && (
          <div class="field">
            <label for="admin-reset-password-input">Password Baru</label>
            <input
              id="admin-reset-password-input"
              type="password"
              class="input"
              autoComplete="new-password"
              value={newPassword}
              onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
              placeholder="Minimal 6 karakter"
            />
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
