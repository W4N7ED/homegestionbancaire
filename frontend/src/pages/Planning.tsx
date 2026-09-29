import { useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { api, qs, useApi } from "../lib/api";
import { FREQUENCIES, RECURRING_KINDS, eur, fdate, pct, relDays } from "../lib/format";
import type { FixedItem, Forecast, ResteAVivre, ScheduledItem, Undeclared } from "../lib/types";
import { BalanceChart } from "../components/Charts";
import { Amount, Badge, Button, Card, ErrorBox, Loading, Meter, PageHeader, Segmented, Stat, Toggle, cx } from "../components/ui";
import { UpcomingList } from "./Dashboard";

// ── Reste à vivre ─────────────────────────────────────────────────────────────
const GROUPS: { key: FixedItem["group"]; label: string; link: string }[] = [
  { key: "housing", label: "Logement (loyer, prêt immobilier, charges)", link: "/recurrents" },
  { key: "loans", label: "Crédits (assurance incluse)", link: "/credits" },
  { key: "debits", label: "Prélèvements & virements permanents", link: "/recurrents" },
  { key: "contracts", label: "Contrats & abonnements", link: "/contrats" },
];

const SOURCE_LINK = { recurring: "/recurrents", contract: "/contrats", loan: "/credits" } as const;

export function ResteAVivrePage() {
  const { data, error, reload } = useApi<ResteAVivre>("/api/reste-a-vivre");
  const [open, setOpen] = useState<Record<string, boolean>>({ housing: true, loans: true, debits: true, contracts: true });
  const [adding, setAdding] = useState<string | null>(null);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const b = data.breakdown;
  const items = data.items ?? [];
  const incomes = items.filter((i) => i.group === "income");
  const undeclared = data.undeclared ?? [];
  const ratio = data.debt_ratio ?? 0;

  const addUndeclared = async (u: Undeclared) => {
    setAdding(u.key);
    try {
      const created = await api.post<{ id: number }>("/api/recurring", {
        name: u.name, kind: u.kind, amount: u.median_amount, frequency: u.frequency, start_date: u.start_date,
        account_id: u.account_id, category_id: u.category_id, match_pattern: u.match_pattern, active: true,
      });
      await api.post(`/api/recurring/${created.id}/link`);
      await reload();
    } finally {
      setAdding(null);
    }
  };

  return (
    <div>
      <PageHeader title="Reste à vivre" subtitle="Revenus − loyer − crédits − prélèvements − abonnements : ce qu'il reste pour vivre chaque mois." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Stat label="Reste à vivre mensuel" value={eur(data.reste_a_vivre)} hint={`${eur(data.per_day)} par jour en moyenne`} tone={data.reste_a_vivre < 0 ? "critical" : undefined} />
        <Stat label="Après épargne programmée" value={eur(data.reste_a_vivre_after_savings)} hint={`${eur(b.savings)} épargnés chaque mois`} />
        <Stat label={`Jusqu'au ${fdate(data.current.horizon)}`} value={eur(data.current.available)} hint={`${eur(data.current.per_day)}/jour pendant ${data.current.days_left} j (${data.current.horizon_reason})`} tone={data.current.available < 0 ? "critical" : undefined} />
      </div>

      {undeclared.length > 0 && (
        <Card
          className="mt-5"
          title={<span className="flex items-center gap-2"><AlertTriangle size={16} className="text-[var(--warning)]" />Prélèvements détectés sur vos comptes mais pas encore comptés</span>}
          action={<span className="text-sm text-ink-2">−{eur(data.undeclared_monthly ?? 0)}/mois → reste à vivre <span className="num font-semibold text-ink">{eur(data.reste_a_vivre_if_undeclared ?? data.reste_a_vivre)}</span></span>}
        >
          <ul className="divide-y divide-line">
            {undeclared.map((u) => (
              <li key={u.key} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{u.name} <span className="text-xs font-normal text-muted">« {u.sample_label} »</span></div>
                  <div className="text-xs text-muted">{FREQUENCIES[u.frequency]} · {u.occurrences} fois · dernier le {fdate(u.last_date)}{u.variable && " · montant variable"}</div>
                </div>
                <span className="num text-sm">−{eur(u.median_amount)}{u.frequency !== "monthly" && <span className="text-muted"> ({eur(u.monthly)}/mois)</span>}</span>
                <Button size="sm" icon={Plus} loading={adding === u.key} onClick={() => addUndeclared(u)}>Compter</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Détail du calcul (montants ramenés au mois)" pad={false}>
          <div className="px-5 pb-4">
            <div className="flex items-center justify-between border-b border-line py-3">
              <div>
                <div className="font-medium">Revenus</div>
                <div className="text-xs text-muted">{incomes.length ? incomes.map((i) => i.name).join(", ") : data.income_source}</div>
              </div>
              <span className="num font-semibold text-good-ink">+{eur(data.income_monthly)}</span>
            </div>
            {GROUPS.map((g) => {
              const rows = items.filter((i) => i.group === g.key);
              const sum = rows.reduce((s, i) => s + i.monthly, 0);
              const isOpen = open[g.key];
              return (
                <div key={g.key} className="border-b border-line">
                  <button type="button" onClick={() => setOpen({ ...open, [g.key]: !isOpen })} className="flex w-full items-center justify-between gap-3 py-3 text-left">
                    <span className="flex items-center gap-2 font-medium">
                      <ChevronRight size={15} className={cx("text-muted transition-transform", isOpen && "rotate-90")} />
                      {g.label}
                      <span className="text-xs font-normal text-muted">{rows.length}</span>
                    </span>
                    <span className="num font-semibold">{sum ? `−${eur(sum)}` : eur(0)}</span>
                  </button>
                  {isOpen && (
                    rows.length === 0 ? (
                      <div className="pb-3 pl-6 text-sm text-muted">
                        Rien de déclaré. <Link to={g.link} className="text-accent-ink hover:underline">Ajouter</Link>
                        {g.key === "housing" && " votre loyer (nature « Virement permanent » ou « Prélèvement »)."}
                      </div>
                    ) : (
                      <ul className="pb-2">
                        {rows.map((i) => (
                          <li key={`${i.source}-${i.id}`}>
                            <Link to={SOURCE_LINK[i.source]} className="flex items-center justify-between gap-3 rounded-lg py-1.5 pr-1 pl-6 text-sm hover:bg-surface-2">
                              <span className="min-w-0 truncate">
                                {i.name}
                                <span className="ml-2 text-xs text-muted">{i.frequency !== "monthly" ? `${eur(i.amount)} ${FREQUENCIES[i.frequency].toLowerCase()}` : RECURRING_KINDS[i.kind] ?? (i.source === "loan" ? "crédit" : "contrat")}</span>
                              </span>
                              <span className="num shrink-0 text-ink-2">−{eur(i.monthly)}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
              );
            })}
            <div className="flex items-center justify-between py-3">
              <span className="font-semibold">Reste à vivre</span>
              <span className={cx("num text-lg font-semibold", data.reste_a_vivre < 0 && "text-critical-ink")}>{eur(data.reste_a_vivre)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
              <span>Épargne programmée ({items.filter((i) => i.group === "savings").map((i) => i.name).join(", ") || "aucune"})</span>
              <span className="num">−{eur(b.savings)}</span>
            </div>
          </div>
        </Card>

        <Card title="Indicateurs d'endettement">
          <div className="space-y-6">
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span>Taux d'endettement (crédits / revenus)</span>
                <span className="num font-semibold">{pct(data.debt_ratio, 1)}</span>
              </div>
              <Meter value={ratio} max={0.35} />
              <p className="mt-2 text-xs text-muted">Recommandation HCSF : 35 % maximum, assurance comprise. {ratio > 0.35 ? <Badge tone="critical">Au-dessus du seuil</Badge> : <Badge tone="good">Sous le seuil</Badge>}</p>
            </div>
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span>Poids des charges fixes</span>
                <span className="num font-semibold">{pct(data.charges_ratio, 1)}</span>
              </div>
              <Meter value={data.charges_ratio ?? 0} max={1} severity={false} color="var(--s2)" />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-surface-2 p-3">
                <div className="text-xs text-muted">Encaissé ce mois</div>
                <div className="num font-semibold">{eur(data.current.month_income)}</div>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <div className="text-xs text-muted">Dépensé ce mois</div>
                <div className="num font-semibold">{eur(data.current.month_spent)}</div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card title={`Échéances restant à payer d'ici le ${fdate(data.current.horizon)}`} className="mt-5">
        <UpcomingList items={data.current.remaining_items} limit={50} />
      </Card>
    </div>
  );
}

// ── Prévisionnel ──────────────────────────────────────────────────────────────
export function ForecastPage() {
  const [days, setDays] = useState<"30" | "90" | "180" | "365">("90");
  const [variable, setVariable] = useState(true);
  const { data: fc, error } = useApi<Forecast>(`/api/forecast${qs({ days, variable })}`);
  const { data: history } = useApi<{ date: string; balance: number }[]>("/api/history?days=60");
  const { data: items } = useApi<ScheduledItem[]>(`/api/calendar${qs({ date_from: new Date().toISOString().slice(0, 10), date_to: new Date(Date.now() + Number(days) * 86400000).toISOString().slice(0, 10) })}`);
  if (error) return <ErrorBox message={error} />;
  return (
    <div>
      <PageHeader
        title="Prévisionnel"
        subtitle="Projection du solde des comptes courants à partir des échéances connues."
        actions={
          <>
            <Toggle checked={variable} onChange={setVariable} label="Inclure les dépenses courantes" />
            <Segmented value={days} onChange={setDays} options={[{ value: "30", label: "30 j" }, { value: "90", label: "3 mois" }, { value: "180", label: "6 mois" }, { value: "365", label: "1 an" }]} />
          </>
        }
      />
      {!fc ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            <Stat label="Solde actuel" value={eur(fc.start_balance)} />
            <Stat label={`Solde dans ${days} jours`} value={eur(fc.end_balance)} tone={fc.end_balance < 0 ? "critical" : undefined} />
            <Stat label="Point bas" value={eur(fc.lowest.balance)} hint={fdate(fc.lowest.date, "long")} tone={fc.lowest.balance < 0 ? "critical" : undefined} />
            <Stat label="Dépenses courantes estimées" value={`${eur(fc.daily_variable)}/j`} hint="Moyenne 90 j hors charges fixes" />
          </div>
          <Card title="Courbe prévisionnelle" className="mt-5">
            <BalanceChart history={history ?? []} forecast={fc.series} height={320} />
          </Card>
        </>
      )}
      <Card title="Mouvements prévus" className="mt-5">
        {items && (
          <table className="table">
            <thead><tr><th>Date</th><th>Libellé</th><th className="hidden sm:table-cell">Origine</th><th className="text-right">Montant</th></tr></thead>
            <tbody>
              {items.map((i, n) => (
                <tr key={n}>
                  <td className="whitespace-nowrap">{fdate(i.date)} <span className="text-xs text-muted">{relDays(i.date)}</span></td>
                  <td>{i.name}</td>
                  <td className="hidden text-ink-2 sm:table-cell">{{ recurring: "Récurrent", contract: "Contrat", loan: "Crédit" }[i.source]}</td>
                  <td className="text-right"><Amount value={i.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ── Échéancier (calendrier) ──────────────────────────────────────────────────
function iso(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const first = cursor;
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const { data, error } = useApi<ScheduledItem[]>(`/api/calendar${qs({ date_from: iso(first), date_to: iso(last) })}`);

  const byDay = useMemo(() => {
    const m = new Map<string, ScheduledItem[]>();
    for (const i of data ?? []) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return m;
  }, [data]);
  const cells: (Date | null)[] = [];
  const offset = (first.getDay() + 6) % 7;
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
  while (cells.length % 7) cells.push(null);
  const totalIn = (data ?? []).filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const totalOut = (data ?? []).filter((i) => i.amount < 0).reduce((s, i) => s + i.amount, 0);
  const todayIso = iso(new Date());

  return (
    <div>
      <PageHeader
        title="Échéancier"
        subtitle={<>Entrées prévues <span className="num font-medium text-good-ink">{eur(totalIn)}</span> · sorties prévues <span className="num font-medium text-ink">{eur(totalOut)}</span></>}
        actions={
          <div className="flex items-center gap-1">
            <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Mois précédent"><ChevronLeft size={18} /></button>
            <span className="min-w-[150px] text-center font-medium capitalize">{fdate(cursor, "month")}</span>
            <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Mois suivant"><ChevronRight size={18} /></button>
          </div>
        }
      />
      {error && <ErrorBox message={error} />}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line text-center text-xs font-medium text-muted">
          {["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const items = d ? byDay.get(iso(d)) ?? [] : [];
            const isToday = d && iso(d) === todayIso;
            return (
              <div key={i} className={cx("min-h-[92px] border-b border-r border-line p-1.5 sm:min-h-[112px]", !d && "bg-surface-2/40", i % 7 === 6 && "border-r-0")}>
                {d && (
                  <>
                    <div className={cx("mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs", isToday ? "bg-accent font-semibold text-white" : "text-ink-2")}>{d.getDate()}</div>
                    <div className="space-y-1">
                      {items.slice(0, 3).map((it, n) => (
                        <div key={n} title={`${it.name} ${eur(it.amount)}`} className={cx("truncate rounded-md px-1.5 py-0.5 text-[11px] leading-tight", it.amount > 0 ? "bg-[color-mix(in_srgb,var(--s1)_14%,transparent)] text-accent-ink" : "bg-surface-2 text-ink")}>
                          <span className="hidden sm:inline">{it.name} · </span><span className="num font-medium">{Math.round(it.amount)} €</span>
                        </div>
                      ))}
                      {items.length > 3 && <div className="px-1.5 text-[11px] text-muted">+{items.length - 3}</div>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
