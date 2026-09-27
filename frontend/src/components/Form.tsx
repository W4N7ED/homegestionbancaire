import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { Button, ErrorBox, Field, Modal, Toggle, cx } from "./ui";

export type Option = { value: string | number; label: string };

export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "month" | "select" | "textarea" | "toggle" | "color" | "password";
  options?: Option[] | Record<string, string>;
  required?: boolean;
  step?: string;
  hint?: string;
  placeholder?: string;
  full?: boolean; // occupe toute la largeur
  nullable?: boolean; // "" -> null
  show?: (values: Record<string, unknown>) => boolean;
}

function toOptions(o: FieldDef["options"]): Option[] {
  if (!o) return [];
  return Array.isArray(o) ? o : Object.entries(o).map(([value, label]) => ({ value, label }));
}

export function formValue(def: FieldDef, raw: unknown): unknown {
  if (def.type === "toggle") return Boolean(raw);
  if (raw === "" || raw === undefined || raw === null) return def.nullable || !def.required ? null : raw;
  if (def.type === "number") return Number(String(raw).replace(",", "."));
  if (def.type === "month") return `${raw}-01`;
  if (def.type === "select" && typeof raw === "string" && /^\d+$/.test(raw) && def.key.endsWith("_id")) return Number(raw);
  return raw;
}

function inputValue(def: FieldDef, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (def.type === "month" && typeof v === "string") return v.slice(0, 7);
  return String(v);
}

export function FormFields({ fields, values, onChange }: { fields: FieldDef[]; values: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.filter((f) => !f.show || f.show(values)).map((f) => {
        const v = values[f.key];
        if (f.type === "toggle")
          return (
            <div key={f.key} className={cx("flex items-end pb-1", f.full && "sm:col-span-2")}>
              <Toggle checked={Boolean(v)} onChange={(b) => onChange(f.key, b)} label={f.label} />
            </div>
          );
        let control;
        if (f.type === "select") {
          control = (
            <select className="input" value={inputValue(f, v)} required={f.required} onChange={(e) => onChange(f.key, e.target.value)}>
              {!f.required && <option value="">—</option>}
              {toOptions(f.options).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          );
        } else if (f.type === "textarea") {
          control = <textarea className="input min-h-[84px] font-[inherit]" value={inputValue(f, v)} placeholder={f.placeholder} onChange={(e) => onChange(f.key, e.target.value)} />;
        } else if (f.type === "color") {
          control = (
            <div className="flex items-center gap-2">
              <input type="color" className="h-9 w-12 cursor-pointer rounded-lg border border-line-strong bg-surface p-1" value={inputValue(f, v) || "#2a78d6"} onChange={(e) => onChange(f.key, e.target.value)} />
              <span className="num text-sm text-ink-2">{inputValue(f, v)}</span>
            </div>
          );
        } else {
          control = (
            <input
              className="input num"
              type={f.type ?? "text"}
              step={f.type === "number" ? (f.step ?? "0.01") : undefined}
              value={inputValue(f, v)}
              required={f.required}
              placeholder={f.placeholder}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          );
        }
        return (
          <Field key={f.key} label={f.label + (f.required ? " *" : "")} hint={f.hint} className={cx((f.full || f.type === "textarea") && "sm:col-span-2")}>
            {control}
          </Field>
        );
      })}
    </div>
  );
}

/** Modale de création / édition branchée sur une ressource REST. */
export function CrudModal<T extends { id?: number }>({
  open,
  onClose,
  onSaved,
  endpoint,
  title,
  fields,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (item: T) => void;
  endpoint: string;
  title: string;
  fields: FieldDef[];
  initial: Record<string, unknown>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(initial);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = { ...values };
    for (const f of fields) body[f.key] = formValue(f, values[f.key]);
    delete body.id;
    try {
      const saved = initial.id ? await api.put<T>(`${endpoint}/${initial.id}`, body) : await api.post<T>(endpoint, body);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="crud-form" loading={saving}>Enregistrer</Button>
        </>
      }
    >
      <form id="crud-form" onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <FormFields fields={fields} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
      </form>
    </Modal>
  );
}

export function useConfirmDelete() {
  return async (url: string, what: string) => {
    if (!window.confirm(`Supprimer ${what} ? Cette action est définitive.`)) return false;
    await api.del(url);
    return true;
  };
}
