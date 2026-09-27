import { useRef, useState } from "react";
import { Car, FileDown, FolderLock, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { api, qs, useApi } from "../lib/api";
import { DOC_TYPES, FUEL_TYPES, eur, fdate, monthLabel, num, todayISO } from "../lib/format";
import type { Doc } from "../lib/types";
import { SimpleBars } from "../components/Charts";
import { DocList, DocsButton, uploadDoc } from "../components/Docs";
import { CrudModal, type FieldDef } from "../components/Form";
import { Badge, Button, Card, Empty, ErrorBox, Field, IconButton, Loading, PageHeader, Stat, cx } from "../components/ui";

async function confirmDelete(url: string, what: string, after: () => void) {
  if (!window.confirm(`Supprimer ${what} ?`)) return;
  await api.del(url);
  after();
}

const years = () => Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

// ── Fiches de paie ───────────────────────────────────────────────────────────
interface Payslip { id: number; employer: string; period: string; gross: number; net_before_tax: number; net_taxable: number; income_tax: number; net_paid: number; hours: number | null; bonus: number; paid_leave_balance: number | null; notes: string | null; documents: number }
interface PayslipSummary { years: { year: number; gross: number; net_taxable: number; net_paid: number; income_tax: number; count: number }[]; series: { period: string; net_paid: number }[] }

export function PayslipsPage() {
  const { data, reload } = useApi<Payslip[]>("/api/payslips");
  const { data: summary, reload: reloadSummary } = useApi<PayslipSummary>("/api/payslips/summary");
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const last = data?.[0];
  const fields: FieldDef[] = [
    { key: "employer", label: "Employeur", required: true },
    { key: "period", label: "Mois", type: "month", required: true },
    { key: "gross", label: "Salaire brut", type: "number", required: true },
    { key: "net_before_tax", label: "Net à payer avant impôt", type: "number", required: true },
    { key: "net_taxable", label: "Net imposable", type: "number", required: true, hint: "Sert au cumul annuel pour la déclaration." },
    { key: "income_tax", label: "Prélèvement à la source", type: "number" },
    { key: "net_paid", label: "Net versé", type: "number", required: true },
    { key: "bonus", label: "Primes du mois", type: "number" },
    { key: "hours", label: "Heures travaillées", type: "number" },
    { key: "paid_leave_balance", label: "Solde de congés (jours)", type: "number" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const nextMonth = last ? new Date(new Date(last.period + "T12:00").setMonth(new Date(last.period + "T12:00").getMonth() + 1)).toISOString().slice(0, 7) : todayISO().slice(0, 7);
  const empty = last
    ? { ...last, id: undefined, period: nextMonth, bonus: 0, notes: "" }
    : { employer: "", period: todayISO().slice(0, 7), gross: "", net_before_tax: "", net_taxable: "", income_tax: 0, net_paid: "", bonus: 0, hours: "", paid_leave_balance: "", notes: "" };
  const refresh = () => { reload(); reloadSummary(); };
  const current = summary?.years[0];

  return (
    <div>
      <PageHeader title="Fiches de paie" subtitle="Archivez vos bulletins (PDF) et suivez vos cumuls annuels." actions={<Button variant="primary" icon={Plus} onClick={() => setEdit(empty)}>Ajouter une fiche</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Stat label={`Net imposable ${current?.year ?? ""}`} value={eur(current?.net_taxable ?? 0, { decimals: false })} hint={`${current?.count ?? 0} fiche(s)`} />
        <Stat label="Net versé cumulé" value={eur(current?.net_paid ?? 0, { decimals: false })} />
        <Stat label="Prélèvement à la source" value={eur(current?.income_tax ?? 0, { decimals: false })} />
        <Stat label="Dernier net versé" value={eur(last?.net_paid ?? 0)} hint={last ? monthLabel(last.period.slice(0, 7), false) : undefined} />
      </div>
      {summary && summary.series.length > 1 && (
        <Card title="Net versé par mois" className="mb-5">
          <SimpleBars data={summary.series.slice(-24)} xKey="period" yKey="net_paid" label="Net versé" xFormat={(p) => monthLabel(p)} />
        </Card>
      )}
      <Card pad={false} title="Bulletins">
        {!data ? <Loading /> : data.length === 0 ? <Empty title="Aucune fiche de paie">Ajoutez vos bulletins pour suivre vos revenus et préparer la déclaration.</Empty> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="table">
              <thead><tr><th>Période</th><th className="hidden sm:table-cell">Employeur</th><th className="text-right">Brut</th><th className="hidden text-right md:table-cell">Net imposable</th><th className="hidden text-right md:table-cell">PAS</th><th className="text-right">Net versé</th><th /></tr></thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium capitalize">{monthLabel(p.period.slice(0, 7), false)} {p.bonus > 0 && <Badge tone="accent">prime</Badge>}</td>
                    <td className="hidden text-ink-2 sm:table-cell">{p.employer}</td>
                    <td className="num text-right">{eur(p.gross)}</td>
                    <td className="num hidden text-right md:table-cell">{eur(p.net_taxable)}</td>
                    <td className="num hidden text-right text-ink-2 md:table-cell">{eur(p.income_tax)}</td>
                    <td className="num text-right font-semibold">{eur(p.net_paid)}</td>
                    <td className="whitespace-nowrap text-right">
                      <DocsButton ownerType="payslip" ownerId={p.id} docType="fiche_paie" count={p.documents} year={Number(p.period.slice(0, 4))} title={`Paie ${monthLabel(p.period.slice(0, 7), false)}`} onChange={reload} />
                      <IconButton icon={Pencil} label="Modifier" onClick={() => setEdit({ ...p })} />
                      <IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={() => confirmDelete(`/api/payslips/${p.id}`, "cette fiche", refresh)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <CrudModal open={!!edit} onClose={() => setEdit(null)} onSaved={refresh} endpoint="/api/payslips" title={edit?.id ? "Modifier la fiche" : "Nouvelle fiche de paie"} fields={fields} initial={edit ?? empty} />
    </div>
  );
}

// ── Carburant ────────────────────────────────────────────────────────────────
interface Vehicle { id: number; name: string; plate: string | null; energy: string; fiscal_hp: number; electric: boolean; archived: boolean }
interface Fuel { id: number; vehicle_id: number | null; date: string; station: string; city: string | null; fuel_type: string; liters: number; price_per_liter: number | null; total: number; odometer: number | null; full_tank: boolean; professional: boolean; notes: string | null; consumption: number | null; documents: number }
interface FuelStats { year: number; total: number; liters: number; count: number; avg_price: number | null; avg_consumption: number | null; professional: number; months: { month: string; total: number }[] }

export function FuelPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: vehicles, reload: reloadV } = useApi<Vehicle[]>("/api/vehicles");
  const { data, reload } = useApi<Fuel[]>("/api/fuel");
  const { data: stats, reload: reloadS } = useApi<FuelStats>(`/api/fuel/stats?year=${year}`);
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [editV, setEditV] = useState<Record<string, unknown> | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const vName = new Map((vehicles ?? []).map((v) => [v.id, v.name]));
  const refresh = () => { reload(); reloadS(); };

  const fields: FieldDef[] = [
    { key: "date", label: "Date", type: "date", required: true },
    { key: "vehicle_id", label: "Véhicule", type: "select", options: (vehicles ?? []).map((v) => ({ value: v.id, label: v.name })) },
    { key: "station", label: "Station", required: true },
    { key: "city", label: "Ville" },
    { key: "fuel_type", label: "Carburant", type: "select", options: FUEL_TYPES, required: true },
    { key: "liters", label: "Litres", type: "number", required: true },
    { key: "total", label: "Montant TTC", type: "number", required: true },
    { key: "price_per_liter", label: "Prix au litre", type: "number", step: "0.001", hint: "Calculé si vide." },
    { key: "odometer", label: "Kilométrage compteur", type: "number", step: "1" },
    { key: "full_tank", label: "Plein complet", type: "toggle" },
    { key: "professional", label: "Trajet professionnel", type: "toggle" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
  const lastFuel = data?.[0];
  const empty = { date: todayISO(), vehicle_id: lastFuel?.vehicle_id ?? vehicles?.[0]?.id ?? "", station: "", city: "", fuel_type: lastFuel?.fuel_type ?? "gazole", liters: "", total: "", price_per_liter: "", odometer: "", full_tank: true, professional: false, notes: "" };
  const vFields: FieldDef[] = [
    { key: "name", label: "Nom", required: true },
    { key: "plate", label: "Immatriculation" },
    { key: "energy", label: "Énergie", type: "select", options: FUEL_TYPES, required: true },
    { key: "fiscal_hp", label: "Puissance fiscale (CV)", type: "number", step: "1", required: true, hint: "Carte grise, rubrique P.6 — utilisée pour le barème kilométrique." },
    { key: "electric", label: "100 % électrique (+20 % barème)", type: "toggle" },
    { key: "archived", label: "Archivé", type: "toggle" },
  ];

  const onSaved = async (item: Fuel) => {
    if (pendingFile) {
      await uploadDoc(pendingFile, { doc_type: "ticket_carburant", title: `Ticket ${item.station} ${fdate(item.date)}`, year: Number(item.date.slice(0, 4)), owner_type: "fuel", owner_id: item.id });
      setPendingFile(null);
    }
    refresh();
  };

  const filtered = (data ?? []).filter((f) => f.date.startsWith(String(year)));

  return (
    <div>
      <PageHeader
        title="Carburant"
        subtitle="Tickets de station conservés comme justificatifs (frais réels, contrôle fiscal)."
        actions={
          <>
            <select className="input w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>{years().map((y) => <option key={y}>{y}</option>)}</select>
            <Button icon={Car} onClick={() => setEditV({ name: "", plate: "", energy: "gazole", fiscal_hp: 5, electric: false, archived: false })}>Véhicule</Button>
            <Button variant="primary" icon={Plus} onClick={() => setEdit(empty)}>Ticket</Button>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Stat label={`Dépense ${year}`} value={eur(stats?.total ?? 0, { decimals: false })} hint={`${stats?.count ?? 0} tickets · dont pro ${eur(stats?.professional ?? 0, { decimals: false })}`} />
        <Stat label="Volume" value={`${num(stats?.liters ?? 0, 0)} L`} />
        <Stat label="Prix moyen" value={stats?.avg_price ? `${num(stats.avg_price, 3)} €/L` : "—"} />
        <Stat label="Consommation moyenne" value={stats?.avg_consumption ? `${num(stats.avg_consumption, 1)} L/100` : "—"} hint="plein à plein" />
      </div>
      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Dépense mensuelle" className="xl:col-span-2">
          {stats && <SimpleBars data={stats.months} xKey="month" yKey="total" label="Carburant" xFormat={(m) => monthLabel(m)} color="var(--s2)" />}
        </Card>
        <Card title="Véhicules">
          {(vehicles ?? []).length === 0 ? <Empty title="Aucun véhicule" icon={Car} /> : (
            <ul className="divide-y divide-line">
              {vehicles!.map((v) => (
                <li key={v.id} className={cx("flex items-center gap-3 py-2.5", v.archived && "opacity-50")}>
                  <Car size={18} className="text-muted" />
                  <div className="flex-1"><div className="text-sm font-medium">{v.name}</div><div className="text-xs text-muted">{v.plate} · {v.fiscal_hp} CV · {FUEL_TYPES[v.energy]}</div></div>
                  <IconButton icon={Pencil} label="Modifier" onClick={() => setEditV({ ...v })} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card pad={false} title={`Tickets ${year}`}>
        {!data ? <Loading /> : filtered.length === 0 ? <Empty title="Aucun ticket">Ajoutez vos pleins et joignez la photo du ticket.</Empty> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="table">
              <thead><tr><th>Date</th><th>Station</th><th className="hidden md:table-cell">Véhicule</th><th className="text-right">Litres</th><th className="hidden text-right sm:table-cell">€/L</th><th className="hidden text-right lg:table-cell">Km</th><th className="hidden text-right lg:table-cell">L/100</th><th className="text-right">Total</th><th /></tr></thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id}>
                    <td className="num whitespace-nowrap">{fdate(f.date)}</td>
                    <td><div className="font-medium">{f.station}</div><div className="text-xs text-muted">{f.city}{f.professional && " · pro"}</div></td>
                    <td className="hidden text-ink-2 md:table-cell">{f.vehicle_id ? vName.get(f.vehicle_id) : "—"}</td>
                    <td className="num text-right">{num(f.liters)}</td>
                    <td className="num hidden text-right text-ink-2 sm:table-cell">{f.price_per_liter ? num(f.price_per_liter, 3) : "—"}</td>
                    <td className="num hidden text-right text-ink-2 lg:table-cell">{f.odometer?.toLocaleString("fr-FR") ?? "—"}</td>
                    <td className="num hidden text-right lg:table-cell">{f.consumption ? num(f.consumption, 1) : "—"}</td>
                    <td className="num text-right font-semibold">{eur(f.total)}</td>
                    <td className="whitespace-nowrap text-right">
                      <DocsButton ownerType="fuel" ownerId={f.id} docType="ticket_carburant" count={f.documents} year={Number(f.date.slice(0, 4))} title={`${f.station} ${fdate(f.date)}`} onChange={reload} />
                      <IconButton icon={Pencil} label="Modifier" onClick={() => setEdit({ ...f })} />
                      <IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={() => confirmDelete(`/api/fuel/${f.id}`, "ce ticket", refresh)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && (
        <FuelModal edit={edit} fields={fields} onClose={() => { setEdit(null); setPendingFile(null); }} onSaved={onSaved} file={pendingFile} setFile={setPendingFile} />
      )}
      <CrudModal open={!!editV} onClose={() => setEditV(null)} onSaved={reloadV} endpoint="/api/vehicles" title={editV?.id ? "Modifier le véhicule" : "Nouveau véhicule"} fields={vFields} initial={editV ?? {}} />
    </div>
  );
}

function FuelModal({ edit, fields, onClose, onSaved, file, setFile }: { edit: Record<string, unknown>; fields: FieldDef[]; onClose: () => void; onSaved: (f: Fuel) => void; file: File | null; setFile: (f: File | null) => void }) {
  // Le prix au litre est déduit du total si non saisi ; la photo du ticket est jointe après enregistrement.
  const withPrice: FieldDef[] = fields;
  return (
    <>
      <CrudModal<Fuel>
        open
        onClose={onClose}
        onSaved={onSaved}
        endpoint="/api/fuel"
        title={edit.id ? "Modifier le ticket" : "Nouveau ticket carburant"}
        fields={withPrice}
        initial={edit}
      />
      {!edit.id && (
        <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex justify-center px-4">
          <label className="card pointer-events-auto flex cursor-pointer items-center gap-2 px-4 py-2 text-sm shadow-lg">
            <Upload size={16} className="text-accent" />
            {file ? `Ticket joint : ${file.name}` : "Joindre la photo du ticket"}
            <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      )}
    </>
  );
}

// ── Coffre-fort de documents ─────────────────────────────────────────────────
export function DocumentsPage() {
  const [type, setType] = useState("");
  const [year, setYear] = useState<string>("");
  const [q, setQ] = useState("");
  const { data, reload } = useApi<Doc[]>(`/api/documents${qs({ doc_type: type, year, q })}`);
  const [uploadType, setUploadType] = useState("facture");
  const [uploadYear, setUploadYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files)) await uploadDoc(f, { doc_type: uploadType, title: f.name.replace(/\.[^.]+$/, ""), year: uploadYear });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (d: Doc) => {
    if (!window.confirm(`Supprimer « ${d.title} » ?`)) return;
    await api.del(`/api/documents/${d.id}`);
    reload();
  };

  const total = (data ?? []).reduce((s, d) => s + d.size, 0);

  return (
    <div>
      <PageHeader title="Coffre-fort" subtitle={`Tous vos justificatifs au même endroit${data ? ` · ${data.length} document(s), ${(total / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : ""}.`} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        <Card pad={false}>
          <div className="flex flex-wrap gap-2 border-b border-line p-3">
            <div className="relative min-w-[180px] flex-1">
              <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <input className="input pl-9" placeholder="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Tous les types</option>
              {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input w-auto" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">Toutes années</option>
              {years().map((y) => <option key={y}>{y}</option>)}
            </select>
          </div>
          <div className="px-4">
            {!data ? <Loading /> : data.length === 0 ? <Empty title="Aucun document" icon={FolderLock} /> : <DocList docs={data} onDelete={remove} />}
          </div>
        </Card>
        <div className="space-y-5">
          <Card title="Déposer des fichiers">
            {error && <div className="mb-3"><ErrorBox message={error} /></div>}
            <div className="space-y-3">
              <Field label="Type"><select className="input" value={uploadType} onChange={(e) => setUploadType(e.target.value)}>{Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Année fiscale"><select className="input" value={uploadYear} onChange={(e) => setUploadYear(Number(e.target.value))}>{years().map((y) => <option key={y}>{y}</option>)}</select></Field>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
                className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-2"
              >
                <Upload size={20} className="text-muted" />
                PDF, images, documents bureautiques
                <input ref={input} type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
                <Button size="sm" loading={busy} onClick={() => input.current?.click()}>Parcourir</Button>
              </div>
            </div>
          </Card>
          <Card title="Dossier fiscal">
            <p className="mb-3 text-sm text-ink-2">Archive ZIP de l'année : synthèse des fiches de paie et du carburant (CSV) + tous les justificatifs classés par type.</p>
            <div className="flex gap-2">
              <select className="input" value={uploadYear} onChange={(e) => setUploadYear(Number(e.target.value))}>{years().map((y) => <option key={y}>{y}</option>)}</select>
              <a href={`/api/documents/fiscal/${uploadYear}.zip`}><Button icon={FileDown}>ZIP</Button></a>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
