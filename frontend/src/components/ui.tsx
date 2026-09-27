import { useEffect, type ReactNode, type ButtonHTMLAttributes } from "react";
import { Link } from "react-router";
import {
  AlertCircle, AlertTriangle, CheckCircle2, Info, X, Loader2, Inbox,
  Briefcase, HandHeart, Coins, House, Zap, Wifi, ShoppingCart, Utensils, Fuel, TrainFront, Shield,
  HeartPulse, Repeat, ShoppingBag, Plane, Landmark, Banknote, GraduationCap, Wallet, PiggyBank,
  ArrowLeftRight, Tag, CircleHelp, type LucideIcon,
} from "lucide-react";
import type { Alert } from "../lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ── Icônes de catégories ────────────────────────────────────────────────────
const ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase, "hand-heart": HandHeart, coins: Coins, home: House, zap: Zap, wifi: Wifi,
  "shopping-cart": ShoppingCart, utensils: Utensils, fuel: Fuel, "train-front": TrainFront, shield: Shield,
  "heart-pulse": HeartPulse, repeat: Repeat, "shopping-bag": ShoppingBag, plane: Plane, landmark: Landmark,
  banknote: Banknote, "graduation-cap": GraduationCap, wallet: Wallet, "piggy-bank": PiggyBank,
  "arrow-left-right": ArrowLeftRight, tag: Tag, "circle-help": CircleHelp,
};
export const ICON_NAMES = Object.keys(ICONS);

export function CategoryIcon({ icon, color, size = 32 }: { icon?: string; color?: string; size?: number }) {
  const Icon = ICONS[icon ?? "tag"] ?? Tag;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color ?? "#898781"} 16%, transparent)` }}
    >
      <Icon size={size * 0.5} style={{ color: color ?? "#898781" }} strokeWidth={2} />
    </span>
  );
}

// ── Mise en page ────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, className, pad = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("card fade-in", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? "p-5 pt-3" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone, icon: Icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "critical" | "accent"; icon?: LucideIcon }) {
  return (
    <div className="card fade-in min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        {Icon && <Icon size={16} className="shrink-0 text-muted" />}
        {label}
      </div>
      <div className={cx("mt-2 text-[21px] font-semibold leading-tight tracking-tight break-words sm:text-[26px]", tone === "critical" && "text-critical-ink", tone === "good" && "text-good-ink")}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

// ── Boutons & champs ────────────────────────────────────────────────────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "soft"; size?: "sm" | "md"; icon?: LucideIcon; loading?: boolean };

export function Button({ variant = "soft", size = "md", icon: Icon, loading, className, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-accent text-white hover:brightness-110",
        variant === "soft" && "border border-line-strong bg-surface text-ink hover:bg-surface-2",
        variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "bg-critical text-white hover:brightness-110",
        className,
      )}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, onClick, tone }: { icon: LucideIcon; label: string; onClick?: () => void; tone?: "danger" }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cx("inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2", tone === "danger" ? "hover:text-critical-ink" : "hover:text-ink")}
    >
      <Icon size={16} />
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm select-none">
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), onChange(!checked))}
        onClick={() => onChange(!checked)}
        className={cx("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-surface-3")}
      >
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
      </span>
      {label}
    </label>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "critical" | "accent" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "bg-surface-2 text-ink-2",
        tone === "good" && "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good-ink",
        tone === "warning" && "bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-ink",
        tone === "critical" && "bg-[color-mix(in_srgb,var(--critical)_14%,transparent)] text-critical-ink",
        tone === "accent" && "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent-ink",
      )}
    >
      {children}
    </span>
  );
}

/** Jauge : le remplissage porte la sévérité, la piste est un ton clair de la même rampe. */
export function Meter({ value, max, color, severity = true, height = 8 }: { value: number; max: number; color?: string; severity?: boolean; height?: number }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const over = max > 0 && value > max;
  const near = max > 0 && value / max >= 0.85;
  const fill = color ?? (severity ? (over ? "var(--critical)" : near ? "var(--warning)" : "var(--accent)") : "var(--accent)");
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: `color-mix(in srgb, ${fill} 18%, transparent)` }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${ratio * 100}%`, background: fill }} />
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx("card fade-in flex max-h-[92vh] w-full flex-col rounded-b-none sm:rounded-2xl", wide ? "sm:max-w-4xl" : "sm:max-w-xl")}>
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton icon={X} label="Fermer" onClick={onClose} />
        </header>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Empty({ title, children, icon: Icon = Inbox }: { title: string; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-muted">
        <Icon size={22} />
      </span>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-20 text-muted">
      <Loader2 className="animate-spin" size={22} />
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--critical)_30%,transparent)] bg-[color-mix(in_srgb,var(--critical)_8%,transparent)] px-4 py-3 text-sm text-critical-ink">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

const ALERT_META = {
  critical: { icon: AlertCircle, color: "var(--critical)", label: "Critique" },
  serious: { icon: AlertTriangle, color: "var(--serious)", label: "Important" },
  warning: { icon: AlertTriangle, color: "var(--warning)", label: "Attention" },
  info: { icon: Info, color: "var(--accent)", label: "Info" },
  good: { icon: CheckCircle2, color: "var(--good)", label: "Bonne nouvelle" },
} as const;

export function AlertRow({ alert }: { alert: Alert }) {
  const m = ALERT_META[alert.level];
  return (
    <Link to={alert.link} className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-2">
      <m.icon size={18} style={{ color: m.color }} className="mt-0.5 shrink-0" aria-label={m.label} />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{alert.title}</span>
        {alert.detail && <span className="block truncate text-xs text-ink-2">{alert.detail}</span>}
      </span>
    </Link>
  );
}

export function Amount({ value, currency = "EUR", className, colored = true }: { value: number; currency?: string; className?: string; colored?: boolean }) {
  const s = new Intl.NumberFormat("fr-FR", { style: "currency", currency, signDisplay: "exceptZero" }).format(value);
  return <span className={cx("num whitespace-nowrap", colored && value > 0 && "text-good-ink", className)}>{s}</span>;
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-[10px] bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx("rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors", value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
