import { useRef, useState } from "react";
import { Link } from "react-router";
import { FileUp, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { ACCOUNT_TYPES, eur, fdate } from "../lib/format";
import { useRefData } from "../lib/refdata";
import type { Account } from "../lib/types";
import { CrudModal, type FieldDef } from "../components/Form";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, PageHeader, cx } from "../components/ui";

const FIELDS: FieldDef[] = [
  { key: "name", label: "Nom", required: true, full: true },
  { key: "bank_name", label: "Banque" },
  { key: "type", label: "Type", type: "select", options: ACCOUNT_TYPES, required: true },
  { key: "balance", label: "Solde actuel", type: "number", required: true, hint: "Ignoré pour un compte synchronisé." },
  { key: "currency", label: "Devise", required: true },
  { key: "iban", label: "IBAN", full: true },
  { key: "color", label: "Couleur", type: "color" },
  { key: "include_in_total", label: "Inclure dans les totaux", type: "toggle" },
  { key: "archived", label: "Archivé", type: "toggle" },
];

const EMPTY = { name: "", bank_name: "", type: "courant", balance: 0, currency: "EUR", iban: "", color: "#2a78d6", include_in_total: true, archived: false };

export function AccountsPage() {
  const { accounts, reload } = useRefData();
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [importing, setImporting] = useState<Account | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const total = accounts.filter((a) => a.include_in_total && !a.archived).reduce((s, a) => s + a.balance, 0);

  const remove = async (a: Account) => {
    if (!window.confirm(`Supprimer le compte « ${a.name} » et ses ${a.tx_count} opérations ?`)) return;
    await api.del(`/api/accounts/${a.id}`);
    reload();
  };

  const onImport = async (file: File | undefined) => {
    if (!file || !importing) return;
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api.post<{ format: string; inserted: number; total: number; balance: number | null }>(`/api/accounts/${importing.id}/import`, fd);
      setResult(`${importing.name} : ${r.inserted} opération(s) importée(s) sur ${r.total} (format ${r.format.toUpperCase()})${r.balance !== null ? `, solde mis à jour : ${eur(r.balance)}` : ""}.`);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div>
      <PageHeader
        title="Comptes"
        subtitle={<>Total : <span className="num font-semibold text-ink">{eur(total)}</span></>}
        actions={
          <>
            <Link to="/banques"><Button icon={Landmark}>Relier une banque</Button></Link>
            <Button variant="primary" icon={Plus} onClick={() => setEdit(EMPTY)}>Compte manuel</Button>
          </>
        }
      />
      <input ref={fileInput} type="file" accept=".csv,.ofx,.qfx,.txt" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
      {result && <div className="mb-4 rounded-xl bg-surface-2 px-4 py-3 text-sm">{result}</div>}
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      {accounts.length === 0 ? (
        <Card><Empty title="Aucun compte">Reliez Revolut via Open Banking ou créez un compte manuel puis importez un relevé CSV / OFX.</Empty></Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => (
            <div key={a.id} className={cx("card fade-in flex flex-col p-5", a.archived && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: a.color }} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.name}</div>
                    <div className="text-xs text-muted">{a.bank_name || "—"} · {ACCOUNT_TYPES[a.type]}</div>
                  </div>
                </div>
                <div className="flex shrink-0">
                  <IconButton icon={Pencil} label="Modifier" onClick={() => setEdit({ ...a })} />
                  <IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={() => remove(a)} />
                </div>
              </div>
              <div className={cx("mt-4 text-3xl font-semibold tracking-tight", a.balance < 0 && "text-critical-ink")}>
                {new Intl.NumberFormat("fr-FR", { style: "currency", currency: a.currency }).format(a.balance)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                {a.connection_id ? <Badge tone="accent"><Landmark size={11} /> Synchronisé</Badge> : <Badge>Manuel</Badge>}
                {!a.include_in_total && <Badge>Hors totaux</Badge>}
                <span>maj {fdate(a.balance_date)}</span>
              </div>
              {a.iban && <div className="num mt-3 truncate text-xs text-ink-2">{a.iban}</div>}
              <div className="mt-auto flex gap-2 pt-4">
                <Link to={`/operations?account=${a.id}`} className="flex-1"><Button size="sm" className="w-full">{a.tx_count} opérations</Button></Link>
                <Button size="sm" icon={FileUp} onClick={() => { setImporting(a); fileInput.current?.click(); }}>Importer</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Card title="Importer un relevé" className="mt-6">
        <div className="grid gap-4 text-sm text-ink-2 md:grid-cols-3">
          <div><div className="font-medium text-ink">Revolut (CSV)</div>Application Revolut → compte → ⋯ → Relevé → format Excel/CSV. Le compte courant est isolé automatiquement des coffres.</div>
          <div><div className="font-medium text-ink">Banques françaises (CSV)</div>Colonnes date / libellé / montant ou débit / crédit détectées automatiquement (séparateur « ; », virgule décimale, encodage Windows).</div>
          <div><div className="font-medium text-ink">OFX / QFX</div>Format « Money » proposé par la plupart des banques. Les doublons sont ignorés à chaque réimport.</div>
        </div>
      </Card>

      <CrudModal
        open={!!edit}
        onClose={() => setEdit(null)}
        onSaved={() => reload()}
        endpoint="/api/accounts"
        title={edit?.id ? "Modifier le compte" : "Nouveau compte"}
        fields={FIELDS}
        initial={edit ?? EMPTY}
      />
    </div>
  );
}
