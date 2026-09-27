import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, AlertTriangle, CalendarPlus, CheckCircle2, Plus, Star, X } from "lucide-react";
import { api } from "../lib/api";
import { eur, fdate, pct, todayISO } from "../lib/format";
import { ScenarioChart } from "../components/Charts";
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, Toggle, cx } from "../components/ui";

interface Row { n: number; date: string; amount: number; interest: number; fees: number }
interface ScenarioResult {
  label: string; count: number; rate: number; fees_pct: number; first_date: string; last_date: string;
  installment: number; first_installment: number; total_paid: number; extra_cost: number;
  reste_a_vivre_after: number; debt_ratio_after: number | null;
  lowest: { date: string; balance: number }; first_negative: string | null; end_balance: number;
  verdict: "ok" | "tight" | "risky"; warnings: { level: string; text: string }[];
  schedule: Row[]; series: { date: string; balance: number }[];
}
interface SimResult {
  amount: number; down_payment: number; financed: number; purchase_date: string; income_monthly: number;
  reste_a_vivre: number; debt_ratio: number | null; available_now: number;
  baseline: { series: { date: string; balance: number }[]; lowest: { date: string; balance: number }; first_negative: string | null };
  scenarios: ScenarioResult[]; recommended: string | null;
}
interface Plan { key: string; count: number; rate: string; fees: string; on: boolean }

const PRESETS: Plan[] = [
  { key: "1", count: 1, rate: "0", fees: "0", on: true },
  { key: "3", count: 3, rate: "0", fees: "0", on: false },
  { key: "4", count: 4, rate: "0", fees: "0", on: true },
  { key: "10", count: 10, rate: "0", fees: "0", on: false },
  { key: "12", count: 12, rate: "5.9", fees: "0", on: true },
  { key: "24", count: 24, rate: "5.9", fees: "0", on: true },
  { key: "36", count: 36, rate: "6.5", fees: "0", on: false },
];

const VERDICT = {
  ok: { label: "Supportable", tone: "good" as const, icon: CheckCircle2 },
  tight: { label: "Tendu", tone: "warning" as const, icon: AlertTriangle },
  risky: { label: "Risqué", tone: "critical" as const, icon: AlertCircle },
};

const planLabel = (count: number) => (count === 1 ? "Comptant" : `${count} fois`);
const num = (s: string) => Number(String(s).replace(",", ".")) || 0;

export function SimulatorPage() {
  const navigate = useNavigate();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("1200");
  const [date, setDate] = useState(todayISO());
  const [down, setDown] = useState("0");
  const [variable, setVariable] = useState(true);
  const [plans, setPlans] = useState<Plan[]>(PRESETS);
  const [custom, setCustom] = useState("");
  const [result, setResult] = useState<SimResult | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const active = plans.filter((p) => p.on);
  const payload = useMemo(
    () => ({
      amount: num(amount),
      purchase_date: date,
      down_payment: num(down),
      include_variable: variable,
      scenarios: active.map((p) => ({ count: p.count, rate: p.count > 1 ? num(p.rate) : 0, fees_pct: p.count > 1 ? num(p.fees) : 0, label: planLabel(p.count) })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [amount, date, down, variable, JSON.stringify(active)],
  );

  useEffect(() => {
    if (payload.amount <= 0 || payload.scenarios.length === 0) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.post<SimResult>("/api/simulate/purchase", payload);
        setResult(r);
        setError(null);
        setFocus((f) => (f && r.scenarios.some((s) => s.label === f) ? f : r.recommended ?? r.scenarios[0]?.label ?? null));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [payload]);

  const update = (key: string, patch: Partial<Plan>) => setPlans((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const addCustom = () => {
    const n = Math.round(num(custom));
    if (n < 2 || n > 120 || plans.some((p) => p.count === n)) return;
    setPlans((ps) => [...ps, { key: String(n), count: n, rate: n > 4 ? "5.9" : "0", fees: "0", on: true }].sort((a, b) => a.count - b.count));
    setCustom("");
  };

  const current = result?.scenarios.find((s) => s.label === focus) ?? null;

  const plan = async (s: ScenarioResult) => {
    const name = `${label || "Achat"} (${s.label.toLowerCase()})`;
    if (s.count === 1) {
      await api.post("/api/recurring", { name, kind: "expense", amount: result!.financed, frequency: "monthly", start_date: s.first_date, end_date: s.first_date, active: true, notes: "Achat planifié depuis le simulateur" });
    } else {
      await api.post("/api/loans", {
        name, lender: "", type: s.count <= 4 ? "autre" : "consommation", principal: result!.financed, rate: s.rate,
        duration_months: s.count, start_date: s.first_date, monthly_payment: s.installment, insurance_monthly: 0,
        notes: `Planifié depuis le simulateur${s.fees_pct ? ` — frais ${s.fees_pct} % sur la 1re échéance` : ""}`,
      });
    }
    if (result!.down_payment > 0) {
      await api.post("/api/recurring", { name: `${label || "Achat"} (apport)`, kind: "expense", amount: result!.down_payment, frequency: "monthly", start_date: result!.purchase_date, end_date: result!.purchase_date, active: true });
    }
    setSaved(name);
  };

  return (
    <div>
      <PageHeader title="Simulateur d'achat" subtitle="Comptant, en 3 ou 4 fois, ou à crédit sur 12, 24 mois… : voyez l'effet sur votre solde et votre reste à vivre avant d'acheter." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_1fr]">
        {/* ── Paramètres ─────────────────────────────── */}
        <Card title="L'achat" className="self-start">
          <div className="space-y-4">
            <Field label="Quoi ?"><input className="input" placeholder="ex. Télévision, canapé, ordinateur…" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Montant (€)"><input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Apport (€)"><input className="input num" inputMode="decimal" value={down} onChange={(e) => setDown(e.target.value)} /></Field>
            </div>
            <Field label="Date d'achat"><input className="input num" type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>

            <div>
              <div className="mb-1.5 text-[13px] font-medium text-ink-2">Modes de paiement à comparer</div>
              <div className="flex flex-wrap gap-1.5">
                {plans.map((p) => (
                  <button key={p.key} type="button" onClick={() => update(p.key, { on: !p.on })}
                    className={cx("rounded-full border px-3 py-1 text-[13px] transition-colors", p.on ? "border-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] font-medium text-accent-ink" : "border-line-strong text-ink-2 hover:bg-surface-2")}>
                    {planLabel(p.count)}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input className="input num h-8 text-[13px]" placeholder="Autre : nb de mensualités" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && addCustom()} />
                <Button size="sm" icon={Plus} onClick={addCustom}>Ajouter</Button>
              </div>
            </div>

            {active.some((p) => p.count > 1) && (
              <div>
                <div className="mb-1.5 text-[13px] font-medium text-ink-2">Conditions</div>
                <table className="table text-[13px]">
                  <thead><tr><th className="!px-1">Mode</th><th className="!px-1">TAEG %</th><th className="!px-1">Frais %</th><th /></tr></thead>
                  <tbody>
                    {active.filter((p) => p.count > 1).map((p) => (
                      <tr key={p.key}>
                        <td className="!px-1 font-medium">{planLabel(p.count)}</td>
                        <td className="!px-1"><input className="input num h-8 w-20 text-[13px]" inputMode="decimal" value={p.rate} onChange={(e) => update(p.key, { rate: e.target.value })} aria-label={`TAEG ${planLabel(p.count)}`} /></td>
                        <td className="!px-1"><input className="input num h-8 w-20 text-[13px]" inputMode="decimal" value={p.fees} onChange={(e) => update(p.key, { fees: e.target.value })} aria-label={`Frais ${planLabel(p.count)}`} /></td>
                        <td className="!px-1">{!PRESETS.some((x) => x.key === p.key) && <button className="text-muted hover:text-ink" onClick={() => setPlans((ps) => ps.filter((x) => x.key !== p.key))} aria-label="Retirer"><X size={14} /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">3x/4x : souvent sans intérêts mais avec des frais (≈ 1 à 3 % du montant). Crédit : TAEG indiqué sur l'offre ; 1re échéance le mois suivant l'achat.</p>
              </div>
            )}
            <Toggle checked={variable} onChange={setVariable} label="Inclure mes dépenses courantes" />
          </div>
        </Card>

        {/* ── Résultats ──────────────────────────────── */}
        <div className="min-w-0 space-y-5">
          {error && <ErrorBox message={error} />}
          {saved && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-[color-mix(in_srgb,var(--good)_12%,transparent)] px-4 py-3 text-sm text-good-ink">
              <span className="flex items-center gap-2"><CheckCircle2 size={16} />« {saved} » ajouté à vos échéances.</span>
              <button className="font-medium underline" onClick={() => navigate("/echeancier")}>Voir l'échéancier</button>
            </div>
          )}
          {!result ? (loading ? <Loading /> : <Card><Empty title="Indiquez un montant et au moins un mode de paiement" /></Card>) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ["Disponible jusqu'à la paie", eur(result.available_now)],
                  ["Reste à vivre mensuel", eur(result.reste_a_vivre, { decimals: false })],
                  ["Endettement actuel", pct(result.debt_ratio, 1)],
                  ["Point bas sans l'achat", eur(result.baseline.lowest.balance, { decimals: false })],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-surface-2 px-4 py-3"><div className="text-xs text-muted">{k}</div><div className="num font-semibold">{v}</div></div>
                ))}
              </div>

              <div className={cx("grid grid-cols-1 gap-3 sm:grid-cols-2", result.scenarios.length > 2 && "2xl:grid-cols-4", result.scenarios.length === 3 && "2xl:grid-cols-3")}>
                {result.scenarios.map((s) => {
                  const v = VERDICT[s.verdict];
                  const selected = s.label === focus;
                  return (
                    <button key={s.label} type="button" onClick={() => setFocus(s.label)}
                      className={cx("card fade-in flex flex-col p-4 text-left transition-colors", selected ? "!border-accent ring-2 ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]" : "hover:border-line-strong")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{s.label}</span>
                        <span className="flex items-center gap-1">
                          {result.recommended === s.label && <Badge tone="accent"><Star size={11} />Conseillé</Badge>}
                          <Badge tone={v.tone}><v.icon size={11} />{v.label}</Badge>
                        </span>
                      </div>
                      <div className="mt-3 text-2xl font-semibold tracking-tight">
                        {eur(s.installment)}{s.count > 1 && <span className="text-sm font-normal text-muted"> /mois</span>}
                      </div>
                      <div className="text-xs text-muted">
                        {s.count > 1 ? <>du {fdate(s.first_date)} au {fdate(s.last_date)}{s.first_installment !== s.installment && <> · 1re : {eur(s.first_installment)}</>}</> : <>le {fdate(s.first_date)}</>}
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                        <dt className="text-ink-2">Coût total</dt><dd className="num text-right">{eur(s.total_paid)}</dd>
                        <dt className="text-ink-2">Surcoût</dt><dd className={cx("num text-right", s.extra_cost > 0 && "font-medium text-critical-ink")}>{s.extra_cost > 0 ? `+${eur(s.extra_cost)}` : "0 €"}</dd>
                        <dt className="text-ink-2">Reste à vivre</dt><dd className="num text-right">{eur(s.reste_a_vivre_after, { decimals: false })}</dd>
                        <dt className="text-ink-2">Endettement</dt><dd className="num text-right">{s.count > 1 ? pct(s.debt_ratio_after, 1) : "—"}</dd>
                        <dt className="text-ink-2">Point bas</dt><dd className={cx("num text-right", s.lowest.balance < 0 && "font-medium text-critical-ink")}>{eur(s.lowest.balance, { decimals: false })}</dd>
                      </dl>
                      {s.warnings.length > 0 && (
                        <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
                          {s.warnings.map((w) => (
                            <li key={w.text} className={cx("flex items-start gap-1.5", w.level === "critical" ? "text-critical-ink" : "text-ink-2")}>
                              {w.level === "critical" ? <AlertCircle size={13} className="mt-px shrink-0" /> : <AlertTriangle size={13} className="mt-px shrink-0" />}{w.text}
                            </li>
                          ))}
                        </ul>
                      )}
                    </button>
                  );
                })}
              </div>

              {current && (
                <>
                  <Card title={`Solde prévu — ${current.label}`} action={<Button size="sm" variant="primary" icon={CalendarPlus} onClick={() => plan(current)}>Planifier cet achat</Button>}>
                    <ScenarioChart baseline={result.baseline.series} scenario={current.series} label={current.label} />
                    <p className="mt-2 text-xs text-muted">
                      Projection des comptes courants à partir de vos revenus, prélèvements, abonnements et crédits connus{variable ? ", et de vos dépenses courantes moyennes" : ""}.
                      {current.first_negative && <span className="font-medium text-critical-ink"> Découvert à partir du {fdate(current.first_negative)}.</span>}
                    </p>
                  </Card>
                  {current.schedule.length > 1 && (
                    <Card title="Échéancier du paiement" pad={false}>
                      <div className="scroll-thin max-h-[360px] overflow-auto">
                        <table className="table">
                          <thead className="sticky top-0 bg-surface"><tr><th>#</th><th>Date</th><th className="text-right">Intérêts</th><th className="text-right">Frais</th><th className="text-right">Montant</th></tr></thead>
                          <tbody>
                            {current.schedule.map((r) => (
                              <tr key={r.n}><td className="num">{r.n}</td><td className="num">{fdate(r.date)}</td><td className="num text-right text-ink-2">{eur(r.interest)}</td><td className="num text-right text-ink-2">{r.fees ? eur(r.fees) : "—"}</td><td className="num text-right font-medium">{eur(r.amount)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
