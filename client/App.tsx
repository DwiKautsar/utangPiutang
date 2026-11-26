import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  api,
  ApiError,
  type DebtItem,
  type DebtSummary,
  type UserProfile
} from './api';
import { AuthView } from './components/AuthView';
import { Header } from './components/Header';
import { SummaryStrip } from './components/SummaryStrip';
import { CreateDebtForm } from './components/CreateDebtForm';
import { DebtLedger } from './components/DebtLedger';
import { AdminPanel } from './components/AdminPanel';

const EMPTY_SUMMARY: DebtSummary = {
  totalReceivableIdr: 0,
  totalPayableIdr: 0,
  netBalanceIdr: 0,
  pendingConfirmationCount: 0,
  activeBillCount: 0
};

const USER_CACHE_KEY = 'bukuutang_cached_user';

function readInitialTheme(): 'light' | 'dark' {
  try {
    const saved = window.localStorage.getItem('bukuutang_theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Ignore storage restriction and fall back to default dark theme
  }
  return 'dark';
}

// Cache non-sensitive UI profile in sessionStorage so refreshes render the shell immediately
function readCachedUser(): UserProfile | null {
  try {
    const raw = window.sessionStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    if (parsed && typeof parsed.id === 'number' && typeof parsed.username === 'string') {
      return parsed;
    }
  } catch {
    // Ignore malformed cache
  }
  return null;
}

function writeCachedUser(user: UserProfile | null) {
  try {
    if (user) {
      window.sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    } else {
      window.sessionStorage.removeItem(USER_CACHE_KEY);
    }
  } catch {
    // Ignore storage write errors
  }
}

export function App() {
  const initialCachedUser = readCachedUser();
  const [theme, setTheme] = useState<'light' | 'dark'>(readInitialTheme);
  const [user, setUser] = useState<UserProfile | null>(initialCachedUser);
  const [checkingSession, setCheckingSession] = useState(initialCachedUser === null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [role, setRole] = useState<'debtor' | 'creditor'>('debtor');
  const [statusFilter, setStatusFilter] = useState('all');
  const [summary, setSummary] = useState<DebtSummary>(EMPTY_SUMMARY);
  const [items, setItems] = useState<DebtItem[]>([]);
  const [loadingDebts, setLoadingDebts] = useState(false);
  const [debtsError, setDebtsError] = useState<string | null>(null);

  const bootstrappedRef = useRef(false);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('bukuutang_theme', theme);
    } catch {
      // Ignore storage write errors
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    api
      .getBootstrap()
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
        writeCachedUser(res.user);
        if (res.user && res.user.role !== 'admin') {
          bootstrappedRef.current = true;
          if (res.users) setUsers(res.users);
          if (res.summary) setSummary(res.summary);
          if (res.items) setItems(res.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          writeCachedUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await api.listUsers();
      setUsers(res.users);
    } catch {
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadDebts = useCallback(async () => {
    setLoadingDebts(true);
    setDebtsError(null);
    try {
      const res = await api.listDebts({ role, status: statusFilter });
      setSummary(res.summary);
      setItems(res.items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        writeCachedUser(null);
        return;
      }
      setDebtsError(
        err instanceof ApiError ? err.message : 'Gagal mengambil data catatan dari server.'
      );
    } finally {
      setLoadingDebts(false);
    }
  }, [role, statusFilter]);

  useEffect(() => {
    if (!user || user.role === 'admin') return;
    if (bootstrappedRef.current) return;
    loadUsers();
  }, [user, loadUsers]);

  useEffect(() => {
    if (!user || user.role === 'admin') return;
    if (bootstrappedRef.current && role === 'debtor' && statusFilter === 'all') {
      bootstrappedRef.current = false;
      return;
    }
    loadDebts();
  }, [user, role, statusFilter, loadDebts]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.logout();
    } finally {
      setUser(null);
      writeCachedUser(null);
      setItems([]);
      setSummary(EMPTY_SUMMARY);
      setLoggingOut(false);
    }
  }

  function toggleTheme() {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }

  if (checkingSession) {
    return (
      <main class="app-shell" style={{ paddingTop: '64px' }}>
        <div class="state-box" role="status">
          <h1>BukuUtang</h1>
          <p>Memeriksa sesi akun Anda...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <AuthView
        theme={theme}
        onToggleTheme={toggleTheme}
        onAuthenticated={(loggedUser) => {
          bootstrappedRef.current = false;
          setUser(loggedUser);
          writeCachedUser(loggedUser);
          setRole('debtor');
          setStatusFilter('all');
        }}
      />
    );
  }

  return (
    <div class="app-shell">
      <Header
        user={user}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
        loggingOut={loggingOut}
      />

      <main>
        {user.role === 'admin' ? (
          <AdminPanel currentUser={user} />
        ) : (
          <div class="dashboard-main">
            <SummaryStrip summary={summary} />

            <div class="workspace-grid">
              <CreateDebtForm
                users={users}
                loadingUsers={loadingUsers}
                onCreated={async (createdType) => {
                  setRole(createdType === 'payable' ? 'debtor' : 'creditor');
                  await loadDebts();
                }}
              />

              <DebtLedger
                role={role}
                statusFilter={statusFilter}
                items={items}
                summary={summary}
                loading={loadingDebts}
                error={debtsError}
                onChangeRole={(nextRole) => setRole(nextRole)}
                onChangeStatus={(nextStatus) => setStatusFilter(nextStatus)}
                onRefresh={loadDebts}
              />
            </div>
          </div>
        )}
      </main>

      <footer class="site-footer">
        <span>BukuUtang: pencatatan utang piutang terhubung antar akun.</span>
        <span>Database Turso SQLite aktif.</span>
      </footer>
    </div>
  );
}
