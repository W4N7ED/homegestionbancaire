import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import {
  LayoutDashboard, Scale, TrendingUp, CalendarDays, Wallet, ArrowLeftRight, Landmark, Gauge, Repeat, FileSignature,
  Banknote, Receipt, Fuel, FolderLock, Calculator, Target, Settings, LogOut, Sun, Moon, Monitor, Menu, X, RefreshCw,
} from "lucide-react";
import { api } from "../lib/api";
import { cx } from "./ui";

const NAV: { title: string; items: { to: string; label: string; icon: typeof Wallet }[] }[] = [
  {
    title: "Vue d'ensemble",
    items: [
      { to: "/", label: "Tableau de bord", icon: LayoutDashboard },
      { to: "/reste-a-vivre", label: "Reste à vivre", icon: Scale },
      { to: "/previsionnel", label: "Prévisionnel", icon: TrendingUp },
      { to: "/echeancier", label: "Échéancier", icon: CalendarDays },
    ],
  },
  {
    title: "Comptes",
    items: [
      { to: "/comptes", label: "Comptes", icon: Wallet },
      { to: "/operations", label: "Opérations", icon: ArrowLeftRight },
      { to: "/budgets", label: "Budgets", icon: Gauge },
      { to: "/banques", label: "Connexions bancaires", icon: Landmark },
    ],
  },
  {
    title: "Engagements",
    items: [
      { to: "/recurrents", label: "Revenus & prélèvements", icon: Repeat },
      { to: "/contrats", label: "Contrats & abonnements", icon: FileSignature },
      { to: "/credits", label: "Crédits", icon: Banknote },
      { to: "/objectifs", label: "Objectifs d'épargne", icon: Target },
    ],
  },
  {
    title: "Dossiers",
    items: [
      { to: "/paie", label: "Fiches de paie", icon: Receipt },
      { to: "/carburant", label: "Carburant", icon: Fuel },
      { to: "/documents", label: "Coffre-fort", icon: FolderLock },
      { to: "/impots", label: "Impôts", icon: Calculator },
    ],
  },
];

type Theme = "system" | "light" | "dark";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("pactole-theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem("pactole-theme", theme);
    } catch {
      /* stockage indisponible */
    }
  }, [theme]);
  const cycle = () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  return [theme, cycle];
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <ellipse cx="32" cy="22" rx="16" ry="6" fill="#fff" />
      <path d="M16 22v10c0 3.3 7.2 6 16 6s16-2.7 16-6V22" fill="none" stroke="#fff" strokeWidth="4" />
      <path d="M16 32v10c0 3.3 7.2 6 16 6s16-2.7 16-6V32" fill="none" stroke="#fff" strokeWidth="4" opacity=".7" />
    </svg>
  );
}

export function Layout({ children, username, onLogout }: { children: ReactNode; username: string; onLogout: () => void }) {
  const [theme, cycleTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const sync = async () => {
    setSyncing(true);
    try {
      await api.post("/api/banking/sync");
      window.location.reload();
    } finally {
      setSyncing(false);
    }
  };

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
        <Logo />
        <span className="text-lg font-semibold tracking-tight">Pactole</span>
      </div>
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => (
          <div key={g.title}>
            <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">{g.title}</div>
            {g.items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === "/"}
                className={({ isActive }) =>
                  cx(
                    "flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors",
                    isActive ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2/60 hover:text-ink",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <i.icon size={17} className={isActive ? "text-accent" : "text-muted"} />
                    {i.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <NavLink to="/parametres" className={({ isActive }) => cx("flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm", isActive ? "bg-surface-2 font-medium" : "text-ink-2 hover:bg-surface-2/60")}>
          <Settings size={17} className="text-muted" /> Paramètres
        </NavLink>
        <div className="mt-2 flex items-center justify-between px-3">
          <span className="truncate text-xs text-muted">Connecté : {username}</span>
          <div className="flex gap-1">
            <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" onClick={cycleTheme} title={`Thème : ${theme === "system" ? "système" : theme === "light" ? "clair" : "sombre"}`}>
              <ThemeIcon size={16} />
            </button>
            <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" onClick={onLogout} title="Se déconnecter">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 max-w-[85vw] bg-surface" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-page/85 px-4 backdrop-blur lg:px-8">
        <div className="flex items-center gap-2 lg:hidden">
          <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Logo size={24} />
          <span className="font-semibold">Pactole</span>
        </div>
        <div className="hidden text-sm text-muted lg:block">
          {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </div>
        <button onClick={sync} disabled={syncing} className="inline-flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50">
          <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Synchroniser</span>
        </button>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
