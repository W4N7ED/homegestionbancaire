import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, qs, useApi } from "../lib/api";
import { eur, fdate } from "../lib/format";
import { useRefData } from "../lib/refdata";
import type { CategorySpend } from "../lib/types";
import { Card, CategoryIcon, Loading, Meter, PageHeader, Stat, cx } from "../components/ui";

function iso(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function BudgetsPage() {
  const { categories, reload } = useRefData();
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const start = iso(cursor);
  const end = iso(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  const avgStart = iso(new Date(cursor.getFullYear(), cursor.getMonth() - 3, 1));
  const avgEnd = iso(new Date(cursor.getFullYear(), cursor.getMonth(), 0));
  const { data: month } = useApi<CategorySpend[]>(`/api/stats/categories${qs({ date_from: start, date_to: end })}`);
  const { data: avg } = useApi<CategorySpend[]>(`/api/stats/categories${qs({ date_from: avgStart, date_to: avgEnd })}`);
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const spent = new Map((month ?? []).map((m) => [m.category_id, m.amount]));
  const avg3 = new Map((avg ?? []).map((m) => [m.category_id, m.amount / 3]));
  const expenseCats = categories.filter((c) => c.kind === "expense").sort((a, b) => (spent.get(b.id) ?? 0) - (spent.get(a.id) ?? 0));
  const totalBudget = expenseCats.reduce((s, c) => s + (c.budget_monthly ?? 0), 0);
  const totalBudgeted = expenseCats.filter((c) => c.budget_monthly).reduce((s, c) => s + (spent.get(c.id) ?? 0), 0);
  const totalSpent = (month ?? []).reduce((s, m) => s + m.amount, 0);

  const saveBudget = async (id: number) => {
    const raw = drafts[id];
    if (raw === undefined) return;
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;
    const value = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    await api.put(`/api/categories/${id}`, { ...cat, budget_monthly: value });
    setDrafts((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Budgets"
        subtitle="Fixez un plafond mensuel par catégorie ; la moyenne des 3 mois précédents sert de repère."
        actions={
          <div className="flex items-center gap-1">
            <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Mois précédent"><ChevronLeft size={18} /></button>
            <span className="min-w-[150px] text-center font-medium capitalize">{fdate(cursor, "month")}</span>
            <button className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Mois suivant"><ChevronRight size={18} /></button>
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Stat label="Dépensé ce mois" value={eur(totalSpent)} />
        <Stat label="Budgets définis" value={eur(totalBudget, { decimals: false })} hint={`${expenseCats.filter((c) => c.budget_monthly).length} catégories suivies`} />
        <Stat label="Consommé sur les budgets" value={totalBudget ? `${Math.round((totalBudgeted / totalBudget) * 100)} %` : "—"} tone={totalBudgeted > totalBudget && totalBudget > 0 ? "critical" : undefined} />
      </div>
      <Card pad={false}>
        {!month ? <Loading /> : (
          <ul className="divide-y divide-line">
            {expenseCats.map((c) => {
              const s = spent.get(c.id) ?? 0;
              const a = avg3.get(c.id) ?? 0;
              return (
                <li key={c.id} className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 px-5 py-3.5 md:grid-cols-[auto_1fr_140px_150px]">
                  <CategoryIcon icon={c.icon} color={c.color} size={36} />
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className={cx("num text-sm", c.budget_monthly && s > c.budget_monthly ? "font-semibold text-critical-ink" : "")}>{eur(s)}</span>
                    </div>
                    <div className="mt-1.5">{c.budget_monthly ? <Meter value={s} max={c.budget_monthly} /> : <div className="h-2 rounded-full bg-surface-2" />}</div>
                  </div>
                  <div className="col-start-2 text-xs text-muted md:col-start-auto md:text-right">Moy. 3 mois <span className="num text-ink-2">{eur(a, { decimals: false })}</span></div>
                  <div className="col-start-2 md:col-start-auto">
                    <div className="relative">
                      <input
                        className="input num h-8 pr-14 text-right text-[13px]"
                        inputMode="decimal"
                        placeholder="Sans plafond"
                        value={drafts[c.id] ?? (c.budget_monthly ?? "").toString()}
                        onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })}
                        onBlur={() => saveBudget(c.id)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        aria-label={`Budget ${c.name}`}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">€/mois</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
