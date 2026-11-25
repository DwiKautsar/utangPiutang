import { useState } from 'preact/hooks';
import {
  api,
  ApiError,
  formatRupiah,
  type CreateDebtPayloadItem,
  type UserProfile
} from '../api';

interface CounterpartyDraft {
  key: number;
  targetMode: 'account' | 'manual';
  targetUserId: string;
  manualName: string;
  amountIdr: string;
  noteOverride: string;
}

interface CreateDebtFormProps {
  users: UserProfile[];
  loadingUsers: boolean;
  onCreated: (recordType: 'receivable' | 'payable') => Promise<void>;
}

let nextDraftKey = 2;

export function CreateDebtForm({ users, loadingUsers, onCreated }: CreateDebtFormProps) {
  const [recordType, setRecordType] = useState<'receivable' | 'payable'>('receivable');
  const [sharedDescription, setSharedDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [rows, setRows] = useState<CounterpartyDraft[]>([
    {
      key: 1,
      targetMode: users.length > 0 ? 'account' : 'manual',
      targetUserId: '',
      manualName: '',
      amountIdr: '',
      noteOverride: ''
    }
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function addRow() {
    if (rows.length >= 20) return;
    setRows((prev) => [
      ...prev,
      {
        key: nextDraftKey++,
        targetMode: users.length > 0 ? 'account' : 'manual',
        targetUserId: '',
        manualName: '',
        amountIdr: '',
        noteOverride: ''
      }
    ]);
  }

  function removeRow(key: number) {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((item) => item.key !== key));
  }

  function updateRow(key: number, field: keyof Omit<CounterpartyDraft, 'key'>, value: string) {
    setRows((prev) => prev.map((item) => (item.key === key ? { ...item, [field]: value } : item)));
  }

  const totalPreview = rows.reduce((acc, row) => {
    const val = Number(row.amountIdr.replace(/[^\d]/g, ''));
    return acc + (Number.isFinite(val) ? val : 0);
  }, 0);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const payloadItems: CreateDebtPayloadItem[] = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const amountIdr = Number(row.amountIdr.replace(/[^\d]/g, ''));
      const description = (row.noteOverride.trim() || sharedDescription.trim()).trim();

      if (!Number.isInteger(amountIdr) || amountIdr <= 0) {
        setError(`Masukkan nominal Rupiah yang valid pada baris ke-${i + 1}.`);
        return;
      }
      if (description.length < 2) {
        setError(`Isi keterangan transaksi (minimal 2 karakter) untuk baris ke-${i + 1}.`);
        return;
      }

      const useAccount = row.targetMode === 'account' && users.length > 0;

      if (recordType === 'payable') {
        if (useAccount) {
          const creditorId = Number(row.targetUserId);
          if (!creditorId) {
            setError(`Pilih akun pemberi utang pada baris ke-${i + 1}, atau ganti ke Tulis Nama Manual.`);
            return;
          }
          payloadItems.push({
            recordType: 'payable',
            creditorId,
            amountIdr,
            description,
            dueDate: dueDate || undefined
          });
        } else {
          const creditorName = row.manualName.trim();
          if (creditorName.length < 2) {
            setError(`Isi nama pemberi utang (minimal 2 karakter) pada baris ke-${i + 1}.`);
            return;
          }
          payloadItems.push({
            recordType: 'payable',
            creditorName,
            amountIdr,
            description,
            dueDate: dueDate || undefined
          });
        }
      } else if (useAccount) {
        const debtorId = Number(row.targetUserId);
        if (!debtorId) {
          setError(`Pilih akun peminjam pada baris ke-${i + 1}, atau ganti ke Tulis Nama Manual.`);
          return;
        }
        payloadItems.push({
          recordType: 'receivable',
          debtorId,
          amountIdr,
          description,
          dueDate: dueDate || undefined
        });
      } else {
        const debtorName = row.manualName.trim();
        if (debtorName.length < 2) {
          setError(`Isi nama peminjam (minimal 2 karakter) pada baris ke-${i + 1}.`);
          return;
        }
        payloadItems.push({
          recordType: 'receivable',
          debtorName,
          amountIdr,
          description,
          dueDate: dueDate || undefined
        });
      }
    }

    setSubmitting(true);
    try {
      await api.createDebts(payloadItems);
      setSharedDescription('');
      setDueDate('');
      setRows([
        {
          key: nextDraftKey++,
          targetMode: users.length > 0 ? 'account' : 'manual',
          targetUserId: '',
          manualName: '',
          amountIdr: '',
          noteOverride: ''
        }
      ]);
      setSuccessMessage(
        recordType === 'payable'
          ? `${payloadItems.length} catatan utang tersimpan di Tagihan Saya.`
          : `${payloadItems.length} catatan piutang tersimpan di Piutang Saya.`
      );
      await onCreated(recordType);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Gagal menyimpan catatan. Coba lagi.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section class="panel" aria-labelledby="create-debt-heading">
      <div class="panel-heading">
        <div>
          <h2 id="create-debt-heading">Catat Transaksi Baru</h2>
          <p>Pilih akun terdaftar agar otomatis terhubung, atau tulis nama manual jika belum punya akun.</p>
        </div>
      </div>

      <div class="tab-bar" role="tablist" aria-label="Jenis catatan baru">
        <button
          type="button"
          role="tab"
          aria-selected={recordType === 'receivable'}
          class="tab-btn"
          onClick={() => {
            setRecordType('receivable');
            setError(null);
            setSuccessMessage(null);
          }}
        >
          Catat Piutang
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={recordType === 'payable'}
          class="tab-btn"
          onClick={() => {
            setRecordType('payable');
            setError(null);
            setSuccessMessage(null);
          }}
        >
          Catat Utang
        </button>
      </div>

      <div class="role-explainer" role="note">
        {recordType === 'receivable' ? (
          <p>
            <strong>Piutang:</strong> Orang lain berutang kepada Anda (Anda yang meminjamkan uang).
          </p>
        ) : (
          <p>
            <strong>Utang:</strong> Anda yang berutang kepada orang lain (tagihan yang harus Anda bayar).
          </p>
        )}
      </div>

      <form class="form-stack" onSubmit={handleSubmit} noValidate>
        {error && (
          <div class="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {successMessage && (
          <div class="alert alert-success" role="status">
            {successMessage}
          </div>
        )}

        <div class="field">
          <label for="debt-shared-desc">Keterangan Utama</label>
          <input
            id="debt-shared-desc"
            type="text"
            class="input"
            maxLength={160}
            value={sharedDescription}
            onInput={(e) => setSharedDescription((e.target as HTMLInputElement).value)}
            placeholder={
              recordType === 'receivable'
                ? 'misal: Patungan makan siang di kantin'
                : 'misal: Pinjam uang parkir / belanja warung'
            }
          />
        </div>

        <div class="field">
          <label for="debt-due-date">Jatuh Tempo (Opsional)</label>
          <input
            id="debt-due-date"
            type="date"
            class="input"
            value={dueDate}
            onInput={(e) => setDueDate((e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="borrower-list" aria-label="Daftar pihak transaksi">
          {rows.map((row, idx) => {
            const effectiveMode = users.length === 0 ? 'manual' : row.targetMode;

            return (
              <div class="borrower-row" key={row.key}>
                <div class="borrower-row-head">
                  <span class="borrower-index tabular-num">
                    {recordType === 'receivable' ? `Peminjam #${idx + 1}` : `Pemberi Utang #${idx + 1}`}
                  </span>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      onClick={() => removeRow(row.key)}
                    >
                      Hapus
                    </button>
                  )}
                </div>

                {!loadingUsers && users.length > 0 && (
                  <div class="mode-toggle-row" role="group" aria-label={`Sumber nama baris ${idx + 1}`}>
                    <button
                      type="button"
                      class={`btn btn-sm ${effectiveMode === 'account' ? 'btn-secondary' : 'btn-ghost'}`}
                      aria-pressed={effectiveMode === 'account'}
                      onClick={() => updateRow(row.key, 'targetMode', 'account')}
                    >
                      Akun Terdaftar
                    </button>
                    <button
                      type="button"
                      class={`btn btn-sm ${effectiveMode === 'manual' ? 'btn-secondary' : 'btn-ghost'}`}
                      aria-pressed={effectiveMode === 'manual'}
                      onClick={() => updateRow(row.key, 'targetMode', 'manual')}
                    >
                      Tulis Nama Manual
                    </button>
                  </div>
                )}

                {effectiveMode === 'account' ? (
                  <div class="field">
                    <label for={`target-user-${row.key}`}>
                      {recordType === 'receivable' ? 'Akun Peminjam' : 'Akun Pemberi Utang'}
                    </label>
                    <select
                      id={`target-user-${row.key}`}
                      class="select"
                      value={row.targetUserId}
                      onChange={(e) =>
                        updateRow(row.key, 'targetUserId', (e.target as HTMLSelectElement).value)
                      }
                    >
                      <option value="">Pilih pengguna...</option>
                      {users.map((u) => (
                        <option value={String(u.id)} key={u.id}>
                          {u.displayName} (@{u.username})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div class="field">
                    <label for={`manual-name-${row.key}`}>
                      {recordType === 'receivable'
                        ? 'Nama Peminjam (Tanpa Akun)'
                        : 'Nama Pemberi Utang (Tanpa Akun)'}
                    </label>
                    <input
                      id={`manual-name-${row.key}`}
                      type="text"
                      class="input"
                      maxLength={60}
                      value={row.manualName}
                      onInput={(e) =>
                        updateRow(row.key, 'manualName', (e.target as HTMLInputElement).value)
                      }
                      placeholder={
                        recordType === 'receivable'
                          ? 'misal: Pak Joko Bengkel'
                          : 'misal: Warung Bu Siti'
                      }
                    />
                  </div>
                )}

                <div class="field">
                  <label for={`amount-${row.key}`}>Nominal (Rp)</label>
                  <input
                    id={`amount-${row.key}`}
                    type="text"
                    inputMode="numeric"
                    class="input tabular-num"
                    value={row.amountIdr}
                    onInput={(e) =>
                      updateRow(
                        row.key,
                        'amountIdr',
                        (e.target as HTMLInputElement).value.replace(/[^\d]/g, '')
                      )
                    }
                    placeholder="misal: 35000"
                  />
                </div>

                {rows.length > 1 && (
                  <div class="field">
                    <label for={`note-${row.key}`}>Catatan Khusus Baris Ini (Opsional)</label>
                    <input
                      id={`note-${row.key}`}
                      type="text"
                      class="input"
                      maxLength={160}
                      value={row.noteOverride}
                      onInput={(e) =>
                        updateRow(row.key, 'noteOverride', (e.target as HTMLInputElement).value)
                      }
                      placeholder="Kosongkan untuk pakai keterangan utama"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {totalPreview > 0 && (
          <p class="field-hint tabular-num">
            Total nominal yang akan dicatat: <strong>{formatRupiah(totalPreview)}</strong>
          </p>
        )}

        <div class="form-actions">
          <button
            type="button"
            class="btn btn-secondary"
            onClick={addRow}
            disabled={rows.length >= 20 || submitting}
          >
            {recordType === 'receivable' ? '+ Tambah Peminjam' : '+ Tambah Pemberi Utang'}
          </button>
          <button type="submit" class="btn btn-primary" disabled={submitting}>
            {submitting
              ? 'Menyimpan...'
              : recordType === 'receivable'
                ? 'Simpan Piutang'
                : 'Simpan Utang'}
          </button>
        </div>
      </form>
    </section>
  );
}
