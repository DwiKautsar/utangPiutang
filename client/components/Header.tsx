import type { UserProfile } from '../api';

interface HeaderProps {
  user: UserProfile;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function Header({
  user,
  theme,
  onToggleTheme,
  onLogout,
  loggingOut
}: HeaderProps) {
  return (
    <header class="site-header">
      <div class="brand-group">
        <a href="#ringkasan" class="brand-wordmark">
          BukuUtang
        </a>
        <span class="brand-edition">
          {user.role === 'admin' ? 'Dashboard Pengelolaan Admin' : 'Catatan kas terhubung'}
        </span>
      </div>

      <nav class="header-controls" aria-label="Kontrol akun dan tampilan">
        <div class="user-chip" aria-label={`Masuk sebagai ${user.displayName}`}>
          <span class="user-initials" aria-hidden="true">
            {getInitials(user.displayName)}
          </span>
          <span>{user.displayName}</span>
          <span class="user-handle">@{user.username}</span>
          {user.role === 'admin' && <span class="role-tag">Admin</span>}
        </div>

        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={onToggleTheme}
          aria-pressed={theme === 'dark'}
        >
          {theme === 'light' ? 'Mode Gelap' : 'Mode Terang'}
        </button>

        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={onLogout}
          disabled={loggingOut}
        >
          {loggingOut ? 'Keluar...' : 'Keluar'}
        </button>
      </nav>
    </header>
  );
}
