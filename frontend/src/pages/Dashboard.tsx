import { Link } from "react-router";
import { ArrowRight, Banknote, CalendarClock, Landmark, PiggyBank, Repeat, Sparkles, Wallet } from "lucide-react";
import { api, useApi } from "../lib/api";
import { ACCOUNT_TYPES, eur, fdate, pct, relDays } from "../lib/format";
import type { Dashboard as D, ScheduledItem } from "../lib/types";
import { BalanceChart, MonthlyBars } from "../components/Charts";
import { AlertRow, Amount, Badge, Card, CategoryIcon, Empty, ErrorBox, Loading, Meter, Stat, cx } from "../components/ui";

const SOURCE_LABEL: Record<string, string> = { recurring: "Récurrent", contract: "Abonnement", loan: "Crédit" };

export function UpcomingList({ items, limit = 8 }: { items: ScheduledItem[]; limit?: number }) {
  if (!items.length) return <Empty title="Rien de prévu" icon={CalendarClock}>Aucune échéance sur la période.</Empty>;
  return (
    <ul className="-mx-2">
      {items.slice(0, limit).map((i, n) => (
        <li key={`${i.source}-${i.source_id}-${i.date}-${n}`} className={cx("flex items-center gap-3 rounded-xl px-2 py-2", i.paid && "opacity-50")}>
          <div className="w-11 shrink-0 text-center leading-tight">
            <div className="text-[15px] font-semibold">{new Date(i.date + "T12:00").getDate()}</div>
            <div className="text-[11px] text-muted uppercase">{new Date(i.date + "T12:00").toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{i.name}</div>
            <div className="text-xs text-muted">{i.paid ? "Déjà passé" : `${SOURCE_LABEL[i.source]} · ${relDays(i.date)}`}</div>
          </div>
          <Amount value={i.amount} className="text-sm font-medium" />
        </li>
      ))}
    </ul>
  );
}

export function Dashboard() {
  const { data, error, loading, reload } = useApi<D>("/api/dashboard");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;

  if (data.accounts.length === 0) return <Welcome onDemo={reload} />;

  const r = data.reste_a_vivre;
  const c = r.current;
  const spentMonth = data.categories.reduce((s, x) => s + x.amount, 0);
  const trend = data.spent_prev_same_period ? spentMonth / data.spent_prev_same_period - 1 : null;
  const topCats = data.categories.slice(0, 7);
  const maxCat = Math.max(...topCats.map((x) => x.amount), 1);

  return (
    <div className="space-y-5">
      {/* ── Ligne héros ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.35fr_2fr]">
        <section className="card fade-in relative overflow-hidden p-6">
          <div className="text-sm text-ink-2">Reste à vivre jusqu'au {fdate(c.horizon, "long").replace(/ \d{4}$/, "")}</div>
          <div className={cx("mt-2 text-5xl font-semibold tracking-tight", c.available < 0 && "text-critical-ink")}>{eur(c.available, { decimals: false })}</div>
          <div className="mt-2 text-sm text-ink-2">
            soit <span className="font-semibold text-ink">{eur(c.per_day)}</span> par jour pendant {c.days_left} jour{c.days_left > 1 ? "s" : ""}
            <span className="text-muted"> ({c.horizon_reason})</span>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
            <div>
              <div className="text-xs text-muted">Disponible</div>
              <div className="num font-medium">{eur(c.liquid)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Échéances à venir</div>
              <div className="num font-medium">{c.remaining_charges ? `−${eur(c.remaining_charges)}` : eur(0)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Reste à vivre mensuel</div>
              <div className="num font-medium">{eur(r.reste_a_vivre, { decimals: false })}</div>
            </div>
          </div>
          <Link to="/reste-a-vivre" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
            Détail du calcul <ArrowRight size={14} />
          </Link>
        </section>
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4 xl:grid-cols-2">
          <Stat label="Solde des comptes courants" icon={Wallet} value={eur(data.balances.liquid)} hint={`${data.accounts.filter((a) => a.type === "courant").length} compte(s) courant(s)`} tone={data.balances.liquid < 0 ? "critical" : undefined} />
          <Stat label="Épargne" icon={PiggyBank} value={eur(data.balances.savings, { decimals: false })} hint={`Patrimoine net ${eur(data.balances.net_worth, { decimals: false })}`} />
          <Stat label="Charges fixes / mois" icon={Repeat} value={eur(r.charges_monthly, { decimals: false })} hint={r.charges_ratio !== null ? `${pct(r.charges_ratio)} des revenus` : undefined} />
          <Stat label="Capital restant dû" icon={Banknote} value={eur(data.balances.debt, { decimals: false })} hint={r.debt_ratio !== null ? `Taux d'endettement ${pct(r.debt_ratio, 1)}` : undefined} tone={r.debt_ratio !== null && r.debt_ratio > 0.35 ? "critical" : undefined} />
        </div>
      </div>

      {/* ── Solde + alertes ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Évolution du solde" className="xl:col-span-2" action={<Link to="/previsionnel" className="text-sm text-accent-ink hover:underline">Prévisionnel</Link>}>
          <BalanceChart history={data.history} forecast={data.forecast.series} />
          <p className="mt-2 text-xs text-muted">
            Point bas prévu : <span className={cx("num font-medium", data.forecast.lowest.balance < 0 ? "text-critical-ink" : "text-ink-2")}>{eur(data.forecast.lowest.balance)}</span> le {fdate(data.forecast.lowest.date)} · dépenses courantes estimées à {eur(data.forecast.daily_variable)}/jour
          </p>
        </Card>
        <Card title="À surveiller" action={data.alerts.length ? <Badge>{data.alerts.length}</Badge> : undefined}>
          {data.alerts.length === 0 ? (
            <Empty title="Tout est en ordre" icon={Sparkles}>Aucune alerte pour le moment.</Empty>
          ) : (
            <div className="scroll-thin -mx-2 max-h-[320px] overflow-y-auto">{data.alerts.map((a, i) => <AlertRow key={i} alert={a} />)}</div>
          )}
        </Card>
      </div>

      {/* ── Flux mensuels + catégories ─────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Revenus et dépenses sur 12 mois">
          <MonthlyBars data={data.monthly} />
        </Card>
        <Card
          title="Dépenses du mois par catégorie"
          action={
            trend !== null && (
              <span className="text-xs text-ink-2">
                {eur(spentMonth, { decimals: false })} · <span className={trend > 0 ? "text-critical-ink" : "text-good-ink"}>{trend > 0 ? "+" : ""}{pct(trend)}</span> vs mois dernier
              </span>
            )
          }
        >
          {topCats.length === 0 ? (
            <Empty title="Pas encore de dépenses ce mois-ci" />
          ) : (
            <ul className="space-y-3.5">
              {topCats.map((x) => (
                <li key={x.name} className="flex items-center gap-3">
                  <CategoryIcon icon={x.icon} color={x.color} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{x.name}</span>
                      <span className="num font-medium">
                        {eur(x.amount)}
                        {x.budget ? <span className="font-normal text-muted"> / {eur(x.budget, { decimals: false })}</span> : null}
                      </span>
                    </div>
                    {x.budget ? <Meter value={x.amount} max={x.budget} height={6} /> : <Meter value={x.amount} max={maxCat} severity={false} color="var(--s1)" height={6} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Échéances, crédits, comptes ────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Prochaines échéances" action={<Link to="/echeancier" className="text-sm text-accent-ink hover:underline">Tout voir</Link>}>
          <UpcomingList items={data.upcoming} />
        </Card>
        <Card title="Crédits en cours" action={<Link to="/credits" className="text-sm text-accent-ink hover:underline">Gérer</Link>}>
          {data.loans.length === 0 ? (
            <Empty title="Aucun crédit en cours" icon={Banknote} />
          ) : (
            <ul className="space-y-5">
              {data.loans.map((l) => (
                <li key={l.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{l.name}</span>
                    <span className="num text-sm">{eur(l.payment_with_insurance)}<span className="text-muted">/mois</span></span>
                  </div>
                  <div className="my-2"><Meter value={l.paid_count} max={l.paid_count + l.remaining_count} severity={false} color="var(--s3)" /></div>
                  <div className="flex justify-between text-xs text-muted">
                    <span>Reste {eur(l.remaining_capital, { decimals: false })} · {l.remaining_count} échéances</span>
                    <span>Fin {fdate(l.end_date, "month")}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-sm">
            <span className="text-ink-2">Abonnements actifs ({data.subscriptions.count})</span>
            <span className="num font-medium">{eur(data.subscriptions.monthly)}/mois · {eur(data.subscriptions.yearly, { decimals: false })}/an</span>
          </div>
        </Card>
        <Card title="Comptes" action={<Link to="/comptes" className="text-sm text-accent-ink hover:underline">Gérer</Link>} className="lg:col-span-2 xl:col-span-1">
          <ul className="-mx-2">
            {data.accounts.map((a) => (
              <li key={a.id}>
                <Link to={`/operations?account=${a.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
                  <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: a.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {a.name} {a.connected && <Landmark size={12} className="text-muted" aria-label="Synchronisé" />}
                    </div>
                    <div className="text-xs text-muted">{a.bank_name || ACCOUNT_TYPES[a.type]}</div>
                  </div>
                  <span className={cx("num text-sm font-medium", a.balance < 0 && "text-critical-ink")}>{eur(a.balance)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {data.goals.length > 0 && (
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              {data.goals.map((g) => (
                <div key={g.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{g.name}</span>
                    <span className="num text-ink-2">{pct(Math.min(1, g.current / g.target))}</span>
                  </div>
                  <Meter value={g.current} max={g.target} severity={false} color={g.color} height={6} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Welcome({ onDemo }: { onDemo: () => void }) {
  const loadDemo = async () => {
    await api.post("/api/admin/demo");
    window.location.reload();
    onDemo();
  };
  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Bienvenue sur Pactole</h1>
      <p className="mt-2 text-ink-2">Commencez par relier votre compte Revolut (ou une autre banque), importer un relevé, ou explorez l'application avec des données fictives.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Link to="/banques" className="card p-5 transition-colors hover:border-accent">
          <Landmark className="text-accent" />
          <div className="mt-3 font-medium">Relier une banque</div>
          <div className="mt-1 text-sm text-ink-2">Revolut et la plupart des banques européennes (DSP2).</div>
        </Link>
        <Link to="/comptes" className="card p-5 transition-colors hover:border-accent">
          <Wallet className="text-accent" />
          <div className="mt-3 font-medium">Créer un compte</div>
          <div className="mt-1 text-sm text-ink-2">Manuel, avec import CSV / OFX.</div>
        </Link>
        <button onClick={loadDemo} className="card p-5 text-left transition-colors hover:border-accent">
          <Sparkles className="text-accent" />
          <div className="mt-3 font-medium">Charger la démo</div>
          <div className="mt-1 text-sm text-ink-2">Un profil fictif complet pour découvrir.</div>
        </button>
      </div>
    </div>
  );
}
