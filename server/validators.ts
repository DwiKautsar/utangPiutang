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
  debtorId: number;
  amountIdr: number;
  description: string;
  dueDate: string | null;
}

export function validateCreateDebtsInput(body: unknown): ValidationResult<CreateDebtItemInput[]> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Format data piutang tidak valid.' };
  }
  const raw = body as Record<string, unknown>;
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [raw];

  if (itemsRaw.length === 0) {
    return { ok: false, error: 'Minimal pilih satu peminjam.' };
  }
  if (itemsRaw.length > MAX_BATCH_ITEMS) {
    return { ok: false, error: `Maksimal ${MAX_BATCH_ITEMS} peminjam dalam satu pencatatan.` };
  }

  const parsed: CreateDebtItemInput[] = [];
  for (let i = 0; i < itemsRaw.length; i += 1) {
    const item = itemsRaw[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `Baris peminjam ke-${i + 1} tidak valid.` };
    }
    const row = item as Record<string, unknown>;
    const debtorId = Number(row.debtorId);
    const amountIdr = Number(row.amountIdr);
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    const dueDateRaw = typeof row.dueDate === 'string' ? row.dueDate.trim() : '';

    if (!Number.isInteger(debtorId) || debtorId <= 0) {
      return { ok: false, error: `Peminjam pada baris ke-${i + 1} belum dipilih.` };
    }
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

    parsed.push({
      debtorId,
      amountIdr,
      description,
      dueDate: dueDateRaw || null
    });
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
