import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { CheckCircle2, ExternalLink, KeyRound, Landmark, Link2, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, qs, useApi } from "../lib/api";
import { eur, fdate } from "../lib/format";
import { useRefData } from "../lib/refdata";
import { Badge, Button, Card, Empty, ErrorBox, Field, IconButton, Loading, Modal, PageHeader } from "../components/ui";

interface ProviderField { key: string; label: string; secret?: boolean; multiline?: boolean; is_set: boolean; value: string | null }
interface ProviderInfo { key: string; label: string; configured: boolean; fields: ProviderField[] }
interface Institution { id: string; name: string; country: string; logo: string | null; max_days: number | null }
interface Connection {
  id: number; provider: string; institution_name: string; country: string; status: string;
  valid_until: string | null; last_sync: string | null; last_error: string | null;
  accounts: { id: number; name: string; iban: string | null; balance: number }[];
}

const STATUS: Record<string, { label: string; tone: "good" | "warning" | "critical" | "neutral" }> = {
  linked: { label: "Connectée", tone: "good" },
  pending: { label: "En attente de consentement", tone: "warning" },
  expired: { label: "Consentement expiré", tone: "critical" },
  error: { label: "Erreur", tone: "critical" },
};

const COUNTRIES = { FR: "France", BE: "Belgique", LU: "Luxembourg", DE: "Allemagne", ES: "Espagne", IT: "Italie", NL: "Pays-Bas", PT: "Portugal", IE: "Irlande", LT: "Lituanie (Revolut)" };

export function BanksPage() {
  const [params, setParams] = useSearchParams();
  const { reload: reloadRef } = useRefData();
  const { data: prov, reload: reloadProv } = useApi<{ providers: ProviderInfo[]; redirect_url: string }>("/api/banking/providers");
  const { data: conns, reload } = useApi<Connection[]>("/api/banking/connections");
  const [configuring, setConfiguring] = useState<ProviderInfo | null>(null);
  const [picker, setPicker] = useState<ProviderInfo | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const flashError = params.get("error");
  const linked = params.get("linked");

  useEffect(() => {
    if (linked) reloadRef();
  }, [linked, reloadRef]);

  const sync = async (c: Connection) => {
    setBusy(c.id);
    try {
      await api.post(`/api/banking/connections/${c.id}/sync`);
      await reload();
      reloadRef();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (c: Connection) => {
    if (!window.confirm(`Supprimer la connexion ${c.institution_name} ? Les comptes et opérations déjà importés sont conservés.`)) return;
    await api.del(`/api/banking/connections/${c.id}`);
    reload();
  };

  return (
    <div>
      <PageHeader title="Connexions bancaires" subtitle="Accès en lecture seule via Open Banking (DSP2) : Pactole ne peut jamais initier de paiement." />
      {flashError && <div className="mb-4"><ErrorBox message={flashError} /></div>}
      {linked && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-xl bg-[color-mix(in_srgb,var(--good)_12%,transparent)] px-4 py-3 text-sm text-good-ink">
          <span className="flex items-center gap-2"><CheckCircle2 size={16} /> Banque reliée, première synchronisation effectuée.</span>
          <button onClick={() => setParams({})}>OK</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {!prov ? <Loading /> : prov.providers.map((p) => (
          <Card key={p.key} title={p.label} action={p.configured ? <Badge tone="good">Configuré</Badge> : <Badge>À configurer</Badge>}>
            {p.key === "enablebanking" ? (
              <div className="space-y-2 text-sm text-ink-2">
                <p><span className="font-medium text-ink">Recommandé pour Revolut.</span> Agrégateur agréé, gratuit pour relier vos propres comptes.</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Créez un compte sur <a className="text-accent-ink hover:underline" href="https://enablebanking.com/sign-in/" target="_blank" rel="noreferrer">enablebanking.com</a> puis une application en environnement <em>Production</em>.</li>
                  <li>URL de redirection autorisée : <code className="num rounded bg-surface-2 px-1.5 py-0.5 text-xs break-all text-ink">{prov.redirect_url}</code></li>
                  <li>Téléchargez la clé privée générée (.pem) et activez l'application en reliant vos propres comptes.</li>
                  <li>Collez l'identifiant d'application et la clé ci-dessous.</li>
                </ol>
              </div>
            ) : (
              <p className="text-sm text-ink-2">GoCardless (ex-Nordigen) n'accepte plus de nouvelles inscriptions : à utiliser uniquement si vous disposez déjà de clés d'API.</p>
            )}
            <div className="mt-4 flex gap-2">
              <Button icon={KeyRound} onClick={() => setConfiguring(p)}>Identifiants</Button>
              <Button variant="primary" icon={Link2} disabled={!p.configured} onClick={() => setPicker(p)}>Relier une banque</Button>
            </div>
          </Card>
        ))}
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Banques reliées</h2>
      {!conns ? <Loading /> : conns.length === 0 ? (
        <Card><Empty title="Aucune banque reliée" icon={Landmark}>Configurez un fournisseur puis reliez Revolut. Vous serez redirigé vers l'application Revolut pour valider l'accès.</Empty></Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {conns.map((c) => (
            <Card key={c.id} title={c.institution_name} action={<Badge tone={STATUS[c.status]?.tone}>{STATUS[c.status]?.label ?? c.status}</Badge>}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-xs text-muted">Dernière synchro</div>{c.last_sync ? new Date(c.last_sync + "Z").toLocaleString("fr-FR") : "—"}</div>
                <div><div className="text-xs text-muted">Consentement valable jusqu'au</div>{fdate(c.valid_until)}</div>
              </div>
              {c.last_error && <div className="mt-3"><ErrorBox message={c.last_error} /></div>}
              <ul className="mt-3 divide-y divide-line">
                {c.accounts.map((a) => (
                  <li key={a.id} className="flex justify-between py-2 text-sm">
                    <span>{a.name}<span className="num ml-2 text-xs text-muted">{a.iban}</span></span>
                    <span className="num font-medium">{eur(a.balance)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" icon={RefreshCw} loading={busy === c.id} onClick={() => sync(c)} disabled={c.status === "pending"}>Synchroniser</Button>
                {(c.status === "expired" || c.status === "error") && prov && (
                  <Button size="sm" variant="primary" icon={Link2} onClick={() => setPicker(prov.providers.find((p) => p.key === c.provider) ?? null)}>Renouveler</Button>
                )}
                <span className="flex-1" />
                <IconButton icon={Trash2} label="Supprimer la connexion" tone="danger" onClick={() => remove(c)} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {configuring && <ConfigModal provider={configuring} onClose={() => { setConfiguring(null); reloadProv(); }} />}
      {picker && <InstitutionPicker provider={picker} onClose={() => setPicker(null)} />}
    </div>
  );
}

function ConfigModal({ provider, onClose }: { provider: ProviderInfo; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(provider.fields.map((f) => [f.key, f.value ?? ""])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/banking/providers/${provider.key}`, values);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Identifiants — ${provider.label}`} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={saving} onClick={save}>Enregistrer</Button></>}>
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      <div className="space-y-4">
        {provider.fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.secret ? (f.is_set ? "Déjà enregistré (chiffré). Laissez vide pour conserver." : "Stocké chiffré dans la base.") : undefined}>
            {f.multiline ? (
              <textarea className="input num min-h-[160px] text-xs" placeholder={f.is_set ? "••••••••" : "-----BEGIN PRIVATE KEY-----"} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            ) : (
              <input className="input num" type={f.secret ? "password" : "text"} placeholder={f.is_set && f.secret ? "••••••••" : ""} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function InstitutionPicker({ provider, onClose }: { provider: ProviderInfo; onClose: () => void }) {
  const [country, setCountry] = useState("FR");
  const [q, setQ] = useState("Revolut");
  const { data, error, loading } = useApi<Institution[]>(`/api/banking/institutions${qs({ provider: provider.key, country })}`);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = (data ?? []).filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));

  const connect = async (i: Institution) => {
    setConnecting(i.id);
    setErr(null);
    try {
      const r = await api.post<{ url: string }>("/api/banking/connect", { provider: provider.key, institution_id: i.id, institution_name: i.name, country });
      window.location.href = r.url;
    } catch (e) {
      setErr((e as Error).message);
      setConnecting(null);
    }
  };

  return (
    <Modal open onClose={onClose} title="Choisir la banque">
      <div className="mb-3 flex gap-2">
        <select className="input w-40" value={country} onChange={(e) => setCountry(e.target.value)}>
          {Object.entries(COUNTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative flex-1">
          <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" autoFocus />
        </div>
      </div>
      {(error || err) && <div className="mb-3"><ErrorBox message={error || err || ""} /></div>}
      {loading ? <Loading /> : (
        <ul className="scroll-thin max-h-[50vh] divide-y divide-line overflow-y-auto">
          {list.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2.5">
              {i.logo ? <img src={i.logo} alt="" className="h-8 w-8 rounded-lg bg-white object-contain" /> : <Landmark size={20} className="text-muted" />}
              <span className="flex-1 text-sm font-medium">{i.name}</span>
              <Button size="sm" variant="primary" icon={ExternalLink} loading={connecting === i.id} onClick={() => connect(i)}>Autoriser</Button>
            </li>
          ))}
          {list.length === 0 && <Empty title="Aucune banque trouvée">Revolut peut être listé sous un autre pays (ex. Lituanie) selon votre IBAN.</Empty>}
        </ul>
      )}
    </Modal>
  );
}
