import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Download, Plus, Search, Sparkles, Trash2, Wand2 } from "lucide-react";
import { api, qs, useApi } from "../lib/api";
import { eur, fdate, todayISO } from "../lib/format";
import { useRefData } from "../lib/refdata";
import type { Transaction } from "../lib/types";
import { CrudModal, type FieldDef } from "../components/Form";
import { Amount, Badge, Button, Card, CategoryIcon, Empty, IconButton, Loading, Modal, PageHeader, cx } from "../components/ui";

const PAGE = 100;

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const { accounts, categories, catById, accById } = useRefData();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [ruleFor, setRuleFor] = useState<{ tx: Transaction; category_id: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const filters = {
    account_id: params.get("account"),
    category: params.get("category"),
    kind: params.get("kind"),
    date_from: params.get("from"),
    date_to: params.get("to"),
    q: params.get("q"),
  };
  const url = `/api/transactions${qs({ ...filters, limit: PAGE, offset: page * PAGE })}`;
  const { data, loading, reload, setData } = useApi<{ items: Transaction[]; total: number; sum_in: number; sum_out: number }>(url);

  useEffect(() => setPage(0), [params]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) setFilter("q", q);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const setFilter = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const setCategory = async (tx: Transaction, category_id: number | null) => {
    const updated = await api.patch<Transaction>(`/api/transactions/${tx.id}`, { category_id });
    setData((d) => d && { ...d, items: d.items.map((t) => (t.id === tx.id ? updated : t)) });
    if (category_id) setRuleFor({ tx, category_id });
  };

  const createRule = async () => {
    if (!ruleFor) return;
    const r = await api.patch<Transaction & { rule_applied: number }>(`/api/transactions/${ruleFor.tx.id}`, { category_id: ruleFor.category_id, create_rule: true });
    setRuleFor(null);
    setToast(`Règle créée${r.rule_applied ? ` et appliquée à ${r.rule_applied} autre(s) opération(s)` : ""}.`);
    reload();
  };

  const bulk = async (category_id: number | null) => {
    await api.post("/api/transactions/bulk-categorize", { ids: [...selected], category_id });
    setSelected(new Set());
    reload();
  };

  const recategorize = async () => {
    const r = await api.post<{ updated: number }>("/api/transactions/recategorize");
    setToast(`${r.updated} opération(s) catégorisée(s) automatiquement.`);
    reload();
  };

  const remove = async (tx: Transaction) => {
    if (!window.confirm(`Supprimer « ${tx.label} » ?`)) return;
    await api.del(`/api/transactions/${tx.id}`);
    reload();
  };

  const catOptions = useMemo(() => {
    const groups: Record<string, typeof categories> = { expense: [], income: [], transfer: [] };
    categories.forEach((c) => groups[c.kind].push(c));
    return groups;
  }, [categories]);

  const CatSelect = ({ value, onChange, className }: { value: number | null; onChange: (v: number | null) => void; className?: string }) => (
    <select className={cx("input h-8 py-0 text-[13px]", className)} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Non catégorisé</option>
      <optgroup label="Dépenses">{catOptions.expense.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
      <optgroup label="Revenus">{catOptions.income.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
      <optgroup label="Mouvements internes">{catOptions.transfer.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
    </select>
  );

  const addFields: FieldDef[] = [
    { key: "account_id", label: "Compte", type: "select", required: true, options: accounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: "date", label: "Date", type: "date", required: true },
    { key: "label", label: "Libellé", required: true, full: true },
    { key: "amount", label: "Montant (négatif = dépense)", type: "number", required: true },
    { key: "category_id", label: "Catégorie", type: "select", options: categories.map((c) => ({ value: c.id, label: c.name })) },
    { key: "notes", label: "Notes", type: "textarea" },
  ];

  const items = data?.items ?? [];
  const allChecked = items.length > 0 && items.every((t) => selected.has(t.id));

  return (
    <div>
      <PageHeader
        title="Opérations"
        subtitle={data && <>{data.total} opérations · entrées <span className="num text-good-ink">{eur(data.sum_in)}</span> · sorties <span className="num text-ink">{eur(data.sum_out)}</span></>}
        actions={
          <>
            <Button icon={Wand2} onClick={recategorize}>Catégoriser auto</Button>
            <a href={`/api/transactions/export.csv${qs(filters)}`}><Button icon={Download}>Export CSV</Button></a>
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)} disabled={!accounts.length}>Opération</Button>
          </>
        }
      />
      {toast && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-surface-2 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2"><Sparkles size={15} className="text-accent" />{toast}</span>
          <button className="text-muted hover:text-ink" onClick={() => setToast(null)}>OK</button>
        </div>
      )}

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Rechercher un libellé, un tiers, une note…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-auto" value={filters.account_id ?? ""} onChange={(e) => setFilter("account", e.target.value)}>
            <option value="">Tous les comptes</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="input w-auto" value={filters.category ?? ""} onChange={(e) => setFilter("category", e.target.value)}>
            <option value="">Toutes catégories</option>
            <option value="none">Non catégorisées</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input w-auto" value={filters.kind ?? ""} onChange={(e) => setFilter("kind", e.target.value)}>
            <option value="">Entrées & sorties</option>
            <option value="expense">Dépenses</option>
            <option value="income">Revenus</option>
            <option value="transfer">Virements internes</option>
          </select>
          <input type="date" className="input w-auto" value={filters.date_from ?? ""} onChange={(e) => setFilter("from", e.target.value)} aria-label="Du" />
          <input type="date" className="input w-auto" value={filters.date_to ?? ""} onChange={(e) => setFilter("to", e.target.value)} aria-label="Au" />
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2 px-4 py-2 text-sm">
            <span className="font-medium">{selected.size} sélectionnée(s)</span>
            <span className="text-ink-2">Classer dans</span>
            <CatSelect value={null} onChange={bulk} className="w-56" />
            <button className="text-ink-2 hover:text-ink" onClick={() => setSelected(new Set())}>Annuler</button>
          </div>
        )}

        {loading && !data ? (
          <Loading />
        ) : items.length === 0 ? (
          <Empty title="Aucune opération">Modifiez les filtres, importez un relevé ou synchronisez votre banque.</Empty>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8"><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(items.map((t) => t.id)))} aria-label="Tout sélectionner" /></th>
                  <th>Date</th>
                  <th>Libellé</th>
                  <th className="hidden md:table-cell">Catégorie</th>
                  <th className="hidden lg:table-cell">Compte</th>
                  <th className="text-right">Montant</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((t) => {
                  const cat = t.category_id ? catById.get(t.category_id) : undefined;
                  return (
                    <tr key={t.id} className={cx(t.status === "pending" && "opacity-60")}>
                      <td><input type="checkbox" checked={selected.has(t.id)} onChange={() => { const s = new Set(selected); if (s.has(t.id)) s.delete(t.id); else s.add(t.id); setSelected(s); }} aria-label="Sélectionner" /></td>
                      <td className="num whitespace-nowrap text-ink-2">{fdate(t.date)}</td>
                      <td className="max-w-[380px]">
                        <div className="flex items-center gap-2.5">
                          <span className="md:hidden"><CategoryIcon icon={cat?.icon ?? "circle-help"} color={cat?.color} size={28} /></span>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{t.label}</div>
                            <div className="flex flex-wrap gap-1.5 text-xs text-muted">
                              {t.status === "pending" && <Badge tone="warning">En attente</Badge>}
                              {t.recurring_id && <Badge tone="accent">Récurrent</Badge>}
                              {t.is_transfer && <Badge>Interne</Badge>}
                              {t.notes && <span className="truncate">{t.notes}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <CategoryIcon icon={cat?.icon ?? "circle-help"} color={cat?.color} size={24} />
                          <CatSelect value={t.category_id} onChange={(v) => setCategory(t, v)} className="w-48" />
                        </div>
                      </td>
                      <td className="hidden text-ink-2 lg:table-cell">{accById.get(t.account_id)?.name}</td>
                      <td className="text-right font-medium"><Amount value={t.amount} currency={t.currency} className={t.is_transfer ? "text-ink-2" : undefined} colored={!t.is_transfer} /></td>
                      <td>{t.source === "manual" && <IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={() => remove(t)} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-ink-2">{page * PAGE + 1}–{Math.min((page + 1) * PAGE, data.total)} sur {data.total}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Précédent</Button>
              <Button size="sm" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Suivant</Button>
            </div>
          </div>
        )}
      </Card>

      <Modal
        open={!!ruleFor}
        onClose={() => setRuleFor(null)}
        title="Mémoriser ce choix ?"
        footer={<><Button variant="ghost" onClick={() => setRuleFor(null)}>Non merci</Button><Button variant="primary" onClick={createRule}>Créer la règle</Button></>}
      >
        <p className="text-sm text-ink-2">
          Classer automatiquement les opérations similaires à « <span className="font-medium text-ink">{ruleFor?.tx.label}</span> » dans <span className="font-medium text-ink">{ruleFor && catById.get(ruleFor.category_id)?.name}</span> ? La règle s'appliquera aussi aux opérations passées non catégorisées.
        </p>
      </Modal>

      <CrudModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => reload()}
        endpoint="/api/transactions"
        title="Nouvelle opération"
        fields={addFields}
        initial={{ account_id: accounts[0]?.id, date: todayISO(), label: "", amount: "", category_id: "", notes: "" }}
      />
    </div>
  );
}
