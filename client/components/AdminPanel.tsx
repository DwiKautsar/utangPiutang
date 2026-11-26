import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  api,
  ApiError,
  formatDateId,
  formatRupiah,
  type AdminAnalytics,
  type AdminOverview,
  type AdminUserItem,
  type ArchivePreview,
  type DebtItem,
  type DebtStatus,
  type UserProfile
} from '../api';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminPanelProps {
  currentUser: UserProfile;
}

const STATUS_LABELS: Record<DebtStatus, string> = {
  unpaid: 'Belum Dibayar',
  pending_confirmation: 'Menunggu Konfirmasi',
  paid: 'Lunas',
  cancelled: 'Dibatalkan'
};

const MONTH_SHORT_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des'
];

function formatMonthLabel(monthKey: string): string {
  const parts = monthKey.split('-');
  if (parts.length !== 2) return monthKey;
  const monthIdx = Number(parts[1]) - 1;
  const shortMonth = MONTH_SHORT_ID[monthIdx] ?? parts[1];
  return `${shortMonth} ${parts[0].slice(2)}`;
}

function formatCompactIdr(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}M`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}jt`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}rb`;
  return String(amount);
}

type AdminDialogAction =
  | { type: 'reset-password'; target: AdminUserItem }
  | { type: 'delete-user'; target: AdminUserItem }
  | { type: 'delete-debt'; target: DebtItem }
  | { type: 'archive-purge' };

export function AdminPanel({ currentUser }: AdminPanelProps) {
  const [tab, setTab] = useState<'users' | 'debts'>('users');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [archivePreview, setArchivePreview] = useState<ArchivePreview | null>(null);
  const [includeUnpaidArchive, setIncludeUnpaidArchive] = useState(false);
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
      const data = await api.adminBootstrap(debtFilter, 3, includeUnpaidArchive);
      setOverview(data.overview);
      setAnalytics(data.analytics);
      setArchivePreview(data.archivePreview);
      setUsers(data.users);
      setDebts(data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data dashboard admin.');
    } finally {
      setLoading(false);
    }
  }, [debtFilter, includeUnpaidArchive]);

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
      setFeedback(
        `Status transaksi #${String(item.displayNumber).padStart(3, '0')} diubah ke ${STATUS_LABELS[nextStatus]}.`
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memperbarui status transaksi.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleExportAllExcel() {
    setBusyId('export-all');
    setFeedback(null);
    setError(null);
    try {
      const filename = await api.adminDownloadArchiveCsv({ scope: 'all' });
      setFeedback(`File laporan Excel (${filename}) berhasil diunduh.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengunduh file Excel.');
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
        setFeedback(
          `Password akun @${dialog.target.username} telah direset dan sesi lamanya dikeluarkan.`
        );
      } else if (dialog.type === 'delete-user') {
        await api.adminDeleteUser(dialog.target.id);
        setFeedback(`Akun @${dialog.target.username} beserta catatan terkait telah dihapus.`);
      } else if (dialog.type === 'delete-debt') {
        await api.adminDeleteDebt(dialog.target.id);
        setFeedback(
          `Catatan transaksi #${String(dialog.target.displayNumber).padStart(3, '0')} dihapus dan nomor urut otomatis dirapikan.`
        );
      } else if (dialog.type === 'archive-purge') {
        const filename = await api.adminDownloadArchiveCsv({
          scope: 'archive',
          months: 3,
          includeUnpaid: includeUnpaidArchive
        });
        const purgeRes = await api.adminPurgeArchive(3, includeUnpaidArchive);
        setFeedback(
          `Arsip (${filename}) berhasil diunduh. ${purgeRes.deletedCount} catatan > 3 bulan telah dibersihkan dan nomor urut otomatis dirapikan.`
        );
      }
      setDialog(null);
      setNewPassword('');
      await loadAll();
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : 'Aksi gagal diproses.');
    } finally {
      setBusyId(null);
    }
  }

  const paidAmount = overview?.paidDebtAmountIdr ?? 0;
  const activeAmount = overview?.activeDebtAmountIdr ?? 0;
  const totalVolume = paidAmount + activeAmount;
  const settlementRate = totalVolume > 0 ? Math.round((paidAmount / totalVolume) * 100) : 0;

  const trend = analytics?.monthlyTrend ?? [];
  const maxTrendVal = Math.max(
    1,
    ...trend.map((p) => Math.max(p.recordedIdr, p.paidIdr))
  );

  const breakdown = analytics?.statusBreakdown;
  const totalTxBreakdown = breakdown
    ? breakdown.unpaid.count +
      breakdown.pending_confirmation.count +
      breakdown.paid.count +
      breakdown.cancelled.count
    : 0;

  const topDebtors = analytics?.topActiveDebtors ?? [];

  return (
    <div class="dashboard-main">
      <section id="ringkasan" class="summary-strip" aria-labelledby="admin-summary-heading">
        <div class="summary-primary">
          <h1 id="admin-summary-heading" class="summary-label">
            Total Nominal Utang Aktif (Seluruh Akun)
          </h1>
          <p class="summary-net-amount tabular-num">{formatRupiah(activeAmount)}</p>
          <p class="metric-sub">
            {overview?.activeDebtCount ?? 0} transaksi aktif, {overview?.paidDebtCount ?? 0} lunas
            ({settlementRate}% rasio pelunasan)
          </p>
        </div>

        <div class="summary-metrics admin-kpi-grid">
          <div class="metric-block">
            <span class="summary-label">Total Akun Terdaftar</span>
            <span class="metric-value tabular-num">{overview?.totalUsers ?? 0}</span>
            <span class="metric-sub">{overview?.totalAdmins ?? 0} akun admin</span>
          </div>

          <div class="metric-block">
            <span class="summary-label">Total Nominal Lunas</span>
            <span class="metric-value tabular-num">{formatRupiah(paidAmount)}</span>
            <span class="metric-sub">Tercatat sudah diselesaikan</span>
          </div>

          <div class="metric-block">
            <span class="summary-label">Arsip (&gt; 3 Bulan)</span>
            <span class="metric-value tabular-num">{archivePreview?.count ?? 0} data</span>
            <span class="metric-sub">
              {archivePreview && archivePreview.count > 0
                ? formatRupiah(archivePreview.totalAmountIdr)
                : 'Belum ada data lama'}
            </span>
          </div>
        </div>
      </section>

      <section class="analytics-grid" aria-label="Grafik dan ringkasan analitik">
        <article class="panel" aria-labelledby="trend-chart-heading">
          <div class="panel-heading">
            <div>
              <h2 id="trend-chart-heading">Tren 6 Bulan Terakhir</h2>
              <p>Perbandingan nominal transaksi tercatat dan yang sudah lunas per bulan.</p>
            </div>
            <div class="chart-legend" aria-label="Legenda grafik">
              <span class="legend-item">
                <span class="legend-swatch is-recorded" aria-hidden="true" />
                Tercatat
              </span>
              <span class="legend-item">
                <span class="legend-swatch is-paid" aria-hidden="true" />
                Lunas
              </span>
            </div>
          </div>

          {loading && trend.length === 0 ? (
            <div class="state-box" role="status">
              <p>Memuat grafik tren...</p>
            </div>
          ) : trend.every((p) => p.recordedIdr === 0 && p.paidIdr === 0) ? (
            <div class="state-box">
              <h3>Belum ada riwayat 6 bulan terakhir</h3>
              <p>Grafik batang akan terisi otomatis begitu pengguna mulai mencatat transaksi.</p>
            </div>
          ) : (
            <div class="chart-wrap">
              <svg
                class="trend-svg"
                viewBox="0 0 540 210"
                role="img"
                aria-label="Grafik batang perbandingan nominal tercatat dan lunas selama 6 bulan terakhir"
              >
                {[0, 0.5, 1].map((ratio) => {
                  const y = 165 - ratio * 135;
                  return (
                    <g key={ratio}>
                      <line x1="48" y1={y} x2="528" y2={y} class="chart-grid-line" />
                      <text x="42" y={y + 4} text-anchor="end" class="chart-axis-text tabular-num">
                        {formatCompactIdr(Math.round(maxTrendVal * ratio))}
                      </text>
                    </g>
                  );
                })}

                {trend.map((point, idx) => {
                  const groupX = 64 + idx * 76;
                  const recHeight = Math.max(
                    point.recordedIdr > 0 ? 4 : 0,
                    Math.round((point.recordedIdr / maxTrendVal) * 135)
                  );
                  const paidHeight = Math.max(
                    point.paidIdr > 0 ? 4 : 0,
                    Math.round((point.paidIdr / maxTrendVal) * 135)
                  );

                  return (
                    <g key={point.monthKey}>
                      <rect
                        x={groupX}
                        y={165 - recHeight}
                        width="22"
                        height={recHeight}
                        rx="3"
                        class="chart-bar-recorded"
                      >
                        <title>
                          {formatMonthLabel(point.monthKey)} Tercatat: {formatRupiah(point.recordedIdr)} ({point.count} catatan)
                        </title>
                      </rect>
                      <rect
                        x={groupX + 26}
                        y={165 - paidHeight}
                        width="22"
                        height={paidHeight}
                        rx="3"
                        class="chart-bar-paid"
                      >
                        <title>
                          {formatMonthLabel(point.monthKey)} Lunas: {formatRupiah(point.paidIdr)}
                        </title>
                      </rect>
                      <text x={groupX + 24} y="188" text-anchor="middle" class="chart-axis-text">
                        {formatMonthLabel(point.monthKey)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </article>

        <article class="panel" aria-labelledby="breakdown-heading">
          <div class="panel-heading">
            <div>
              <h2 id="breakdown-heading">Distribusi Status &amp; Tagihan Aktif</h2>
              <p>Proporsi seluruh catatan dan daftar peminjam dengan tanggungan terbesar.</p>
            </div>
          </div>

          {totalTxBreakdown === 0 || !breakdown ? (
            <div class="state-box">
              <h3>Belum ada catatan transaksi</h3>
              <p>Distribusi status akan tampil setelah ada transaksi di buku kas.</p>
            </div>
          ) : (
            <div class="breakdown-stack">
              <div class="segmented-bar" aria-label="Proporsi status transaksi">
                {(['unpaid', 'pending_confirmation', 'paid', 'cancelled'] as DebtStatus[]).map(
                  (st) => {
                    const count = breakdown[st].count;
                    if (count === 0) return null;
                    const pct = (count / totalTxBreakdown) * 100;
                    return (
                      <span
                        key={st}
                        class={`seg-piece seg-${st}`}
                        style={{ width: `${pct}%` }}
                        title={`${STATUS_LABELS[st]}: ${count} (${Math.round(pct)}%)`}
                      />
                    );
                  }
                )}
              </div>

              <ul class="breakdown-list">
                {(['unpaid', 'pending_confirmation', 'paid', 'cancelled'] as DebtStatus[]).map(
                  (st) => {
                    const stat = breakdown[st];
                    const pct = totalTxBreakdown > 0 ? Math.round((stat.count / totalTxBreakdown) * 100) : 0;
                    return (
                      <li key={st} class="breakdown-row">
                        <span class="breakdown-label">
                          <span class={`legend-swatch seg-${st}`} aria-hidden="true" />
                          <span>{STATUS_LABELS[st]}</span>
                        </span>
                        <span class="breakdown-values tabular-num">
                          <strong>{stat.count}</strong> ({pct}%) | {formatRupiah(stat.totalIdr)}
                        </span>
                      </li>
                    );
                  }
                )}
              </ul>
            </div>
          )}

          <div class="top-debtors-block">
            <h3 class="sub-heading">Tanggungan Aktif Tertinggi</h3>
            {topDebtors.length === 0 ? (
              <p class="metric-sub">Tidak ada tagihan aktif saat ini.</p>
            ) : (
              <ol class="top-debtors-list">
                {topDebtors.map((d, idx) => (
                  <li key={`${d.name}-${idx}`} class="top-debtor-row">
                    <span class="top-debtor-name">
                      <span class="ledger-code tabular-num">{idx + 1}.</span> {d.name}
                      {d.username ? <span class="user-handle"> @{d.username}</span> : ' (Manual)'}
                    </span>
                    <span class="tabular-num">
                      <strong>{formatRupiah(d.activeIdr)}</strong>{' '}
                      <span class="user-handle">({d.activeCount})</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </article>
      </section>

      <section class="panel archive-bar" aria-labelledby="archive-heading">
        <div class="archive-info">
          <h2 id="archive-heading">Arsip Excel 3 Bulanan &amp; Pembersihan</h2>
          <p>
            Unduh catatan lama ke file Excel (CSV), lalu bersihkan dari web. Penomoran #001, #002,
            dst. akan otomatis terurut ulang setelah pembersihan.
          </p>
          <label class="checkbox-row" for="include-unpaid-archive">
            <input
              id="include-unpaid-archive"
              type="checkbox"
              checked={includeUnpaidArchive}
              onChange={(e) => setIncludeUnpaidArchive((e.target as HTMLInputElement).checked)}
            />
            <span>
              Sertakan juga catatan &gt; 3 bulan yang masih belum lunas (default: hanya
              Lunas/Dibatalkan)
            </span>
          </label>
        </div>

        <div class="archive-actions">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            disabled={busyId === 'export-all'}
            onClick={handleExportAllExcel}
          >
            {busyId === 'export-all' ? 'Mengunduh...' : 'Unduh Excel (Semua Data)'}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={!archivePreview || archivePreview.count === 0}
            onClick={() => {
              setDialog({ type: 'archive-purge' });
              setDialogError(null);
            }}
          >
            Unduh Excel &amp; Bersihkan (&gt; 3 Bulan)
          </button>
        </div>
      </section>

      <section class="panel" aria-labelledby="admin-panel-heading">
        <div class="panel-heading">
          <div>
            <h2 id="admin-panel-heading">Pengelolaan Akun &amp; Catatan</h2>
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

        {loading && users.length === 0 && debts.length === 0 ? (
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
              {(() => {
                let memberOrder = 0;
                return users.map((u) => {
                  const isSelf = u.id === currentUser.id;
                  const isAdmin = u.role === 'admin';
                  const displayCode = isAdmin
                    ? 'SUPERADMIN'
                    : `#${String(++memberOrder).padStart(3, '0')}`;
                  return (
                    <li class="ledger-item" key={u.id}>
                      <div class="ledger-item-top">
                        <div class="ledger-counterparty">
                          <span class="ledger-code tabular-num">
                            {displayCode} {isSelf ? '(Akun Anda)' : ''}
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

                      <span
                        class={`status-badge ${u.role === 'admin' ? 'status-paid' : 'status-cancelled'}`}
                      >
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
                });
              })()}
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
                      #{String(item.displayNumber).padStart(3, '0')}
                    </span>
                    <span class="ledger-name">
                      {item.creditorName}
                      {item.creditorUsername ? ` (@${item.creditorUsername})` : ' (Manual)'} menagih{' '}
                      {item.debtorName}
                      {item.debtorUsername ? ` (@${item.debtorUsername})` : ' (Manual)'}
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
                    Ubah status transaksi #{item.displayNumber}
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
              : dialog?.type === 'archive-purge'
                ? 'Unduh Arsip Excel & Bersihkan Data > 3 Bulan'
                : 'Hapus Catatan Utang Piutang'
        }
        description={
          dialog?.type === 'reset-password'
            ? 'Masukkan password baru untuk akun ini. Semua sesi login lama milik akun ini akan langsung dikeluarkan.'
            : dialog?.type === 'delete-user'
              ? `Akun ${dialog.target.displayName} (@${dialog.target.username}) beserta seluruh catatan utang piutang yang terkait akan dihapus permanen.`
              : dialog?.type === 'archive-purge'
                ? `Sistem akan mengunduh ${archivePreview?.count ?? 0} catatan berumur lebih dari 3 bulan (${includeUnpaidArchive ? 'semua status' : 'hanya Lunas/Dibatalkan'}) ke file Excel, lalu menghapusnya dari database dan mengurutkan ulang penomoran #.`
                : dialog
                  ? `Hapus catatan #${String(dialog.target.displayNumber).padStart(3, '0')} (${formatRupiah(dialog.target.amountIdr)}) secara permanen? Nomor urut sisa catatan akan dirapikan otomatis.`
                  : ''
        }
        confirmLabel={
          dialog?.type === 'reset-password'
            ? 'Simpan Password Baru'
            : dialog?.type === 'delete-user'
              ? 'Ya, Hapus Akun'
              : dialog?.type === 'archive-purge'
                ? 'Unduh Excel & Hapus Data Lama'
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
