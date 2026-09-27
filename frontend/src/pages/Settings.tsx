import { useState, type FormEvent } from "react";
import { Database, KeyRound, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { api, useApi } from "../lib/api";
import { useRefData } from "../lib/refdata";
import type { Category, Rule } from "../lib/types";
import { fileSize } from "../components/Docs";
import { CrudModal, type FieldDef } from "../components/Form";
import { Badge, Button, Card, CategoryIcon, ErrorBox, Field, ICON_NAMES, IconButton, PageHeader, Segmented } from "../components/ui";

const KINDS = { expense: "Dépense", income: "Revenu", transfer: "Mouvement interne" };

export function SettingsPage() {
  const { categories, catById, reload } = useRefData();
  const { data: rules, reload: reloadRules } = useApi<Rule[]>("/api/categories/rules");
  const { data: info } = useApi<{ version: string; database: string; public_url: string; sync_hour: number; uploads_bytes: number; disk_free_bytes: number }>("/api/admin/info");
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense");
  const [rule, setRule] = useState({ pattern: "", category_id: "" });
  const [pwd, setPwd] = useState({ current_password: "", new_password: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const catFields: FieldDef[] = [
    { key: "name", label: "Nom", required: true },
    { key: "kind", label: "Type", type: "select", options: KINDS, required: true },
    { key: "icon", label: "Icône", type: "select", options: ICON_NAMES.map((i) => ({ value: i, label: i })), required: true },
    { key: "color", label: "Couleur", type: "color" },
    { key: "budget_monthly", label: "Budget mensuel", type: "number" },
  ];

  const addRule = async (e: FormEvent) => {
    e.preventDefault();
    await api.post("/api/categories/rules", { pattern: rule.pattern, category_id: Number(rule.category_id), priority: 20 });
    setRule({ pattern: "", category_id: rule.category_id });
    reloadRules();
  };

  const changePwd = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await api.post("/api/auth/password", pwd);
      setPwd({ current_password: "", new_password: "" });
      setMsg("Mot de passe modifié.");
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const delCat = async (c: Category) => {
    if (!window.confirm(`Supprimer la catégorie « ${c.name} » ? Les opérations associées deviendront non catégorisées.`)) return;
    await api.del(`/api/categories/${c.id}`);
    reload();
  };

  return (
    <div>
      <PageHeader title="Paramètres" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Catégories" action={<div className="flex items-center gap-2"><Segmented value={kind} onChange={setKind} options={[{ value: "expense", label: "Dépenses" }, { value: "income", label: "Revenus" }, { value: "transfer", label: "Internes" }]} /><IconButton icon={Plus} label="Ajouter" onClick={() => setEdit({ name: "", kind, icon: "tag", color: "#2a78d6", budget_monthly: "" })} /></div>}>
          <ul className="divide-y divide-line">
            {categories.filter((c) => c.kind === kind).map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <CategoryIcon icon={c.icon} color={c.color} />
                <span className="flex-1 text-sm">{c.name}</span>
                <IconButton icon={Pencil} label="Modifier" onClick={() => setEdit({ ...c })} />
                <IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={() => delCat(c)} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Règles de catégorisation">
          <form onSubmit={addRule} className="mb-4 flex flex-wrap gap-2">
            <input className="input flex-1" placeholder="Mot-clé du libellé (ex. « boulangerie »)" value={rule.pattern} onChange={(e) => setRule({ ...rule, pattern: e.target.value })} required minLength={2} />
            <select className="input w-48" value={rule.category_id} onChange={(e) => setRule({ ...rule, category_id: e.target.value })} required>
              <option value="">Catégorie…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button type="submit" icon={Plus}>Ajouter</Button>
          </form>
          <div className="scroll-thin max-h-[380px] overflow-y-auto">
            <table className="table">
              <tbody>
                {(rules ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="num text-[13px]">{r.pattern}{r.priority < 100 && <Badge tone="accent">perso</Badge>}</td>
                    <td className="text-ink-2">{catById.get(r.category_id)?.name}</td>
                    <td className="w-10"><IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={async () => { await api.del(`/api/categories/rules/${r.id}`); reloadRules(); }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><KeyRound size={16} />Mot de passe</span>}>
          <form onSubmit={changePwd} className="space-y-3">
            {err && <ErrorBox message={err} />}
            {msg && <div className="text-sm text-good-ink">{msg}</div>}
            <Field label="Mot de passe actuel"><input className="input" type="password" autoComplete="current-password" value={pwd.current_password} onChange={(e) => setPwd({ ...pwd, current_password: e.target.value })} required /></Field>
            <Field label="Nouveau mot de passe"><input className="input" type="password" autoComplete="new-password" minLength={8} value={pwd.new_password} onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })} required /></Field>
            <Button type="submit">Modifier</Button>
          </form>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Database size={16} />Données & sauvegarde</span>}>
          {info && (
            <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted">Version</dt><dd>{info.version}</dd></div>
              <div><dt className="text-xs text-muted">Base de données</dt><dd>{info.database}</dd></div>
              <div><dt className="text-xs text-muted">Synchro automatique</dt><dd>chaque jour à {String(info.sync_hour).padStart(2, "0")}:07</dd></div>
              <div><dt className="text-xs text-muted">Justificatifs</dt><dd>{fileSize(info.uploads_bytes)} · {fileSize(info.disk_free_bytes)} libres</dd></div>
              <div className="col-span-2"><dt className="text-xs text-muted">URL publique</dt><dd className="num break-all">{info.public_url}</dd></div>
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            {info?.database === "sqlite" && <a href="/api/admin/backup"><Button icon={Database}>Télécharger une sauvegarde</Button></a>}
            <a href="/api/transactions/export.csv"><Button>Exporter les opérations (CSV)</Button></a>
            <Button icon={Sparkles} variant="ghost" onClick={async () => { try { await api.post("/api/admin/demo"); window.location.href = "/"; } catch (e) { alert((e as Error).message); } }}>Charger la démo</Button>
          </div>
          <p className="mt-3 text-xs text-muted">Pour une sauvegarde complète, sauvegardez aussi le volume Docker <code>/data</code> (base + justificatifs + clé de chiffrement).</p>
        </Card>
      </div>
      <CrudModal open={!!edit} onClose={() => setEdit(null)} onSaved={() => reload()} endpoint="/api/categories" title={edit?.id ? "Modifier la catégorie" : "Nouvelle catégorie"} fields={catFields} initial={edit ?? {}} />
    </div>
  );
}
