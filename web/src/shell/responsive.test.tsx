import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrivacyContext } from "../privacy";
import { TooltipProvider } from "../components/ui/tooltip";
import { AppShell } from "./AppShell";
import { viewDef } from "./routes";
import { mockApi } from "../../test/api";
import { ExpenseTable } from "../views/recurring/ExpenseTable";
import type { Account, RecurringExpense } from "../api";

/** Pretend to be a phone (under the 900 px 'nav' breakpoint) or a wide window. */
function viewport(narrow: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({ matches: narrow && q.includes("max-width"), media: q, addEventListener: () => {}, removeEventListener: () => {} })),
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  mockApi({
    "/review/counts": { uncategorized: 120, duplicates: 0, deleted: 0 },
    "/accounts": [],
    "/categories": [],
  });
});
afterEach(() => viewport(false));

const shell = () =>
  render(
    <PrivacyContext.Provider value={{ showPrivate: false, setShowPrivate: () => {} }}>
      <AppShell>{(view) => <p data-testid="view">{viewDef(view).label}</p>}</AppShell>
    </PrivacyContext.Provider>,
  );

describe("under 900 px", () => {
  it("the sidebar is a tab bar at the bottom: four views and 'Mer' with the rest", async () => {
    viewport(true);
    shell();
    const nav = screen.getByRole("navigation", { name: "Huvudmeny" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Översikt", "Transaktioner", "Fasta", "Delad"]);
    await waitFor(() => expect(within(nav).getByLabelText("120 att granska")).toHaveTextContent("99+"));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    await userEvent.click(within(nav).getByRole("button", { name: "Mer" }));
    const sheet = await screen.findByRole("dialog", { name: "Mer" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Kategorier & regler/ }));
    expect(screen.getByTestId("view")).toHaveTextContent("Kategorier & regler");
    expect(window.location.pathname).toBe("/kategorier");
  });

  it("a wide window keeps the sidebar and has no tab bar", () => {
    viewport(false);
    shell();
    expect(screen.queryByRole("button", { name: "Mer" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Kategorier & regler/ })).toHaveLength(1);
  });

  it("the fixed expenses' rows become small cards", () => {
    viewport(true);
    const accounts: Account[] = [{ id: 2, name: "Swedbank e-sparkonto", balance: 0, balanceUpdatedAt: null, note: null, kind: "bank", source: "swedbank", accountRef: null, clearing: null, trackBalance: true }];
    const e = {
      id: 1,
      name: "Hyra",
      amount: 750000,
      thisMonthAmount: 750000,
      variesByMonth: false,
      amountChanged: false,
      paused: false,
      shared: true,
      billingCycle: "monthly",
      scheduleType: "day_of_month",
      anchorDay: 25,
      bankDayRule: "previous",
      nextDate: "2026-09-25",
      accountId: 2,
      partNames: [],
      offSchedule: 0,
      thisMonth: { period: "2026-09", dueDate: "2026-09-25", status: "kommande", amount: 750000, transaction: null },
    } as unknown as RecurringExpense;
    const onOpen = vi.fn();
    render(
      <TooltipProvider>
        <ExpenseTable groups={[{ key: "2", accountId: 2, name: "Swedbank e-sparkonto", kind: "bank", items: [e] }]} accounts={accounts} activeId={null} collapsed={[]} onToggleGroup={() => {}} onOpen={onOpen} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // A small card: the name, the amount and the day under it, the status to the right.
    const card = document.querySelector('[data-expense="1"]') as HTMLElement;
    expect(card.className).toContain("grid-cols-[32px_minmax(0,1fr)_auto]");
    expect(card).toHaveTextContent(/Hyra7\s500\skr·25 ←/);
    expect(card).toHaveTextContent("kommande");
    card.click();
    expect(onOpen).toHaveBeenCalledWith(1);
  });
});
