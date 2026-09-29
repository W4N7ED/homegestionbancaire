export interface Account {
  id: number;
  name: string;
  bank_name: string;
  type: string;
  iban: string | null;
  currency: string;
  balance: number;
  balance_date: string | null;
  color: string;
  include_in_total: boolean;
  archived: boolean;
  connection_id: number | null;
  provider: string | null;
  tx_count: number;
}

export interface Category {
  id: number;
  name: string;
  kind: "expense" | "income" | "transfer";
  icon: string;
  color: string;
  budget_monthly: number | null;
}

export interface Rule {
  id: number;
  pattern: string;
  is_regex: boolean;
  category_id: number;
  priority: number;
}

export interface Transaction {
  id: number;
  account_id: number;
  date: string;
  amount: number;
  currency: string;
  label: string;
  counterparty: string | null;
  category_id: number | null;
  recurring_id: number | null;
  status: string;
  is_transfer: boolean;
  notes: string | null;
  source: string;
}

export interface ScheduledItem {
  date: string;
  name: string;
  amount: number;
  kind: string;
  source: "recurring" | "contract" | "loan";
  source_id: number;
  account_id: number | null;
  category_id: number | null;
  paid?: boolean;
}

export interface LoanStatus {
  payment: number;
  payment_with_insurance: number;
  remaining_capital: number;
  paid_count: number;
  remaining_count: number;
  progress: number;
  end_date: string;
  next_date: string | null;
  total_interest: number;
  total_cost: number;
  interest_paid: number;
  finished: boolean;
}

export interface Alert {
  level: "critical" | "serious" | "warning" | "info" | "good";
  title: string;
  detail: string;
  link: string;
}

export interface ResteAVivre {
  income_monthly: number;
  income_source: string;
  charges_monthly: number;
  breakdown: { income: number; charges: number; savings: number; loans: number; contracts: number; recurring_expenses: number; housing: number; debits: number };
  items?: FixedItem[];
  undeclared?: Undeclared[];
  undeclared_monthly?: number;
  reste_a_vivre_if_undeclared?: number;
  reste_a_vivre: number;
  reste_a_vivre_after_savings: number;
  per_day: number;
  debt_ratio: number | null;
  charges_ratio: number | null;
  current: {
    liquid: number;
    horizon: string;
    horizon_reason: string;
    remaining_charges: number;
    remaining_items: ScheduledItem[];
    available: number;
    days_left: number;
    per_day: number;
    month_income: number;
    month_spent: number;
  };
}

export interface FixedItem {
  name: string;
  source: "recurring" | "contract" | "loan";
  id: number;
  kind: string;
  category: string | null;
  amount: number;
  frequency: string;
  monthly: number;
  group: "income" | "housing" | "debits" | "contracts" | "loans" | "savings";
}

export interface Undeclared {
  key: string; name: string; kind: string; amount: number; median_amount: number; variable: boolean; frequency: string;
  occurrences: number; last_date: string; start_date: string; account_id: number; category_id: number | null;
  match_pattern: string; sample_label: string; monthly: number;
}

export interface Forecast {
  start_balance: number;
  daily_variable: number;
  series: { date: string; balance: number }[];
  lowest: { date: string; balance: number };
  end_balance: number;
}

export interface CategorySpend {
  category_id: number | null;
  name: string;
  color: string;
  icon: string;
  amount: number;
  budget: number | null;
}

export interface Dashboard {
  today: string;
  balances: { liquid: number; savings: number; total: number; debt: number; net_worth: number };
  accounts: { id: number; name: string; bank_name: string; type: string; balance: number; currency: string; color: string; connected: boolean; balance_date: string | null }[];
  reste_a_vivre: ResteAVivre;
  monthly: { month: string; income: number; expense: number; net: number }[];
  categories: CategorySpend[];
  spent_prev_same_period: number;
  history: { date: string; balance: number }[];
  forecast: Forecast;
  upcoming: ScheduledItem[];
  loans: ({ id: number; name: string; lender: string; type: string; principal: number } & LoanStatus)[];
  subscriptions: { count: number; monthly: number; yearly: number };
  goals: { id: number; name: string; target: number; current: number; deadline: string | null; color: string }[];
  alerts: Alert[];
}

export interface Doc {
  id: number;
  title: string;
  doc_type: string;
  year: number | null;
  filename: string;
  mime: string;
  size: number;
  owner_type: string | null;
  owner_id: number | null;
  notes: string | null;
  created_at: string;
}
