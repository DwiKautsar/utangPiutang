import { useCallback, useEffect, useLayoutEffect, useState } from 'preact/hooks';
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

const EMPTY_SUMMARY: DebtSummary = {
  totalReceivableIdr: 0,
  totalPayableIdr: 0,
  netBalanceIdr: 0,
  pendingConfirmationCount: 0,
  activeBillCount: 0
};

function readInitialTheme(): 'light' | 'dark' {
  try {
    const saved = window.localStorage.getItem('bukuutang_theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Ignore storage restriction and fall back to light paper theme
  }
  return 'light';
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(readInitialTheme);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [role, setRole] = useState<'debtor' | 'creditor'>('debtor');
  const [statusFilter, setStatusFilter] = useState('all');
  const [summary, setSummary] = useState<DebtSummary>(EMPTY_SUMMARY);
  const [items, setItems] = useState<DebtItem[]>([]);
  const [loadingDebts, setLoadingDebts] = useState(false);
  const [debtsError, setDebtsError] = useState<string | null>(null);

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
      .getMe()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
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
    if (!user) return;
    loadUsers();
  }, [user, loadUsers]);

  useEffect(() => {
    if (!user) return;
    loadDebts();
  }, [user, loadDebts]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.logout();
    } finally {
      setUser(null);
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
          setUser(loggedUser);
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

      <main class="dashboard-main">
        <SummaryStrip summary={summary} />

        <div class="workspace-grid">
          <CreateDebtForm
            users={users}
            loadingUsers={loadingUsers}
            onCreated={async () => {
              setRole('creditor');
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
      </main>

      <footer class="site-footer">
        <span>BukuUtang: pencatatan utang piutang terhubung antar akun.</span>
        <span>Database SQLite lokal aktif.</span>
      </footer>
    </div>
  );
}
