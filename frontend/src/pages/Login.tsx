import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { Logo } from "../components/Layout";
import { Button, ErrorBox, Field } from "../components/ui";

export function Login({ setup, onDone }: { setup: boolean; onDone: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && password !== confirm) return setError("Les mots de passe ne correspondent pas.");
    setLoading(true);
    try {
      const res = await api.post<{ username: string }>(setup ? "/api/auth/setup" : "/api/auth/login", { username, password });
      onDone(res.username);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Pactole</h1>
          <p className="mt-1 text-sm text-ink-2">{setup ? "Première configuration : créez votre compte administrateur." : "Vos finances, chez vous."}</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && <ErrorBox message={error} />}
          <Field label="Identifiant">
            <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={2} autoFocus />
          </Field>
          <Field label="Mot de passe" hint={setup ? "12 caractères ou plus recommandés." : undefined}>
            <input className="input" type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </Field>
          {setup && (
            <Field label="Confirmation">
              <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
            </Field>
          )}
          <Button variant="primary" type="submit" className="w-full" loading={loading}>
            {setup ? "Créer le compte" : "Se connecter"}
          </Button>
        </form>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted">
          <ShieldCheck size={14} /> Auto-hébergé · données chiffrées au repos pour les secrets bancaires
        </p>
      </div>
    </div>
  );
}
