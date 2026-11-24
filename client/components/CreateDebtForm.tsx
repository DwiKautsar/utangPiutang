import { useState } from 'preact/hooks';
import { api, ApiError, formatRupiah, type UserProfile } from '../api';

interface BorrowerDraft {
  key: number;
  debtorId: string;
  amountIdr: string;
  noteOverride: string;
}

interface CreateDebtFormProps {
  users: UserProfile[];
  loadingUsers: boolean;
  onCreated: () => Promise<void>;
}

let nextDraftKey = 2;

export function CreateDebtForm({ users, loadingUsers, onCreated }: CreateDebtFormProps) {
  const [sharedDescription, setSharedDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [rows, setRows] = useState<BorrowerDraft[]>([
    { key: 1, debtorId: '', amountIdr: '', noteOverride: '' }
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function addRow() {
    if (rows.length >= 20) return;
    setRows((prev) => [
      ...prev,
      { key: nextDraftKey++, debtorId: '', amountIdr: '', noteOverride: '' }
    ]);
  }

  function removeRow(key: number) {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((item) => item.key !== key));
  }

  function updateRow(key: number, field: keyof Omit<BorrowerDraft, 'key'>, value: string) {
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

    const payloadItems: Array<{
      debtorId: number;
      amountIdr: number;
      description: string;
      dueDate?: string;
    }> = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const debtorId = Number(row.debtorId);
      const amountIdr = Number(row.amountIdr.replace(/[^\d]/g, ''));
      const description = (row.noteOverride.trim() || sharedDescription.trim()).trim();

      if (!debtorId) {
        setError(`Pilih peminjam pada baris ke-${i + 1}.`);
        return;
      }
      if (!Number.isInteger(amountIdr) || amountIdr <= 0) {
        setError(`Masukkan nominal Rupiah yang valid pada baris ke-${i + 1}.`);
        return;
      }
      if (description.length < 2) {
        setError(`Isi keterangan transaksi (minimal 2 karakter) untuk baris ke-${i + 1}.`);
        return;
      }

      payloadItems.push({
        debtorId,
        amountIdr,
        description,
        dueDate: dueDate || undefined
      });
    }

    setSubmitting(true);
    try {
      await api.createDebts(payloadItems);
      setSharedDescription('');
      setDueDate('');
      setRows([{ key: nextDraftKey++, debtorId: '', amountIdr: '', noteOverride: '' }]);
      setSuccessMessage(
        `${payloadItems.length} catatan piutang tersimpan. Tagihan otomatis muncul di akun peminjam.`
      );
      await onCreated();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Gagal menyimpan catatan piutang. Coba lagi.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section class="panel" aria-labelledby="create-debt-heading">
      <div class="panel-heading">
        <div>
          <h2 id="create-debt-heading">Catat Piutang Baru</h2>
          <p>Input satu atau beberapa orang sekaligus. Tagihan langsung masuk ke akun mereka.</p>
        </div>
      </div>

      {loadingUsers ? (
        <div class="state-box" role="status">
          <p>Memuat daftar akun pengguna...</p>
        </div>
      ) : users.length === 0 ? (
        <div class="state-box">
          <h3>Belum ada akun lain terdaftar</h3>
          <p>
            Buat minimal satu akun pengguna lain agar Anda bisa memilih peminjam dan melihat
            tagihan muncul otomatis di akun mereka.
          </p>
        </div>
      ) : (
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
              placeholder="misal: Patungan makan siang di kantin"
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

          <div class="borrower-list" aria-label="Daftar orang yang berutang">
            {rows.map((row, idx) => (
              <div class="borrower-row" key={row.key}>
                <div class="borrower-row-head">
                  <span class="borrower-index tabular-num">Peminjam #{idx + 1}</span>
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

                <div class="field">
                  <label for={`debtor-${row.key}`}>Akun Peminjam</label>
                  <select
                    id={`debtor-${row.key}`}
                    class="select"
                    value={row.debtorId}
                    onChange={(e) => updateRow(row.key, 'debtorId', (e.target as HTMLSelectElement).value)}
                  >
                    <option value="">Pilih pengguna...</option>
                    {users.map((u) => (
                      <option value={String(u.id)} key={u.id}>
                        {u.displayName} (@{u.username})
                      </option>
                    ))}
                  </select>
                </div>

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
            ))}
          </div>

          {totalPreview > 0 && (
            <p class="field-hint tabular-num">
              Total piutang yang akan dicatat: <strong>{formatRupiah(totalPreview)}</strong>
            </p>
          )}

          <div class="form-actions">
            <button
              type="button"
              class="btn btn-secondary"
              onClick={addRow}
              disabled={rows.length >= 20 || submitting}
            >
              + Tambah Peminjam
            </button>
            <button type="submit" class="btn btn-primary" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan & Kirim Tagihan'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
