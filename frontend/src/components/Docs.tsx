import { useRef, useState } from "react";
import { Download, Eye, FileText, Image as ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { api, qs, useApi } from "../lib/api";
import { DOC_TYPES, fdate } from "../lib/format";
import type { Doc } from "../lib/types";
import { Button, Empty, ErrorBox, IconButton, Modal, cx } from "./ui";

export function fileSize(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export async function uploadDoc(file: File, meta: { doc_type: string; title?: string; year?: number | null; owner_type?: string; owner_id?: number }) {
  const fd = new FormData();
  fd.append("file", file);
  for (const [k, v] of Object.entries(meta)) if (v !== undefined && v !== null && v !== "") fd.append(k, String(v));
  return api.post<Doc>("/api/documents", fd);
}

export function DocIcon({ mime }: { mime: string }) {
  const Icon = mime.startsWith("image/") ? ImageIcon : FileText;
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
      <Icon size={18} />
    </span>
  );
}

export function DocList({ docs, onDelete }: { docs: Doc[]; onDelete?: (d: Doc) => void }) {
  return (
    <ul className="divide-y divide-line">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-3 py-2.5">
          <DocIcon mime={d.mime} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{d.title}</div>
            <div className="text-xs text-muted">
              {DOC_TYPES[d.doc_type] ?? d.doc_type} · {fileSize(d.size)} · ajouté le {fdate(d.created_at)}
            </div>
          </div>
          <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer"><IconButton icon={Eye} label="Ouvrir" /></a>
          <a href={`/api/documents/${d.id}/file?download=true`}><IconButton icon={Download} label="Télécharger" /></a>
          {onDelete && <IconButton icon={Trash2} label="Supprimer" tone="danger" onClick={() => onDelete(d)} />}
        </li>
      ))}
    </ul>
  );
}

/** Bouton trombone : justificatifs rattachés à un élément (fiche de paie, ticket, contrat…). */
export function DocsButton({ ownerType, ownerId, docType, count, year, title, onChange }: { ownerType: string; ownerId: number; docType: string; count?: number; year?: number; title: string; onChange?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Justificatifs"
        className={cx("inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs transition-colors hover:bg-surface-2", count ? "text-accent-ink" : "text-muted")}
      >
        <Paperclip size={15} />
        {count ? count : null}
      </button>
      {open && <DocsModal ownerType={ownerType} ownerId={ownerId} docType={docType} year={year} title={title} onClose={() => { setOpen(false); onChange?.(); }} />}
    </>
  );
}

function DocsModal({ ownerType, ownerId, docType, year, title, onClose }: { ownerType: string; ownerId: number; docType: string; year?: number; title: string; onClose: () => void }) {
  const { data, reload } = useApi<Doc[]>(`/api/documents${qs({ owner_type: ownerType, owner_id: ownerId })}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files)) await uploadDoc(f, { doc_type: docType, title: f.name, year, owner_type: ownerType, owner_id: ownerId });
      await reload();
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

  return (
    <Modal open onClose={onClose} title={`Justificatifs — ${title}`}>
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
        className="mb-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-2"
      >
        <Upload size={20} className="text-muted" />
        Glissez un PDF ou une photo ici
        <input ref={input} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => onFiles(e.target.files)} />
        <Button size="sm" icon={Paperclip} loading={busy} onClick={() => input.current?.click()}>Choisir un fichier</Button>
      </div>
      {data && data.length === 0 && <Empty title="Aucun justificatif">Ajoutez la version PDF ou une photo : elle sera incluse dans l'export du dossier fiscal.</Empty>}
      {data && data.length > 0 && <DocList docs={data} onDelete={remove} />}
    </Modal>
  );
}
