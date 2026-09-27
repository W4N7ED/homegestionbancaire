import type { ReactNode } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { compact, eur, fdate, monthLabel } from "../lib/format";

const AXIS = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 12 }, tickLine: false } as const;

type TipRow = { label: string; value: string; color?: string; dashed?: boolean };

function TipBox({ title, rows }: { title: ReactNode; rows: TipRow[] }) {
  return (
    <div className="card min-w-[160px] px-3 py-2 text-[13px] shadow-lg">
      <div className="mb-1 font-medium">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-2">
            {r.color && <span className="inline-block h-[3px] w-3 rounded" style={{ background: r.color, opacity: r.dashed ? 0.6 : 1 }} />}
            {r.label}
          </span>
          <span className="num font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-[3px] w-4 rounded"
            style={i.dashed ? { backgroundImage: `linear-gradient(90deg, ${i.color} 60%, transparent 60%)`, backgroundSize: "6px 3px" } : { background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Solde réel (90 j) + prévision (60 j) sur un même axe. */
export function BalanceChart({ history, forecast, height = 260 }: { history: { date: string; balance: number }[]; forecast: { date: string; balance: number }[]; height?: number }) {
  const today = history.at(-1)?.date;
  const data = [
    ...history.map((h) => ({ date: h.date, real: h.balance, forecast: h.date === today ? h.balance : undefined })),
    ...forecast.slice(1).map((f) => ({ date: f.date, real: undefined, forecast: f.balance })),
  ];
  const min = Math.min(...data.map((d) => d.real ?? d.forecast ?? 0));
  return (
    <div>
      <div className="mb-3"><Legend items={[{ label: "Solde réel", color: "var(--s1)" }, { label: "Prévision", color: "var(--s1)", dashed: true }]} /></div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="realFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--s1)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--s1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" {...AXIS} tickFormatter={(d) => fdate(d).slice(0, 5)} minTickGap={40} />
          <YAxis {...AXIS} axisLine={false} width={52} tickFormatter={(v) => compact(v)} />
          {min < 0 && <ReferenceLine y={0} stroke="var(--critical)" strokeWidth={1} />}
          {today && <ReferenceLine x={today} stroke="var(--axis)" label={{ value: "Aujourd'hui", position: "insideTopLeft", fill: "var(--muted)", fontSize: 11 }} />}
          <Tooltip
            cursor={{ stroke: "var(--axis)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TipBox
                  title={fdate(String(label), "day")}
                  rows={payload.filter((p) => p.value !== undefined).map((p) => ({
                    label: p.dataKey === "real" ? "Solde" : "Prévision",
                    value: eur(Number(p.value)),
                    color: "var(--s1)",
                    dashed: p.dataKey !== "real",
                  }))}
                />
              ) : null
            }
          />
          <Area type="monotone" dataKey="real" stroke="var(--s1)" strokeWidth={2} fill="url(#realFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} connectNulls={false} />
          <Line type="monotone" dataKey="forecast" stroke="var(--s1)" strokeOpacity={0.65} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Revenus vs dépenses par mois. */
export function MonthlyBars({ data, height = 240 }: { data: { month: string; income: number; expense: number }[]; height?: number }) {
  return (
    <div>
      <div className="mb-3"><Legend items={[{ label: "Revenus", color: "var(--s1)" }, { label: "Dépenses", color: "var(--s2)" }]} /></div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="month" {...AXIS} tickFormatter={(m) => monthLabel(m)} />
          <YAxis {...AXIS} axisLine={false} width={52} tickFormatter={(v) => compact(v)} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TipBox
                  title={monthLabel(String(label), false)}
                  rows={[
                    { label: "Revenus", value: eur(Number(payload[0]?.payload.income)), color: "var(--s1)" },
                    { label: "Dépenses", value: eur(Number(payload[0]?.payload.expense)), color: "var(--s2)" },
                    { label: "Solde du mois", value: eur(Number(payload[0]?.payload.income) - Number(payload[0]?.payload.expense)) },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="income" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={20} />
          <Bar dataKey="expense" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Série unique en colonnes (ex. net versé par mois, carburant par mois). */
export function SimpleBars({ data, xKey, yKey, label, height = 220, xFormat, color = "var(--s1)" }: { data: Record<string, unknown>[]; xKey: string; yKey: string; label: string; height?: number; xFormat?: (v: string) => string; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={xKey} {...AXIS} tickFormatter={(v) => (xFormat ? xFormat(String(v)) : String(v))} minTickGap={8} />
        <YAxis {...AXIS} axisLine={false} width={52} tickFormatter={(v) => compact(v)} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
          content={({ active, payload, label: l }) =>
            active && payload?.length ? <TipBox title={xFormat ? xFormat(String(l)) : String(l)} rows={[{ label, value: eur(Number(payload[0].value)), color }]} /> : null
          }
        />
        <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Capital restant dû au fil des échéances. */
export function CapitalChart({ rows, today, height = 220 }: { rows: { date: string; remaining: number }[]; today: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="date" {...AXIS} tickFormatter={(d) => fdate(String(d)).slice(3)} minTickGap={40} />
        <YAxis {...AXIS} axisLine={false} width={52} tickFormatter={(v) => compact(v)} />
        <ReferenceLine x={rows.find((r) => r.date >= today)?.date} stroke="var(--axis)" label={{ value: "Aujourd'hui", position: "insideTopRight", fill: "var(--muted)", fontSize: 11 }} />
        <Tooltip
          cursor={{ stroke: "var(--axis)" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? <TipBox title={fdate(String(label), "month")} rows={[{ label: "Capital restant", value: eur(Number(payload[0].value)), color: "var(--s1)" }]} /> : null
          }
        />
        <Area type="stepAfter" dataKey="remaining" stroke="var(--s1)" strokeWidth={2} fill="var(--s1)" fillOpacity={0.1} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Solde prévu sans l'achat (référence) et avec le scénario sélectionné. */
export function ScenarioChart({ baseline, scenario, label, height = 300 }: { baseline: { date: string; balance: number }[]; scenario: { date: string; balance: number }[]; label: string; height?: number }) {
  const step = Math.max(1, Math.ceil(baseline.length / 360));
  const data = baseline
    .map((b, i) => ({ date: b.date, base: b.balance, scen: scenario[i]?.balance }))
    .filter((_, i) => i % step === 0 || i === baseline.length - 1);
  const min = Math.min(...data.map((d) => Math.min(d.base, d.scen ?? d.base)));
  return (
    <div>
      <div className="mb-3"><Legend items={[{ label: "Sans l'achat", color: "var(--axis)" }, { label: `Avec l'achat — ${label}`, color: "var(--s1)" }]} /></div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" {...AXIS} tickFormatter={(d) => fdate(String(d)).slice(3)} minTickGap={48} />
          <YAxis {...AXIS} axisLine={false} width={52} tickFormatter={(v) => compact(v)} />
          {min < 0 && <ReferenceLine y={0} stroke="var(--critical)" strokeWidth={1} />}
          <Tooltip
            cursor={{ stroke: "var(--axis)" }}
            content={({ active, payload, label: l }) =>
              active && payload?.length ? (
                <TipBox
                  title={fdate(String(l), "day")}
                  rows={[
                    { label: "Sans l'achat", value: eur(Number(payload[0]?.payload.base)), color: "var(--axis)" },
                    { label: "Avec l'achat", value: eur(Number(payload[0]?.payload.scen)), color: "var(--s1)" },
                    { label: "Écart", value: eur(Number(payload[0]?.payload.scen) - Number(payload[0]?.payload.base)) },
                  ]}
                />
              ) : null
            }
          />
          <Line type="monotone" dataKey="base" stroke="var(--axis)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
          <Area type="monotone" dataKey="scen" stroke="var(--s1)" strokeWidth={2} fill="var(--s1)" fillOpacity={0.08} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
