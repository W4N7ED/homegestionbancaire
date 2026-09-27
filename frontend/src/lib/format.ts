const eurFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const eurFmt0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

export function eur(v: number | null | undefined, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = (opts.decimals === false ? eurFmt0 : eurFmt).format(v);
  return opts.sign && v > 0 ? `+${s}` : s;
}

export function money(v: number | null | undefined, currency = "EUR"): string {
  if (v === null || v === undefined) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(v);
  } catch {
    return eur(v);
  }
}

export const compact = (v: number) => compactFmt.format(v);

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(digits).replace(".", ",")} %`;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function toDate(v: string | Date): Date {
  if (v instanceof Date) return v;
  return v.length === 10 ? new Date(v + "T12:00:00") : new Date(v);
}

export function fdate(v: string | Date | null | undefined, style: "short" | "long" | "day" | "month" = "short"): string {
  if (!v) return "—";
  const d = toDate(v);
  if (style === "long") return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  if (style === "day") return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  if (style === "month") return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return d.toLocaleDateString("fr-FR");
}

export function monthLabel(ym: string, short = true): string {
  const d = toDate(ym + "-15");
  return d.toLocaleDateString("fr-FR", short ? { month: "short" } : { month: "long", year: "numeric" }).replace(".", "");
}

export function daysUntil(v: string): number {
  const d = toDate(v);
  const t = new Date();
  t.setHours(12, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export function relDays(v: string): string {
  const n = daysUntil(v);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  if (n === -1) return "hier";
  return n > 0 ? `dans ${n} j` : `il y a ${-n} j`;
}

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const FREQUENCIES: Record<string, string> = {
  weekly: "Hebdomadaire",
  monthly: "Mensuel",
  bimonthly: "Bimestriel",
  quarterly: "Trimestriel",
  semiannual: "Semestriel",
  yearly: "Annuel",
};

export const RECURRING_KINDS: Record<string, string> = {
  income: "Revenu",
  direct_debit: "Prélèvement",
  expense: "Dépense",
  transfer: "Virement permanent",
  savings: "Épargne programmée",
};

export const ACCOUNT_TYPES: Record<string, string> = {
  courant: "Compte courant",
  epargne: "Épargne",
  investissement: "Investissement",
  credit: "Carte / crédit",
  especes: "Espèces",
};

export const LOAN_TYPES: Record<string, string> = {
  immobilier: "Immobilier",
  consommation: "Consommation",
  auto: "Auto / moto",
  etudiant: "Étudiant",
  renouvelable: "Renouvelable",
  travaux: "Travaux",
  autre: "Autre",
};

export const CONTRACT_CATEGORIES: Record<string, string> = {
  energie: "Énergie",
  telecom: "Télécom & Internet",
  assurance: "Assurance",
  mutuelle: "Mutuelle / santé",
  streaming: "Streaming & médias",
  logiciel: "Logiciels & cloud",
  sport: "Sport & loisirs",
  transport: "Transport",
  banque: "Banque",
  presse: "Presse",
  autre: "Autre",
};

export const DOC_TYPES: Record<string, string> = {
  fiche_paie: "Fiche de paie",
  ticket_carburant: "Ticket carburant",
  contrat: "Contrat",
  facture: "Facture",
  impots: "Impôts",
  banque: "Relevé bancaire",
  assurance: "Assurance",
  credit: "Crédit",
  sante: "Santé",
  autre: "Autre",
};

export const FUEL_TYPES: Record<string, string> = {
  gazole: "Gazole",
  sp95: "SP95 / E10",
  sp98: "SP98",
  e85: "E85",
  gpl: "GPL",
  electrique: "Électrique (kWh)",
  hybride: "Hybride",
};
