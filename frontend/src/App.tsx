import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { api } from "./lib/api";
import { RefDataProvider } from "./lib/refdata";
import { Layout } from "./components/Layout";
import { Empty, Loading } from "./components/ui";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { CalendarPage, ForecastPage, ResteAVivrePage } from "./pages/Planning";
import { AccountsPage } from "./pages/Accounts";
import { TransactionsPage } from "./pages/Transactions";
import { BudgetsPage } from "./pages/Budgets";
import { BanksPage } from "./pages/Banks";
import { ContractsPage, GoalsPage, LoansPage, RecurringPage } from "./pages/Commitments";
import { DocumentsPage, FuelPage, PayslipsPage } from "./pages/Records";
import { TaxesPage } from "./pages/Taxes";
import { SimulatorPage } from "./pages/Simulator";
import { SettingsPage } from "./pages/Settings";

type Auth = { setup_required: boolean; authenticated: boolean; username: string | null };

export default function App() {
  const [auth, setAuth] = useState<Auth | null>(null);

  const check = useCallback(() => {
    api.get<Auth>("/api/auth/status").then(setAuth).catch(() => setAuth({ setup_required: false, authenticated: false, username: null }));
  }, []);

  useEffect(() => {
    check();
    const onUnauthorized = () => setAuth((a) => (a ? { ...a, authenticated: false } : a));
    window.addEventListener("pactole:unauthorized", onUnauthorized);
    return () => window.removeEventListener("pactole:unauthorized", onUnauthorized);
  }, [check]);

  if (!auth) return <Loading />;
  if (!auth.authenticated)
    return <Login setup={auth.setup_required} onDone={(username) => setAuth({ setup_required: false, authenticated: true, username })} />;

  const logout = async () => {
    await api.post("/api/auth/logout");
    setAuth({ ...auth, authenticated: false });
  };

  return (
    <BrowserRouter>
      <RefDataProvider>
        <Layout username={auth.username ?? ""} onLogout={logout}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/reste-a-vivre" element={<ResteAVivrePage />} />
            <Route path="/previsionnel" element={<ForecastPage />} />
            <Route path="/echeancier" element={<CalendarPage />} />
            <Route path="/simulateur" element={<SimulatorPage />} />
            <Route path="/comptes" element={<AccountsPage />} />
            <Route path="/operations" element={<TransactionsPage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/banques" element={<BanksPage />} />
            <Route path="/recurrents" element={<RecurringPage />} />
            <Route path="/contrats" element={<ContractsPage />} />
            <Route path="/credits" element={<LoansPage />} />
            <Route path="/objectifs" element={<GoalsPage />} />
            <Route path="/paie" element={<PayslipsPage />} />
            <Route path="/carburant" element={<FuelPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/impots" element={<TaxesPage />} />
            <Route path="/parametres" element={<SettingsPage />} />
            <Route path="*" element={<Empty title="Page introuvable" />} />
          </Routes>
        </Layout>
      </RefDataProvider>
    </BrowserRouter>
  );
}
