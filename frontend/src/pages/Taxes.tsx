import { useState } from "react";
import { Link } from "react-router";
import { FileDown, Info } from "lucide-react";
import { qs, useApi } from "../lib/api";
import { DOC_TYPES, eur, num } from "../lib/format";
import { Button, Card, Field, Loading, PageHeader, Stat } from "../components/ui";

interface Fiscal {
  year: number;
  payslips: { count: number; gross: number; net_taxable: number; income_tax: number; net_paid: number; months: number[]; employers: { employer: string; net_taxable: number; income_tax: number; count: number }[]; forfait_10: number };
  fuel: { total: number; professional: number; liters: number; count: number; vehicles: { vehicle: string; total: number; liters: number; count: number; km: number | null }[] };
  documents: Record<string, number>;
  documents_total: number;
  km_estimate: { km: number; fiscal_hp: number; vehicle: string | null; amount: number; label: string } | null;
  bareme_label: string;
}

export function TaxesPage() {
  const [year, setYear] = useState(new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0));
  const [kmPro, setKmPro] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const { data: vehicles } = useApi<{ id: number; name: string; fiscal_hp: number }[]>("/api/vehicles");
  const { data } = useApi<Fiscal>(`/api/fiscal/${year}${qs({ km_pro: kmPro, vehicle_id: vehicleId })}`);
  const missing = data ? Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !data.payslips.months.includes(m) && new Date(year, m - 1, 28) < new Date()) : [];

  return (
    <div>
      <PageHeader
        title="Impôts"
        subtitle="Préparez votre déclaration de revenus et gardez un dossier prêt en cas de contrôle."
        actions={
          <>
            <select className="input w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => <option key={y} value={y}>Revenus {y}</option>)}
            </select>
            <a href={`/api/documents/fiscal/${year}.zip`}><Button variant="primary" icon={FileDown}>Dossier fiscal {year}</Button></a>
          </>
        }
      />
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            <Stat label="Net imposable cumulé" value={eur(data.payslips.net_taxable, { decimals: false })} hint={`${data.payslips.count}/12 fiches de paie`} />
            <Stat label="Impôt prélevé à la source" value={eur(data.payslips.income_tax, { decimals: false })} />
            <Stat label="Carburant" value={eur(data.fuel.total, { decimals: false })} hint={`${data.fuel.count} tickets · ${num(data.fuel.liters, 0)} L`} />
            <Stat label="Justificatifs archivés" value={String(data.documents_total)} hint={Object.entries(data.documents).map(([k, v]) => `${v} ${DOC_TYPES[k]?.toLowerCase() ?? k}`).join(" · ") || "aucun"} />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="Salaires à déclarer (case 1AJ)">
              <table className="table">
                <thead><tr><th>Employeur</th><th className="text-right">Fiches</th><th className="text-right">Net imposable</th><th className="text-right">PAS</th></tr></thead>
                <tbody>
                  {data.payslips.employers.map((e) => (
                    <tr key={e.employer}><td>{e.employer}</td><td className="num text-right">{e.count}</td><td className="num text-right font-medium">{eur(e.net_taxable)}</td><td className="num text-right">{eur(e.income_tax)}</td></tr>
                  ))}
                  {data.payslips.employers.length === 0 && <tr><td colSpan={4} className="text-center text-muted">Aucune fiche de paie pour {year}</td></tr>}
                </tbody>
              </table>
              {missing.length > 0 && (
                <p className="mt-3 text-sm text-ink-2">
                  Mois sans fiche : {missing.map((m) => new Date(year, m - 1, 1).toLocaleDateString("fr-FR", { month: "short" })).join(", ")} — <Link to="/paie" className="text-accent-ink hover:underline">compléter</Link>
                </p>
              )}
              <p className="mt-3 flex gap-2 text-xs text-muted"><Info size={14} className="shrink-0" /> Comparez avec le montant prérempli par l'administration (cumul net imposable de décembre).</p>
            </Card>

            <Card title="Frais réels : estimation">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Km professionnels dans l'année">
                  <input className="input num" inputMode="numeric" placeholder="ex. 9 200" value={kmPro} onChange={(e) => setKmPro(e.target.value.replace(/\D/g, ""))} />
                </Field>
                <Field label="Véhicule">
                  <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">Par défaut</option>
                    {(vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.name} ({v.fiscal_hp} CV)</option>)}
                  </select>
                </Field>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-surface-2 p-4">
                  <div className="text-xs text-muted">Déduction forfaitaire 10 %</div>
                  <div className="num mt-1 text-xl font-semibold">{eur(data.payslips.forfait_10, { decimals: false })}</div>
                </div>
                <div className="rounded-xl bg-surface-2 p-4">
                  <div className="text-xs text-muted">Barème kilométrique</div>
                  <div className="num mt-1 text-xl font-semibold">{data.km_estimate ? eur(data.km_estimate.amount, { decimals: false }) : "—"}</div>
                  {data.km_estimate && <div className="text-xs text-muted">{data.km_estimate.vehicle ?? "véhicule"} · {data.km_estimate.fiscal_hp} CV</div>}
                </div>
              </div>
              {data.km_estimate && (
                <p className="mt-3 text-sm">
                  {data.km_estimate.amount > data.payslips.forfait_10
                    ? <>Les frais réels semblent <span className="font-semibold text-good-ink">plus avantageux</span> (+{eur(data.km_estimate.amount - data.payslips.forfait_10, { decimals: false })} de déduction, hors autres frais).</>
                    : <>La déduction forfaitaire de 10 % reste plus avantageuse.</>}
                </p>
              )}
              <p className="mt-3 flex gap-2 text-xs text-muted"><Info size={14} className="shrink-0" /> {data.bareme_label}. Le barème couvre carburant, entretien et dépréciation : on ne cumule pas avec les tickets de carburant. Plafonds forfait 10 % : revenus 2024.</p>
            </Card>
          </div>

          <Card title="Carburant par véhicule" className="mt-5">
            <table className="table">
              <thead><tr><th>Véhicule</th><th className="text-right">Tickets</th><th className="text-right">Litres</th><th className="text-right">Km parcourus</th><th className="text-right">Montant</th></tr></thead>
              <tbody>
                {data.fuel.vehicles.map((v) => (
                  <tr key={v.vehicle}><td>{v.vehicle}</td><td className="num text-right">{v.count}</td><td className="num text-right">{num(v.liters, 0)}</td><td className="num text-right">{v.km ? v.km.toLocaleString("fr-FR") : "—"}</td><td className="num text-right font-medium">{eur(v.total)}</td></tr>
                ))}
                {data.fuel.vehicles.length === 0 && <tr><td colSpan={5} className="text-center text-muted">Aucun ticket pour {year}</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
