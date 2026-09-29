import { useState } from "react";
import { CalendarClock, Pencil, Plus, Sparkles, Table2, Trash2 } from "lucide-react";
import { api, useApi } from "../lib/api";
import { CONTRACT_CATEGORIES, FREQUENCIES, LOAN_TYPES, RECURRING_KINDS, daysUntil, eur, fdate, pct, relDays, todayISO } from "../lib/format";
import { useRefData } from "../lib/refdata";
import type { LoanStatus } from "../lib/types";
import { CapitalChart } from "../components/Charts";
import { DocsButton } from "../components/Docs";
import { CrudModal, type FieldDef } from "../components/Form";
import { Badge, Button, Card, Empty, IconButton, Loading, Meter, Modal, PageHeader, Segmented, Stat, cx } from "../components/ui";

async function confirmDelete(url: string, what: string, after: () => void) {
  if (!window.confirm(`Supprimer ${what} ?`)) return;
  await api.del(url);
  after();
}

// ── Revenus & prélèvements récurrents ────────────────────────────────────────
interface Recurring {
  id: number; name: string; kind: string; amount: number; frequency: string; start_date: string; end_date: string | null;
  account_id: number | null; category_id: number | null; counterparty: string | null; match_pattern: string | null; active: boolean; notes: string | null;
  monthly: number; next_date: string | null;
}
interface Suggestion {
  key: string; name: string; kind: string; amount: number; median_amount: number; variable: boolean; frequency: string;
  occurrences: number; last_date: string; start_date: string; account_id: number; category_id: number | null; match_pattern: string; sample_label: string;
}

export function RecurringPage() {
  const { accounts, categories, catById } = useRefData();
  const { data, reload } = useApi<Recurring[]>("/api/recurring");
  const { data: sugg, reload: reloadSugg } = useApi<Suggestion[]>("/api/recurring/detect");
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");

  const fields: FieldDef[] = [
    { key: "name", label: "Nom", required: true },
    { key: "kind", label: "Nature", type: "select", options: RECURRING_KINDS, required: true },
    { key: "amount", label: "Montant", type: "number", required: true },
    { key: "frequency", label: "Fréquence", type: "select", options: FREQUENCIES, required: true },
    { key: "start_date", label: "Première échéance", type: "date", required: true, hint: "Détermine le jour de passage." },
    { key: "end_date", label: "Dernière échéance (facultatif)", type: "date", hint: "Laisser vide si sans fin (salaire, loyer…)." },
    { key: "account_id", label: "Compte", type: "select", options: accounts.map((a) => ({ value: a.id, label: a.name })) },
    {
      key: "category_id", label: "Catégorie", type: "select",
      // catégories correspondant à la nature choisie (revenu → Salaire, Aides… ; épargne → Épargne…)
      options: (v) => {
        const want = v.kind === "income" ? "income" : v.kind === "transfer" || v.kind === "savings" ? "transfer" : "expense";
        return categories.filter((c) => c.kind === want).map((c) => ({ value: c.id, label: c.name }));
      },
    },
    { key: "match_pattern", label: "Mot-clé de rapprochement", hint: "Mots présents dans le libellé bancaire (ex. « edf »). Permet de savoir si l'échéance est déjà passée.", full: true },
    { key: "active", label: "Active", type: "toggle" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const empty = { name: "", kind: "direct_debit", amount: "", frequency: "monthly", start_date: todayISO(), end_date: "", account_id: accounts[0]?.id ?? "", category_id: "", match_pattern: "", active: true, notes: "" };

  const accept = async (s: Suggestion) => {
    const created = await api.post<Recurring>("/api/recurring", {
      name: s.name, kind: s.kind, amount: s.median_amount, frequency: s.frequency, start_date: s.start_date,
      account_id: s.account_id, category_id: s.category_id, match_pattern: s.match_pattern, active: true,
    });
    await api.post(`/api/recurring/${created.id}/link`);
    reload();
    reloadSugg();
  };

  const items = (data ?? []).filter((r) => filter === "all" || (filter === "in" ? r.kind === "income" : r.kind !== "income"));
  const active = (data ?? []).filter((r) => r.active);
  const monthlyIn = active.filter((r) => r.kind === "income").reduce((s, r) => s + r.monthly, 0);
  const monthlyOut = active.filter((r) => r.kind !== "income" && r.kind !== "savings" && r.kind !== "transfer").reduce((s, r) => s + r.monthly, 0);
  const monthlySave = active.filter((r) => r.kind === "savings" || r.kind === "transfer").reduce((s, r) => s + r.monthly, 0);

  return (
    <div>
      <PageHeader
        title="Revenus & prélèvements"
        subtitle="Salaires, loyers, prélèvements, virements permanents et épargne programmée."
        actions={<Button variant="primary" icon={Plus} onClick={() => setEdit(empty)}>Ajouter</Button>}
      />
      <div className="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Stat label="Revenus récurrents / mois" value={eur(monthlyIn)} />
        <Stat label="Prélèvements & dépenses / mois" value={eur(monthlyOut)} />
        <Stat label="Épargne & virements / mois" value={eur(monthlySave)} />
      </div>

      {sugg && sugg.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><Sparkles size={16} className="text-accent" />Détectés automatiquement dans vos opérations</span>} className="mb-5">
          <ul className="divide-y divide-line">
            {sugg.slice(0, 8).map((s) => (
              <li key={s.key + s.kind} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.name} <span className="text-xs font-normal text-muted">« {s.sample_label} »</span></div>
                  <div className="text-xs text-muted">{FREQUENCIES[s.frequency]} · {s.occurrences} occurrences · dernière le {fdate(s.last_date)}{s.variable && " · montant variable"}</div>
                </div>
                <span className={cx("num font-medium", s.kind === "income" && "text-good-ink")}>{s.kind === "income" ? "+" : "−"}{eur(s.median_amount)}</span>
                <Button size="sm" onClick={() => accept(s)}>Ajouter</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card pad={false} title="Échéances" action={<Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "Tout" }, { value: "in", label: "Entrées" }, { value: "out", label: "Sorties" }]} />}>
        {!data ? <Loading /> : items.length === 0 ? <Empty title="Aucune échéance">Ajoutez votre salaire, votre loyer et vos prélèvements, ou acceptez les suggestions.</Empty> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="table">
              <thead><tr><th>Nom</th><th className="hidden sm:table-cell">Nature</th><th className="hidden md:table-cell">Fréquence</th><th>Prochaine</th><th className="text-right">Montant</th><th className="hidden text-right lg:table-cell">/ mois</th><th /></tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className={cx(!r.active && "opacity-50")}>
                    <td>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted">{r.category_id ? catById.get(r.category_id)?.name : ""}{r.match_pattern && ` · « ${r.match_pattern} »`}</div>
                    </td>
                    <td className="hidden sm:table-cell"><Badge tone={r.kind === "income" ? "good" : "neutral"}>{RECURRING_KINDS[r.kind]}</Badge></td>
                    <td className="hidden text-ink-2 md:table-cell">{FREQUENCIES[r.frequency]}</td>
                    <td className="whitespace-nowrap">{r.next_date ? <>{fdate(r.next_date)} <span className="text-xs text-muted">{relDays(r.next_date)}</span></> : "—"}</td>
                    <td className={cx("num text-right font-medium", r.kind === "income" && "text-good-ink")}>{r.kind === "income" ? "+" : "−"}{eur(r.amount)}</td>
                    <td className="num hidden text-right text-ink-2 lg:table-cell">{eur(r.monthly)}</td>
                    <td className="whitespace-nowrap text-right">
                      <IconButton icon={Pencil} label="Modifier" onClick={() => setEdit({ ...r })} />
                      <IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={() => confirmDelete(`/api/recurring/${r.id}`, `« ${r.name} »`, reload)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <CrudModal open={!!edit} onClose={() => setEdit(null)} onSaved={() => { reload(); reloadSugg(); }} endpoint="/api/recurring" title={edit?.id ? "Modifier l'échéance" : "Nouvelle échéance"} fields={fields} initial={edit ?? empty} />
    </div>
  );
}

// ── Contrats & abonnements ───────────────────────────────────────────────────
interface Contract {
  id: number; name: string; provider: string; category: string; amount: number; frequency: string; start_date: string;
  commitment_end: string | null; notice_days: number; auto_renew: boolean; contract_number: string | null; customer_number: string | null;
  contact: string | null; account_id: number | null; match_pattern: string | null; status: string; end_date: string | null; notes: string | null;
  monthly: number; yearly: number; next_date: string | null; documents: number;
}

export function ContractsPage() {
  const { accounts } = useRefData();
  const { data, reload } = useApi<Contract[]>("/api/contracts");
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [view, setView] = useState<"active" | "cancelled">("active");

  const fields: FieldDef[] = [
    { key: "name", label: "Nom", required: true },
    { key: "provider", label: "Fournisseur" },
    { key: "category", label: "Catégorie", type: "select", options: CONTRACT_CATEGORIES, required: true },
    { key: "amount", label: "Montant", type: "number", required: true },
    { key: "frequency", label: "Fréquence", type: "select", options: FREQUENCIES, required: true },
    { key: "start_date", label: "Date de début / 1er prélèvement", type: "date", required: true },
    { key: "commitment_end", label: "Fin d'engagement", type: "date" },
    { key: "notice_days", label: "Préavis de résiliation (jours)", type: "number", step: "1" },
    { key: "contract_number", label: "N° de contrat" },
    { key: "customer_number", label: "N° client / ligne" },
    { key: "contact", label: "Contact (tél., e-mail, espace client)", full: true },
    { key: "account_id", label: "Compte prélevé", type: "select", options: accounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: "match_pattern", label: "Mot-clé du libellé bancaire" },
    { key: "status", label: "Statut", type: "select", options: { active: "Actif", cancelled: "Résilié" }, required: true },
    { key: "end_date", label: "Date de fin effective", type: "date", show: (v) => v.status === "cancelled" },
    { key: "auto_renew", label: "Reconduction tacite", type: "toggle" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const empty = { name: "", provider: "", category: "telecom", amount: "", frequency: "monthly", start_date: todayISO(), commitment_end: "", notice_days: 0, contract_number: "", customer_number: "", contact: "", account_id: "", match_pattern: "", status: "active", end_date: "", auto_renew: true, notes: "" };

  const active = (data ?? []).filter((c) => c.status === "active");
  const byCat = Object.entries(
    active.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.category]: (acc[c.category] ?? 0) + c.monthly }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const total = active.reduce((s, c) => s + c.monthly, 0);
  const items = (data ?? []).filter((c) => c.status === view);

  return (
    <div>
      <PageHeader title="Contrats & abonnements" subtitle="Énergie, box, mobile, assurances, streaming… avec dates d'engagement et justificatifs." actions={<Button variant="primary" icon={Plus} onClick={() => setEdit(empty)}>Ajouter un contrat</Button>} />
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Stat label="Coût mensuel" value={eur(total)} hint={`${active.length} contrats actifs`} />
        <Stat label="Coût annuel" value={eur(total * 12, { decimals: false })} />
        <Card title="Répartition">
          <ul className="space-y-2">
            {byCat.slice(0, 5).map(([cat, v]) => (
              <li key={cat}>
                <div className="flex justify-between text-sm"><span>{CONTRACT_CATEGORIES[cat] ?? cat}</span><span className="num">{eur(v)}</span></div>
                <Meter value={v} max={byCat[0][1]} severity={false} color="var(--s1)" height={5} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card pad={false} title="Contrats" action={<Segmented value={view} onChange={setView} options={[{ value: "active", label: "Actifs" }, { value: "cancelled", label: "Résiliés" }]} />}>
        {!data ? <Loading /> : items.length === 0 ? <Empty title="Aucun contrat" /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="table">
              <thead><tr><th>Contrat</th><th className="hidden md:table-cell">Catégorie</th><th className="hidden lg:table-cell">Engagement</th><th>Prochain</th><th className="text-right">Montant</th><th /></tr></thead>
              <tbody>
                {items.map((c) => {
                  const deadline = c.commitment_end ? new Date(new Date(c.commitment_end + "T12:00").getTime() - c.notice_days * 86400000).toISOString().slice(0, 10) : null;
                  const soon = deadline && daysUntil(deadline) <= 30 && daysUntil(deadline) >= 0;
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted">{c.provider}{c.contract_number && ` · n° ${c.contract_number}`}</div>
                      </td>
                      <td className="hidden md:table-cell"><Badge>{CONTRACT_CATEGORIES[c.category] ?? c.category}</Badge></td>
                      <td className="hidden lg:table-cell">
                        {c.commitment_end ? (
                          <div>
                            <div className="text-sm">jusqu'au {fdate(c.commitment_end)}</div>
                            {deadline && <div className={cx("text-xs", soon ? "font-medium text-critical-ink" : "text-muted")}>résilier avant le {fdate(deadline)}</div>}
                          </div>
                        ) : <span className="text-sm text-muted">Sans engagement</span>}
                      </td>
                      <td className="whitespace-nowrap text-sm">{c.next_date ? fdate(c.next_date) : "—"}</td>
                      <td className="num text-right">
                        <div className="font-medium">{eur(c.amount)}</div>
                        <div className="text-xs text-muted">{FREQUENCIES[c.frequency].toLowerCase()}</div>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <DocsButton ownerType="contract" ownerId={c.id} docType="contrat" count={c.documents} title={c.name} onChange={reload} />
                        <IconButton icon={Pencil} label="Modifier" onClick={() => setEdit({ ...c })} />
                        <IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={() => confirmDelete(`/api/contracts/${c.id}`, `« ${c.name} »`, reload)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <CrudModal open={!!edit} onClose={() => setEdit(null)} onSaved={reload} endpoint="/api/contracts" title={edit?.id ? "Modifier le contrat" : "Nouveau contrat"} fields={fields} initial={edit ?? empty} />
    </div>
  );
}

// ── Crédits ──────────────────────────────────────────────────────────────────
interface Loan {
  id: number; name: string; lender: string; type: string; principal: number; rate: number; duration_months: number; start_date: string;
  monthly_payment: number | null; insurance_monthly: number; account_id: number | null; match_pattern: string | null; notes: string | null;
  status: LoanStatus; documents: number;
}

export function LoansPage() {
  const { accounts } = useRefData();
  const { data, reload } = useApi<Loan[]>("/api/loans");
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [schedule, setSchedule] = useState<Loan | null>(null);

  const fields: FieldDef[] = [
    { key: "name", label: "Nom", required: true },
    { key: "lender", label: "Organisme prêteur" },
    { key: "type", label: "Type", type: "select", options: LOAN_TYPES, required: true },
    { key: "principal", label: "Capital emprunté", type: "number", required: true },
    { key: "rate", label: "Taux nominal annuel (%)", type: "number", step: "0.001", required: true },
    { key: "duration_months", label: "Durée (mois)", type: "number", step: "1", required: true },
    { key: "start_date", label: "Date de la 1re échéance", type: "date", required: true },
    { key: "monthly_payment", label: "Mensualité hors assurance", type: "number", hint: "Laisser vide pour la calculer." },
    { key: "insurance_monthly", label: "Assurance emprunteur / mois", type: "number" },
    { key: "account_id", label: "Compte prélevé", type: "select", options: accounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: "match_pattern", label: "Mot-clé du libellé bancaire" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const empty = { name: "", lender: "", type: "consommation", principal: "", rate: "", duration_months: "", start_date: todayISO(), monthly_payment: "", insurance_monthly: 0, account_id: "", match_pattern: "", notes: "" };

  const running = (data ?? []).filter((l) => !l.status.finished);
  const monthly = running.reduce((s, l) => s + l.status.payment_with_insurance, 0);
  const remaining = running.reduce((s, l) => s + l.status.remaining_capital, 0);

  return (
    <div>
      <PageHeader title="Crédits" subtitle="Immobilier, auto, consommation… tableau d'amortissement et capital restant dû." actions={<Button variant="primary" icon={Plus} onClick={() => setEdit(empty)}>Ajouter un crédit</Button>} />
      <div className="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Stat label="Mensualités totales" value={eur(monthly)} hint="assurance comprise" />
        <Stat label="Capital restant dû" value={eur(remaining, { decimals: false })} />
        <Stat label="Intérêts restant à payer" value={eur(running.reduce((s, l) => s + l.status.total_interest - l.status.interest_paid, 0), { decimals: false })} />
      </div>
      {!data ? <Loading /> : data.length === 0 ? <Card><Empty title="Aucun crédit">Ajoutez vos prêts pour suivre le capital restant dû et votre taux d'endettement.</Empty></Card> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {data.map((l) => (
            <Card key={l.id} title={l.name} action={<div className="flex items-center">
              <DocsButton ownerType="loan" ownerId={l.id} docType="credit" count={l.documents} title={l.name} onChange={reload} />
              <IconButton icon={Pencil} label="Modifier" onClick={() => setEdit({ ...l, monthly_payment: l.monthly_payment ?? "" })} />
              <IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={() => confirmDelete(`/api/loans/${l.id}`, `« ${l.name} »`, reload)} />
            </div>}>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge>{LOAN_TYPES[l.type]}</Badge>
                {l.lender && <Badge>{l.lender}</Badge>}
                <Badge>{l.rate.toLocaleString("fr-FR")} %</Badge>
                {l.status.finished && <Badge tone="good">Remboursé</Badge>}
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-xs text-muted">Mensualité</div><div className="num font-semibold">{eur(l.status.payment_with_insurance)}</div></div>
                <div><div className="text-xs text-muted">Restant dû</div><div className="num font-semibold">{eur(l.status.remaining_capital, { decimals: false })}</div></div>
                <div><div className="text-xs text-muted">Coût total</div><div className="num font-semibold">{eur(l.status.total_cost, { decimals: false })}</div></div>
              </div>
              <div className="mt-4 mb-1.5 flex justify-between text-xs text-muted">
                <span>{l.status.paid_count} / {l.duration_months} échéances · {pct(l.status.progress)}</span>
                <span>fin {fdate(l.status.end_date, "month")}</span>
              </div>
              <Meter value={l.status.paid_count} max={l.duration_months} severity={false} color="var(--s3)" />
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-muted">{l.status.next_date && <><CalendarClock size={12} className="mr-1 inline" />prochaine le {fdate(l.status.next_date)}</>}</span>
                <Button size="sm" icon={Table2} onClick={() => setSchedule(l)}>Amortissement</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <CrudModal open={!!edit} onClose={() => setEdit(null)} onSaved={reload} endpoint="/api/loans" title={edit?.id ? "Modifier le crédit" : "Nouveau crédit"} fields={fields} initial={edit ?? empty} />
      {schedule && <ScheduleModal loan={schedule} onClose={() => setSchedule(null)} />}
    </div>
  );
}

function ScheduleModal({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { data } = useApi<{ rows: { n: number; date: string; payment: number; interest: number; capital: number; insurance: number; remaining: number }[] }>(`/api/loans/${loan.id}/schedule`);
  const today = todayISO();
  return (
    <Modal open onClose={onClose} title={`Tableau d'amortissement — ${loan.name}`} wide>
      {!data ? <Loading /> : (
        <>
          <CapitalChart rows={data.rows} today={today} />
          <div className="scroll-thin mt-4 max-h-[45vh] overflow-auto">
            <table className="table">
              <thead className="sticky top-0 bg-surface"><tr><th>#</th><th>Date</th><th className="text-right">Échéance</th><th className="text-right">Intérêts</th><th className="text-right">Capital</th><th className="text-right">Assurance</th><th className="text-right">Restant dû</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.n} className={cx(r.date <= today && "text-muted")}>
                    <td className="num">{r.n}</td><td className="num">{fdate(r.date)}</td>
                    <td className="num text-right">{eur(r.payment)}</td><td className="num text-right">{eur(r.interest)}</td>
                    <td className="num text-right">{eur(r.capital)}</td><td className="num text-right">{eur(r.insurance)}</td>
                    <td className="num text-right font-medium">{eur(r.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Objectifs d'épargne ──────────────────────────────────────────────────────
interface Goal { id: number; name: string; target: number; saved: number; account_id: number | null; deadline: string | null; color: string; current: number; monthly_needed: number | null }

export function GoalsPage() {
  const { accounts } = useRefData();
  const { data, reload } = useApi<Goal[]>("/api/goals");
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const fields: FieldDef[] = [
    { key: "name", label: "Objectif", required: true, full: true },
    { key: "target", label: "Montant cible", type: "number", required: true },
    { key: "deadline", label: "Échéance", type: "date" },
    { key: "account_id", label: "Compte d'épargne lié", type: "select", options: accounts.map((a) => ({ value: a.id, label: a.name })), hint: "Le solde du compte sert de montant épargné." },
    { key: "saved", label: "Déjà épargné (si pas de compte lié)", type: "number" },
    { key: "color", label: "Couleur", type: "color" },
  ];
  const empty = { name: "", target: "", deadline: "", account_id: "", saved: 0, color: "#1baf7a" };
  return (
    <div>
      <PageHeader title="Objectifs d'épargne" subtitle="Voyage, apport immobilier, épargne de précaution…" actions={<Button variant="primary" icon={Plus} onClick={() => setEdit(empty)}>Nouvel objectif</Button>} />
      {!data ? <Loading /> : data.length === 0 ? <Card><Empty title="Aucun objectif" /></Card> : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {data.map((g) => (
            <Card key={g.id} title={g.name} action={<div className="flex"><IconButton icon={Pencil} label="Modifier" onClick={() => setEdit({ ...g })} /><IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={() => confirmDelete(`/api/goals/${g.id}`, `« ${g.name} »`, reload)} /></div>}>
              <div className="text-3xl font-semibold tracking-tight">{pct(Math.min(1, g.current / g.target))}</div>
              <div className="mt-1 text-sm text-ink-2"><span className="num">{eur(g.current, { decimals: false })}</span> sur <span className="num">{eur(g.target, { decimals: false })}</span></div>
              <div className="my-4"><Meter value={g.current} max={g.target} severity={false} color={g.color} height={10} /></div>
              <div className="text-xs text-muted">
                {g.deadline ? <>Échéance {fdate(g.deadline, "long")}{g.monthly_needed !== null && <> · <span className="font-medium text-ink-2">{eur(g.monthly_needed, { decimals: false })}/mois</span> à mettre de côté</>}</> : "Sans échéance"}
              </div>
            </Card>
          ))}
        </div>
      )}
      <CrudModal open={!!edit} onClose={() => setEdit(null)} onSaved={reload} endpoint="/api/goals" title={edit?.id ? "Modifier l'objectif" : "Nouvel objectif"} fields={fields} initial={edit ?? empty} />
    </div>
  );
}
