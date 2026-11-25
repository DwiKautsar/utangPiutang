export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,24}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT_IDR = 1_000_000_000;
const MAX_BATCH_ITEMS = 20;

export function validateRegisterInput(body: unknown): ValidationResult<{
  username: string;
  displayName: string;
  password: string;
}> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Format data tidak valid.' };
  }
  const raw = body as Record<string, unknown>;
  const username = typeof raw.username === 'string' ? raw.username.trim().toLowerCase() : '';
  const displayName =
    typeof raw.displayName === 'string' ? raw.displayName.trim() : username;
  const password = typeof raw.password === 'string' ? raw.password : '';

  if (!USERNAME_REGEX.test(username)) {
    return {
      ok: false,
      error: 'Username harus 3 sampai 24 karakter (huruf, angka, titik, garis bawah, atau strip).'
    };
  }
  if (displayName.length < 2 || displayName.length > 48) {
    return { ok: false, error: 'Nama tampilan harus 2 sampai 48 karakter.' };
  }
  if (password.length < 6 || password.length > 128) {
    return { ok: false, error: 'Password minimal 6 karakter dan maksimal 128 karakter.' };
  }

  return { ok: true, data: { username, displayName, password } };
}

export function validateLoginInput(body: unknown): ValidationResult<{
  username: string;
  password: string;
}> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Format data tidak valid.' };
  }
  const raw = body as Record<string, unknown>;
  const username = typeof raw.username === 'string' ? raw.username.trim().toLowerCase() : '';
  const password = typeof raw.password === 'string' ? raw.password : '';

  if (!username || !password) {
    return { ok: false, error: 'Username dan password wajib diisi.' };
  }

  return { ok: true, data: { username, password } };
}

export interface CreateDebtItemInput {
  recordType: 'receivable' | 'payable';
  debtorId: number | null;
  debtorName: string | null;
  creditorId: number | null;
  creditorName: string | null;
  amountIdr: number;
  description: string;
  dueDate: string | null;
}

export function validateCreateDebtsInput(body: unknown): ValidationResult<CreateDebtItemInput[]> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Format data catatan tidak valid.' };
  }
  const raw = body as Record<string, unknown>;
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [raw];

  if (itemsRaw.length === 0) {
    return { ok: false, error: 'Minimal isi satu baris catatan.' };
  }
  if (itemsRaw.length > MAX_BATCH_ITEMS) {
    return { ok: false, error: `Maksimal ${MAX_BATCH_ITEMS} baris dalam satu pencatatan.` };
  }

  const parsed: CreateDebtItemInput[] = [];
  for (let i = 0; i < itemsRaw.length; i += 1) {
    const item = itemsRaw[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `Baris ke-${i + 1} tidak valid.` };
    }
    const row = item as Record<string, unknown>;
    const recordType = row.recordType === 'payable' ? 'payable' : 'receivable';
    const amountIdr = Number(row.amountIdr);
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    const dueDateRaw = typeof row.dueDate === 'string' ? row.dueDate.trim() : '';

    if (!Number.isInteger(amountIdr) || amountIdr <= 0 || amountIdr > MAX_AMOUNT_IDR) {
      return {
        ok: false,
        error: `Nominal pada baris ke-${i + 1} harus bilangan bulat antara Rp1 sampai Rp1.000.000.000.`
      };
    }
    if (description.length < 2 || description.length > 160) {
      return {
        ok: false,
        error: `Keterangan pada baris ke-${i + 1} harus 2 sampai 160 karakter.`
      };
    }
    if (dueDateRaw && !ISO_DATE_REGEX.test(dueDateRaw)) {
      return {
        ok: false,
        error: `Format jatuh tempo pada baris ke-${i + 1} harus YYYY-MM-DD.`
      };
    }

    if (recordType === 'payable') {
      const hasCreditorId =
        row.creditorId !== undefined &&
        row.creditorId !== null &&
        String(row.creditorId).trim() !== '';
      const creditorId = hasCreditorId ? Number(row.creditorId) : null;
      const creditorName = typeof row.creditorName === 'string' ? row.creditorName.trim() : '';

      if (creditorId !== null) {
        if (!Number.isInteger(creditorId) || creditorId <= 0) {
          return { ok: false, error: `Akun pemberi utang pada baris ke-${i + 1} tidak valid.` };
        }
        parsed.push({
          recordType: 'payable',
          debtorId: null,
          debtorName: null,
          creditorId,
          creditorName: null,
          amountIdr,
          description,
          dueDate: dueDateRaw || null
        });
      } else {
        if (creditorName.length < 2 || creditorName.length > 60) {
          return {
            ok: false,
            error: `Pilih akun pemberi utang atau isi nama (2 sampai 60 karakter) pada baris ke-${i + 1}.`
          };
        }
        parsed.push({
          recordType: 'payable',
          debtorId: null,
          debtorName: null,
          creditorId: null,
          creditorName,
          amountIdr,
          description,
          dueDate: dueDateRaw || null
        });
      }
    } else {
      const hasDebtorId =
        row.debtorId !== undefined && row.debtorId !== null && String(row.debtorId).trim() !== '';
      const debtorId = hasDebtorId ? Number(row.debtorId) : null;
      const debtorName = typeof row.debtorName === 'string' ? row.debtorName.trim() : '';

      if (debtorId !== null) {
        if (!Number.isInteger(debtorId) || debtorId <= 0) {
          return { ok: false, error: `Akun peminjam pada baris ke-${i + 1} tidak valid.` };
        }
        parsed.push({
          recordType: 'receivable',
          debtorId,
          debtorName: null,
          creditorId: null,
          creditorName: null,
          amountIdr,
          description,
          dueDate: dueDateRaw || null
        });
      } else {
        if (debtorName.length < 2 || debtorName.length > 60) {
          return {
            ok: false,
            error: `Pilih akun peminjam atau isi nama peminjam (2 sampai 60 karakter) pada baris ke-${i + 1}.`
          };
        }
        parsed.push({
          recordType: 'receivable',
          debtorId: null,
          debtorName,
          creditorId: null,
          creditorName: null,
          amountIdr,
          description,
          dueDate: dueDateRaw || null
        });
      }
    }
  }

  return { ok: true, data: parsed };
}

export function validatePaymentNote(body: unknown): ValidationResult<string | null> {
  if (body === undefined || body === null) {
    return { ok: true, data: null };
  }
  if (typeof body !== 'object') {
    return { ok: false, error: 'Format catatan pembayaran tidak valid.' };
  }
  const raw = body as Record<string, unknown>;
  if (raw.paymentNote === undefined || raw.paymentNote === null || raw.paymentNote === '') {
    return { ok: true, data: null };
  }
  if (typeof raw.paymentNote !== 'string') {
    return { ok: false, error: 'Catatan pembayaran harus berupa teks.' };
  }
  const note = raw.paymentNote.trim();
  if (note.length > 200) {
    return { ok: false, error: 'Catatan pembayaran maksimal 200 karakter.' };
  }
  return { ok: true, data: note || null };
}
