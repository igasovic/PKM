import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { DebugPage } from './pages/DebugPage';
import { ReadPage } from './pages/ReadPage';

type MenuItem = {
  id: string;
  label: string;
  to?: string;
  children?: Array<{ id: string; label: string; to: string }>;
};

const MENU_ITEMS: MenuItem[] = [
  { id: 'read', label: 'Read', to: '/read' },
  { id: 'debug', label: 'Debug', to: '/debug' },
];

function SidebarLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `block rounded-lg border px-3 py-2 text-sm transition ${
          isActive
            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
            : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:bg-slate-800'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

function SidebarNav() {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [isTestMode, setIsTestMode] = useState<boolean | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const menu = useMemo(() => MENU_ITEMS, []);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const readIsTestMode = (payload: unknown): boolean => {
    if (Array.isArray(payload) && payload[0] && typeof payload[0] === 'object') {
      return Boolean((payload[0] as { is_test_mode?: unknown }).is_test_mode);
    }
    if (payload && typeof payload === 'object' && Array.isArray((payload as { rows?: unknown[] }).rows)) {
      const row0 = (payload as { rows: Array<{ is_test_mode?: unknown }> }).rows[0];
      if (row0) return Boolean(row0.is_test_mode);
    }
    return false;
  };

  const loadTestMode = async () => {
    const res = await fetch('/db/test-mode', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error('failed to load test mode');
    setIsTestMode(readIsTestMode(data));
  };

  useEffect(() => {
    void loadTestMode().catch(() => {
      setToggleError('test mode unavailable');
      setIsTestMode(null);
    });
  }, []);

  const toggleTestMode = async () => {
    if (toggleBusy) return;
    setToggleBusy(true);
    setToggleError(null);
    try {
      const res = await fetch('/db/test-mode/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error('failed to toggle test mode');
      setIsTestMode(readIsTestMode(data));
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : 'toggle failed');
    } finally {
      setToggleBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <nav className="space-y-2">
        {menu.map((item) => {
          if (!item.children || item.children.length === 0) {
            return <SidebarLink key={item.id} to={item.to || '/'} label={item.label} />;
          }

          const isActive = item.children.some((child) => location.pathname.startsWith(child.to));
          const isOpen = openGroups[item.id] ?? isActive;

          return (
            <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-900/50">
              <button
                type="button"
                className={`flex w-full items-center justify-between px-3 py-2 text-sm ${isActive ? 'text-sky-300' : 'text-slate-200'}`}
                onClick={() => toggleGroup(item.id)}
              >
                <span>{item.label}</span>
                <span className="text-xs text-slate-400">{isOpen ? '−' : '+'}</span>
              </button>
              {isOpen && (
                <div className="space-y-1 border-t border-slate-800 p-2">
                  {item.children.map((child) => (
                    <SidebarLink key={child.id} to={child.to} label={child.label} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto pt-3">
        <button
          type="button"
          className={`w-full rounded-lg border px-3 py-2 text-sm transition ${
            isTestMode
              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
              : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800'
          } disabled:opacity-60`}
          onClick={() => { void toggleTestMode(); }}
          disabled={toggleBusy}
          title={isTestMode ? 'Test mode is ON' : 'Test mode is OFF'}
        >
          {toggleBusy ? 'Switching...' : `Test Mode: ${isTestMode ? 'ON' : 'OFF'}`}
        </button>
        {toggleError && (
          <div className="mt-1 text-xs text-rose-300">{toggleError}</div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto grid min-h-screen max-w-[1900px] grid-cols-1 gap-4 p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 shadow-glow lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
            <div className="mb-3 text-sm font-semibold text-slate-100">PKM UI</div>
            <SidebarNav />
          </aside>

          <main className="min-w-0">
            <Routes>
              <Route path="/" element={<Navigate to="/read" replace />} />
              <Route path="/read" element={<ReadPage />} />
              <Route path="/debug" element={<DebugPage />} />
              <Route path="/debug/run/:runId" element={<DebugPage />} />
              <Route path="*" element={<Navigate to="/read" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
