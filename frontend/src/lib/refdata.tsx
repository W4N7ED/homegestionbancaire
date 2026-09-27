import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Account, Category } from "./types";

interface RefData {
  accounts: Account[];
  categories: Category[];
  catById: Map<number, Category>;
  accById: Map<number, Account>;
  reload: () => Promise<void>;
}

const Ctx = createContext<RefData | null>(null);

export function RefDataProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const reload = useCallback(async () => {
    const [a, c] = await Promise.all([api.get<Account[]>("/api/accounts"), api.get<Category[]>("/api/categories")]);
    setAccounts(a);
    setCategories(c);
  }, []);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const value = useMemo(
    () => ({
      accounts,
      categories,
      catById: new Map(categories.map((c) => [c.id, c])),
      accById: new Map(accounts.map((a) => [a.id, a])),
      reload,
    }),
    [accounts, categories, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRefData(): RefData {
  const v = useContext(Ctx);
  if (!v) throw new Error("RefDataProvider manquant");
  return v;
}
