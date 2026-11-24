import { useState } from 'preact/hooks';
import { api, ApiError, type UserProfile } from '../api';

interface AuthViewProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onAuthenticated: (user: UserProfile) => void;
}

export function AuthView({ theme, onToggleTheme, onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Username dan password wajib diisi.');
      return;
    }

    setSubmitting(true);

    try {
      if (mode === 'login') {
        const res = await api.login({ username, password });
        onAuthenticated(res.user);
      } else {
        const res = await api.register({
          username,
          displayName: displayName.trim() || username.trim(),
          password
        });
        onAuthenticated(res.user);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Tidak dapat terhubung ke server. Periksa koneksi Anda.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="auth-page">
      <header class="auth-header">
        <div class="brand-group">
          <span class="brand-wordmark">BukuUtang</span>
          <span class="brand-edition">Buku kas bersama</span>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={onToggleTheme}
          aria-pressed={theme === 'dark'}
        >
          {theme === 'light' ? 'Mode Gelap' : 'Mode Terang'}
        </button>
      </header>

      <main class="auth-grid">
        <section class="auth-intro" aria-labelledby="auth-heading">
          <h1 id="auth-heading">Catat piutang sekali, tagihan otomatis muncul di akun peminjam.</h1>
          <p>
            Setiap catatan utang piutang tersimpan di satu buku bersama. Ketika Anda mencatat
            siapa saja yang berutang, tagihan dengan nominal yang sama langsung tampil di halaman
            mereka.
          </p>
          <ol class="flow-list">
            <li>
              <span class="flow-index tabular-num">01</span>
              <span>Masuk dengan username dan password akun masing-masing.</span>
            </li>
            <li>
              <span class="flow-index tabular-num">02</span>
              <span>Catat satu atau beberapa peminjam sekaligus beserta nominal Rupiah.</span>
            </li>
            <li>
              <span class="flow-index tabular-num">03</span>
              <span>Peminjam melihat tagihan otomatis, menandai bayar, lalu Anda konfirmasi lunas.</span>
            </li>
          </ol>
        </section>

        <section class="auth-panel" aria-label="Formulir akun">
          <div class="tab-bar" role="tablist" aria-label="Pilih mode autentikasi">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              class="tab-btn"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
            >
              Masuk
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              class="tab-btn"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
            >
              Buat Akun
            </button>
          </div>

          <form class="form-stack" onSubmit={handleSubmit} noValidate>
            {error && (
              <div class="alert alert-error" role="alert">
                {error}
              </div>
            )}

            <div class="field">
              <label for="auth-username">Username</label>
              <input
                id="auth-username"
                name="username"
                type="text"
                class="input"
                autoComplete="username"
                required
                value={username}
                onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
                placeholder="misal: budi_s"
              />
              {mode === 'register' && (
                <span class="field-hint">3 sampai 24 karakter (huruf, angka, titik, atau garis bawah).</span>
              )}
            </div>

            {mode === 'register' && (
              <div class="field">
                <label for="auth-display-name">Nama Tampilan</label>
                <input
                  id="auth-display-name"
                  name="displayName"
                  type="text"
                  class="input"
                  autoComplete="name"
                  value={displayName}
                  onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                  placeholder="misal: Budi Santoso"
                />
              </div>
            )}

            <div class="field">
              <label for="auth-password">Password</label>
              <input
                id="auth-password"
                name="password"
                type="password"
                class="input"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                value={password}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                placeholder={mode === 'register' ? 'Minimal 6 karakter' : 'Masukkan password'}
              />
            </div>

            <button type="submit" class="btn btn-primary" disabled={submitting}>
              {submitting
                ? 'Memproses...'
                : mode === 'login'
                  ? 'Masuk ke BukuUtang'
                  : 'Daftarkan Akun Baru'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
