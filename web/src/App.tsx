import { useEffect, useState } from "react";
import { getJson } from "./api";
import { CategoriesView } from "./views/categories/CategoriesView";
import { ImportsView } from "./views/imports/ImportsView";
import { TransactionsPage } from "./views/transactions/TransactionsPage";
import { SettingsView } from "./views/settings/SettingsView";
import { RecurringView } from "./views/recurring/RecurringView";
import { OverviewView } from "./views/overview/OverviewView";
import { ManualEntryHost } from "./views/overview/ManualEntry";
import { SharedView } from "./views/shared/SharedView";
import { AnalysisView } from "./views/analysis/AnalysisView";
import { CommuteView } from "./views/commute/CommuteView";
import { SalaryView } from "./views/salary/SalaryView";
import { ItemsView } from "./views/items/ItemsView";
import { ItemDialogHost } from "./views/items/ItemDialogHost";
import { NewCategoryHost } from "./categories";
import { PrivacyContext } from "./privacy";
import { AppShell } from "./shell/AppShell";
import { navigate } from "./shell/routes";
import { openTransactions } from "./shell/openTransactions";
import { refreshBadges } from "./shell/badges";

export function App() {
  const [focusRecurring, setFocusRecurring] = useState<number | null>(null);
  // Never persisted: a reload always hides private rows again.
  const [showPrivate, setShowPrivate] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  useEffect(() => {
    getJson("/health").then(() => setBackendError(null), (e) => setBackendError(String(e)));
  }, []);

  return (
    <PrivacyContext.Provider value={{ showPrivate, setShowPrivate }}>
      <AppShell>
        {(view) => (
          <>
          {backendError && (
            <p className="mb-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
              Kunde inte nå backend: {backendError}
            </p>
          )}
          {view === "overview" ? (
            <OverviewView onNavigate={(t) => navigate(t)} />
          ) : view === "categories" ? (
            <CategoriesView />
          ) : view === "imports" ? (
            <ImportsView onImported={refreshBadges} />
          ) : view === "transactions" ? (
            <TransactionsPage
              onOpenRecurring={(id) => {
                setFocusRecurring(id);
                navigate("recurring");
              }}
            />
          ) : view === "settings" ? (
            <SettingsView />
          ) : view === "analysis" ? (
            <AnalysisView openTransactions={(f) => openTransactions(f)} />
          ) : view === "shared" ? (
            <SharedView />
          ) : view === "items" ? (
            <ItemsView />
          ) : view === "commute" ? (
            <CommuteView />
          ) : view === "salary" ? (
            <SalaryView />
          ) : (
            <RecurringView focusId={focusRecurring} onFocused={() => setFocusRecurring(null)} />
          )}
          </>
        )}
      </AppShell>
      <NewCategoryHost />
      <ManualEntryHost />
      <ItemDialogHost />
    </PrivacyContext.Provider>
  );
}
