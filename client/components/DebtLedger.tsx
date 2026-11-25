import { useState } from 'preact/hooks';
import {
  api,
  ApiError,
  formatDateId,
  formatRupiah,
  type DebtItem,
  type DebtStatus,
  type DebtSummary
} from '../api';
import { ConfirmDialog } from './ConfirmDialog';

interface DebtLedgerProps {
  role: 'debtor' | 'creditor';
  statusFilter: string;
  items: DebtItem[];
  summary: DebtSummary;
  loading: boolean;
  error: string | null;
  onChangeRole: (role: 'debtor' | 'creditor') => void;
  onChangeStatus: (status: string) => void;
  onRefresh: () => Promise<void>;
}

const STATUS_LABELS: Record<DebtStatus, string> = {
  unpaid: 'Belum Dibayar',
  pending_confirmation: 'Menunggu Konfirmasi',
  paid: 'Lunas',
  cancelled: 'Dibatalkan'
};

type PendingAction =
  | { type: 'pay'; item: DebtItem }
  | { type: 'confirm'; item: DebtItem }
  | { type: 'reject'; item: DebtItem }
  | { type: 'cancel'; item: DebtItem };

export function DebtLedger({
  role,
  statusFilter,
  items,
  summary,
  loading,
  error,
  onChangeRole,
  onChangeStatus,
  onRefresh
}: DebtLedgerProps) {
  const [action, setAction] = useState<PendingAction | null>(null);
  const [paymentNote, setPaymentNote] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function openAction(nextAction: PendingAction) {
    setAction(nextAction);
    setPaymentNote('');
    setActionError(null);
  }

  async function executeAction() {
    if (!action) return;
    setActionBusy(true);
    setActionError(null);

    try {
      if (action.type === 'pay') {
        await api.markPaidByDebtor(action.item.id, paymentNote);
      } else if (action.type === 'confirm') {
        await api.confirmPaidByCreditor(action.item.id);
      } else if (action.type === 'reject') {
        await api.rejectPaymentByCreditor(action.item.id);
      } else if (action.type === 'cancel') {
        await api.cancelDebtByCreditor(action.item.id);
      }
      setAction(null);
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError('Gagal memperbarui status transaksi. Coba lagi.');
      }
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <section class="panel" aria-labelledby="ledger-heading">
      <div class="panel-heading">
        <div>
          <h2 id="ledger-heading">Daftar Buku Catatan</h2>
          <p>
            {role === 'debtor'
              ? 'Tagihan yang otomatis tercatat ketika orang lain menginput utang atas nama Anda.'
              : 'Piutang yang Anda catat ke akun orang lain beserta status pelunasannya.'}
          </p>
        </div>
      </div>

      <div class="ledger-controls">
        <div class="ledger-tabs" role="tablist" aria-label="Kategori buku catatan">
          <button
            type="button"
            role="tab"
            aria-selected={role === 'debtor'}
            class="ledger-tab"
            onClick={() => onChangeRole('debtor')}
          >
            <span>Tagihan Saya</span>
            <span class="tab-count tabular-num">{summary.activeBillCount}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={role === 'creditor'}
            class="ledger-tab"
            onClick={() => onChangeRole('creditor')}
          >
            <span>Piutang Saya</span>
            {summary.pendingConfirmationCount > 0 && (
              <span class="tab-count tabular-num">{summary.pendingConfirmationCount} perlu cek</span>
            )}
          </button>
        </div>

        <div class="filter-row">
          <div class="filter-group">
            <label for="status-filter">Status</label>
            <select
              id="status-filter"
              class="select filter-select"
              value={statusFilter}
              onChange={(e) => onChangeStatus((e.target as HTMLSelectElement).value)}
            >
              <option value="all">Semua Status</option>
              <option value="active">Aktif (Belum Lunas)</option>
              <option value="unpaid">Belum Dibayar</option>
              <option value="pending_confirmation">Menunggu Konfirmasi</option>
              <option value="paid">Lunas</option>
              <option value="cancelled">Dibatalkan</option>
            </select>
          </div>

          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onClick={() => onRefresh()}
            disabled={loading}
          >
            Muat Ulang
          </button>
        </div>
      </div>

      {loading ? (
        <div class="state-box" role="status">
          <h3>Memuat catatan...</h3>
          <p>Mengambil data terbaru dari buku kas.</p>
        </div>
      ) : error ? (
        <div class="state-box" role="alert">
          <h3>Gagal memuat data</h3>
          <p>{error}</p>
          <button type="button" class="btn btn-secondary" onClick={() => onRefresh()}>
            Coba Lagi
          </button>
        </div>
      ) : items.length === 0 ? (
        <div class="state-box">
          <h3>Belum ada catatan pada tampilan ini</h3>
          <p>
            {role === 'debtor'
              ? 'Tidak ada tagihan yang cocok dengan filter saat ini. Jika seseorang mencatat piutang ke akun Anda, tagihan akan langsung tampil di sini.'
              : 'Belum ada piutang yang cocok dengan filter ini. Gunakan formulir Catat Piutang Baru untuk menambahkan catatan.'}
          </p>
        </div>
      ) : (
        <ul class="ledger-list">
          {items.map((item) => {
            const isDebtorView = role === 'debtor';
            const isManualPayable = isDebtorView && item.creditorId === null;
            const counterpartyLabel = isDebtorView
              ? item.creditorUsername
                ? `Bayar ke ${item.creditorName} (@${item.creditorUsername})`
                : `Bayar ke ${item.creditorName} (Tanpa Akun)`
              : item.debtorUsername
                ? `Peminjam: ${item.debtorName} (@${item.debtorUsername})`
                : `Peminjam: ${item.debtorName} (Tanpa Akun)`;

            return (
              <li class="ledger-item" key={item.id}>
                <div class="ledger-item-top">
                  <div class="ledger-counterparty">
                    <span class="ledger-code tabular-num">
                      #{String(item.id).padStart(3, '0')} {item.isManual ? '| Catatan Manual' : ''}
                    </span>
                    <span class="ledger-name">{counterpartyLabel}</span>
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
                  <div class="ledger-note">
                    Catatan pembayaran: {item.paymentNote}
                  </div>
                )}

                <div class="ledger-actions">
                  {isDebtorView && !isManualPayable && item.status === 'unpaid' && (
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      onClick={() => openAction({ type: 'pay', item })}
                    >
                      Tandai Sudah Bayar
                    </button>
                  )}

                  {isManualPayable && item.status === 'unpaid' && (
                    <>
                      <button
                        type="button"
                        class="btn btn-credit btn-sm"
                        onClick={() => openAction({ type: 'confirm', item })}
                      >
                        Tandai Lunas
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        onClick={() => openAction({ type: 'cancel', item })}
                      >
                        Batalkan
                      </button>
                    </>
                  )}

                  {!isDebtorView && item.status === 'pending_confirmation' && (
                    <>
                      <button
                        type="button"
                        class="btn btn-credit btn-sm"
                        onClick={() => openAction({ type: 'confirm', item })}
                      >
                        Konfirmasi Lunas
                      </button>
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm"
                        onClick={() => openAction({ type: 'reject', item })}
                      >
                        Belum Diterima
                      </button>
                    </>
                  )}

                  {!isDebtorView && item.status === 'unpaid' && (
                    <>
                      <button
                        type="button"
                        class="btn btn-credit btn-sm"
                        onClick={() => openAction({ type: 'confirm', item })}
                      >
                        Tandai Lunas
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        onClick={() => openAction({ type: 'cancel', item })}
                      >
                        Batalkan
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={action !== null}
        title={
          action?.type === 'pay'
            ? 'Konfirmasi Sudah Membayar'
            : action?.type === 'confirm'
              ? 'Lunaskan Catatan Piutang'
              : action?.type === 'reject'
                ? 'Tolak Klaim Pembayaran'
                : 'Batalkan Catatan Piutang'
        }
        description={
          action
            ? action.type === 'pay'
              ? `Anda menandai tagihan ${formatRupiah(action.item.amountIdr)} ke ${action.item.creditorName} sebagai sudah dibayar. Status akan menunggu konfirmasi dari ${action.item.creditorName}.`
              : action.type === 'confirm'
                ? `Tandai piutang ${formatRupiah(action.item.amountIdr)} dari ${action.item.debtorName} sebagai lunas?`
                : action.type === 'reject'
                  ? `Kembalikan status tagihan ${formatRupiah(action.item.amountIdr)} milik ${action.item.debtorName} menjadi Belum Dibayar?`
                  : `Batalkan catatan piutang ${formatRupiah(action.item.amountIdr)} kepada ${action.item.debtorName}?`
            : ''
        }
        confirmLabel={
          action?.type === 'pay'
            ? 'Kirim Konfirmasi Bayar'
            : action?.type === 'confirm'
              ? 'Ya, Tandai Lunas'
              : action?.type === 'reject'
                ? 'Kembalikan ke Belum Bayar'
                : 'Ya, Batalkan Catatan'
        }
        confirmVariant={action?.type === 'confirm' ? 'credit' : 'primary'}
        busy={actionBusy}
        onClose={() => setAction(null)}
        onConfirm={executeAction}
      >
        {actionError && (
          <div class="alert alert-error" role="alert">
            {actionError}
          </div>
        )}

        {action?.type === 'pay' && (
          <div class="field">
            <label for="payment-note-input">Catatan Pembayaran (Opsional)</label>
            <textarea
              id="payment-note-input"
              class="textarea"
              maxLength={200}
              value={paymentNote}
              onInput={(e) => setPaymentNote((e.target as HTMLTextAreaElement).value)}
              placeholder="misal: Sudah transfer BCA a.n. Budi tanggal 24 Nov"
            />
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
