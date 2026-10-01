import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { reloadCategories } from "../../categories";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { PrivacyContext } from "../../privacy";
import { PageHeader } from "../../shell/PageHeader";
import { callsTo, mockApi } from "../../../test/api";
import { SettingsView } from "./SettingsView";

const cat = (id: number, name: string, parentId: number | null) => ({ id, name, parentId, color: null, isTransfer: false, isSettlement: false, systemKey: null });
const CATEGORIES = [cat(1, "Prylar & hem", null), cat(29, "Elektronik", 1), cat(30, "Kläder", 1), cat(2, "Bil", null), cat(9, "Drivmedel", 2)];
const ACCOUNTS = [
  { id: 1, name: "Swedbank Privatkonto", balance: 11414, balanceUpdatedAt: null, note: null, kind: "bank", source: "swedbank", accountRef: "••1234", clearing: "80000", trackBalance: true },
  { id: 2, name: "Swedbank e-sparkonto", balance: 19016, balanceUpdatedAt: null, note: "Lönekonto", kind: "bank", source: "swedbank", accountRef: "••5678", clearing: "80000", trackBalance: true },
  { id: 3, name: "Swedbank Mastercard Guld", balance: -985000, balanceUpdatedAt: null, note: null, kind: "credit_card", source: "mastercard", accountRef: null, clearing: null, trackBalance: true },
];
const BANKS = {
  configured: true,
  syncing: false,
  syncHours: [6, 12, 18],
  banks: ["Swedbank"],
  connections: [
    {
      id: 1,
      bank: "Swedbank",
      status: "active",
      validUntil: "2027-03-18",
      daysLeft: 174,
      expiresSoon: false,
      authorizedAt: null,
      lastSyncAt: null,
      lastError: null,
      accounts: [
        { id: 10, maskedRef: "••1234", product: "Privatkonto", accountId: 1, accountName: "Swedbank Privatkonto", lastBookingDate: "2026-09-24", lastSyncAt: null, pending: { count: 0, amount: 0 } },
        { id: 11, maskedRef: "••5678", product: "e-sparkonto", accountId: 2, accountName: "Swedbank e-sparkonto", lastBookingDate: "2026-09-24", lastSyncAt: null, pending: { count: 0, amount: 0 } },
      ],
    },
  ],
};
const WATCH = {
  kinds: { price_drift: true, new_merchant: true, warranty_ending: true },
  labels: { price_drift: "Prisdrift", new_merchant: "Ny handlare", warranty_ending: "Garanti går ut" },
  muted: [],
};
const NETWORTH = {
  akassa: { incomeCapOre: 3400000, daysPerMonth: 22, steps: [{ days: 100, rate: 0.8 }], taxRate: null, incomeMonths: 12 },
  bufferAccount: { id: 2, name: "Swedbank e-sparkonto" },
  payslipTaxRate: 0.191,
  pension: { incomeBaseAmounts: [{ year: 2026, amountOre: 8340000, source: "regeringsbeslut 6/11 2025" }], incomeMonths: 12 },
};
const INCOME = { id: 1, name: "Lön", amount: 2467600, dayOfMonth: 24, accountId: 2, active: true, matchPattern: "LÖN", lastReceived: null, recent: [], recentMin: null, recentAvg: null, overrides: [] };
const SUGGESTION = { name: "Bonus", accountId: 1, accountName: "Swedbank Privatkonto", amount: 500000, dayOfMonth: 25, matchPattern: "BONUS", basedOn: [{ bookingDate: "2026-09-25", amount: 500000 }] };
const FUEL = {
  settings: { kmPerShift: 40, otherKmPerMonth: 200, baseConsumption: 6.5, congestionPerShift: 0, useCalibrated: false, categoryId: null, fuelCategoryId: 9 },
  latestPrice: { id: 1, date: "2026-09-19", price: 2258, ageDays: 6 },
  prices: [{ id: 1, date: "2026-09-19", price: 2258 }],
  calibration: null,
};

let suggestions: unknown[];
let fetchMock: ReturnType<typeof mockApi>;
let showPrivate: ReturnType<typeof vi.fn<(v: boolean) => void>>;

function renderPage() {
  showPrivate = vi.fn<(v: boolean) => void>();
  return render(
    <PrivacyContext.Provider value={{ showPrivate: false, setShowPrivate: showPrivate }}>
      <TooltipProvider>
        <PageHeader title="Inställningar" />
        <SettingsView />
        <Toaster />
      </TooltipProvider>
    </PrivacyContext.Provider>,
  );
}

beforeEach(async () => {
  suggestions = [];
  window.history.replaceState(null, "", "/installningar");
  localStorage.clear();
  fetchMock = mockApi({
    "/categories": CATEGORIES,
    "GET /accounts": ACCOUNTS,
    "GET /enable-banking/status": BANKS,
    "GET /recurring-income/suggestions": () => suggestions,
    "GET /recurring-income": [INCOME],
    "POST /recurring-income": { ...INCOME, id: 2, name: "Bonus", linked: 1 },
    "PATCH /recurring-income": {},
    "GET /settings": { partnerSwishNumbers: ["+46XX5550019"], partnerName: "Mio", ownName: null },
    "GET /contacts": [{ id: 1, counterparty: "+46XX5550019", name: "Mio", note: null }],
    "PUT /contacts": {},
    "/health": { ok: true, databasePath: "/data/finance.db", counts: { categories: 57, rules: 69, accounts: 3, transactions: 1938 } },
    "GET /data/backups": { dir: "/data/backups", backups: [{ name: "finance-start.db", kind: "start", createdAt: new Date().toISOString(), size: 900000 }] },
    "GET /watch/settings": WATCH,
    "GET /items/settings": { categoryIds: [29], minAmount: 50000, defaultMinAmount: 50000 },
    "PUT /items/settings": (_: string, init: { json?: unknown }) => ({ categoryIds: [29], minAmount: 50000, defaultMinAmount: 50000, ...(init.json as object) }),
    "GET /cashflow/settings": { buffer: 200000 },
    "GET /afford/settings": { redBelowMonths: 3 },
    "GET /networth/settings": NETWORTH,
    "PUT /networth/settings": NETWORTH,
    "GET /reference-budget/household": { household: null, options: null, partnerName: "Mio" },
    "GET /analysis/prices": { settings: { baseMonth: null } },
    "PUT /analysis/prices/settings": { baseMonth: "2025-01" },
    "GET /digest": { canSend: true, sentAt: null },
    "GET /fuel": FUEL,
    "PUT /fuel/settings": {},
    "POST /fuel/prices": {},
  });
  await reloadCategories();
});

const expand = async (name: string) => {
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name}`), expanded: false }));
  return screen.getByRole("region", { name });
};
const navLink = (id: string) => document.querySelector(`[data-section-link="${id}"]`) as HTMLElement;

describe("Inställningar, Design v2", () => {
  it("the search narrows to what matches by label or explanation, rule by rule, and dims the rest of the nav", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Bil/ });
    const search = screen.getByRole("searchbox", { name: "Sök inställning" });
    // 'diesel' is only in Bil's sentence.
    await userEvent.type(search, "diesel");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Vakt" })).toBeNull());
    expect(screen.getByRole("button", { name: /^Bil/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pension/ })).toBeNull();
    expect(navLink("bil")).not.toHaveClass("opacity-40");
    expect(navLink("vakt")).toHaveClass("opacity-40");
    // An explanation: Vakt with just the rule it matches.
    await userEvent.clear(search);
    await userEvent.type(search, "pryl går ut");
    const watch = (await screen.findByRole("heading", { name: "Vakt" })).closest("section")!;
    expect(within(watch).getByRole("switch", { name: "Garanti går ut" })).toBeInTheDocument();
    expect(within(watch).queryByRole("switch", { name: "Prisdrift" })).toBeNull();
    // Nothing.
    await userEvent.clear(search);
    await userEvent.type(search, "xyzzy");
    expect(await screen.findByText('Ingen inställning matchar "xyzzy".')).toBeInTheDocument();
    await userEvent.clear(search);
    expect(await screen.findByRole("heading", { name: "Utseende" })).toBeInTheDocument();
  });

  it("a badge in the nav when a suggestion waits, and none when nothing does", async () => {
    renderPage();
    await screen.findByRole("button", { name: /^Återkommande inkomster/ });
    expect(within(navLink("inkomster")).queryByLabelText(/väntar/)).toBeNull();
    suggestions = [SUGGESTION];
    // A fresh page asks again.
    cleanup();
    renderPage();
    await waitFor(() => expect(within(navLink("inkomster")).getByLabelText("1 väntar")).toBeInTheDocument());
    expect(await screen.findByText(/1 förslag väntar/)).toBeInTheDocument();
    // Konton, Data: nothing waits.
    expect(within(navLink("konton")).queryByLabelText(/väntar/)).toBeNull();
    expect(within(navLink("data")).queryByLabelText(/väntar/)).toBeNull();
  });

  it("folding out is in the address; the address folds out; the nav's section is in the hash", async () => {
    window.history.replaceState(null, "", "/installningar?oppen=pension");
    renderPage();
    expect(await screen.findByRole("region", { name: "Pension" })).toHaveTextContent("2026: 83 400,00 kr");
    await userEvent.click(screen.getByRole("button", { name: /^Bil/, expanded: false }));
    expect(new URLSearchParams(window.location.search).get("oppen")).toBe("pension,bil");
    await userEvent.click(screen.getByRole("button", { name: /^Pension/, expanded: true }));
    expect(new URLSearchParams(window.location.search).get("oppen")).toBe("bil");
    expect(screen.queryByRole("region", { name: "Pension" })).toBeNull();
    await userEvent.click(navLink("vakt"));
    expect(window.location.hash).toBe("#vakt");
    expect(navLink("vakt")).toHaveAttribute("aria-current", "location");
  });

  it("Konton: how each account gets its rows, and the consent in the footer", async () => {
    renderPage();
    const row = (id: number) => document.querySelector(`[data-account="${id}"] [data-link]`) as HTMLElement;
    await waitFor(() => expect(row(1)).toHaveAttribute("data-link", "green"));
    expect(row(1)).toHaveTextContent("Enable Banking · aktivhämtat t.o.m. 24 sep");
    expect(row(3)).toHaveAttribute("data-link", "grey");
    expect(row(3)).toHaveTextContent("manuellfaktura-PDF eller för hand");
    expect(document.querySelector("[data-bank=Swedbank]")).toHaveTextContent(/samtycket gäller till 18 mars 2027 \(174 dagar kvar\)/);
    expect(document.querySelector('[data-account="3"] [data-balance]')!.innerHTML).toContain("text-caution-text");
  });

  describe("every setting can still be changed", () => {
    it("Utseende: the theme and private rows", async () => {
      renderPage();
      await userEvent.click(await screen.findByRole("radio", { name: "Mörkt" }));
      expect(localStorage.getItem("privatekonomi.theme")).toBe("dark");
      await userEvent.click(screen.getByRole("switch", { name: "Visa privata rader" }));
      expect(showPrivate).toHaveBeenCalledWith(true);
    });

    it("Prylar: a category and the threshold, saved at once", async () => {
      renderPage();
      const panel = await expand("Prylar");
      await userEvent.click(within(panel).getByRole("checkbox", { name: "Prylar & hem › Kläder" }));
      await waitFor(() => expect(callsTo(fetchMock, "PUT", "/items/settings")[0][1]).toEqual({ categoryIds: [29, 30] }));
      const amount = within(panel).getByLabelText("Tröskelbelopp i kronor");
      await userEvent.clear(amount);
      await userEvent.type(amount, "800");
      await userEvent.tab();
      await waitFor(() => expect(callsTo(fetchMock, "PUT", "/items/settings").at(-1)?.[1]).toEqual({ minAmount: 80000 }));
    });

    it("Uthållighet and Pension: the ceiling, and next year's inkomstbasbelopp", async () => {
      renderPage();
      const endurance = await expand("Uthållighet och a-kassa");
      await userEvent.click(within(endurance).getByRole("button", { name: "Ändra" }));
      const cap = within(endurance).getByLabelText("Tak");
      await userEvent.clear(cap);
      await userEvent.type(cap, "35000");
      await userEvent.click(within(endurance).getByRole("button", { name: "Spara" }));
      await waitFor(() => expect(callsTo(fetchMock, "PUT", "/networth/settings")[0][1]).toMatchObject({ bufferAccountId: 2, akassa: { incomeCapOre: 3500000 } }));

      const pension = await expand("Pension");
      await userEvent.click(within(pension).getByRole("button", { name: "Ändra" }));
      const year = within(pension).getByLabelText("År");
      await userEvent.clear(year);
      await userEvent.type(year, "2027");
      await userEvent.type(within(pension).getByLabelText("Inkomstbasbelopp"), "85600");
      await userEvent.click(within(pension).getByRole("button", { name: "Spara" }));
      await waitFor(() => expect(callsTo(fetchMock, "PUT", "/networth/settings").at(-1)?.[1]).toEqual({ incomeBaseAmount: { year: 2027, amountOre: 8560000, source: "" } }));
    });

    it("Priser: the month the index counts from", async () => {
      renderPage();
      const panel = await expand("Priser");
      await userEvent.click(within(panel).getByRole("button", { name: "Ändra" }));
      await userEvent.type(within(panel).getByLabelText("Startmånad"), "2025-01");
      await userEvent.click(within(panel).getByRole("button", { name: "Spara" }));
      await waitFor(() => expect(callsTo(fetchMock, "PUT", "/analysis/prices/settings")).toEqual([["/api/analysis/prices/settings", { baseMonth: "2025-01" }]]));
    });

    it("Återkommande inkomster: a suggestion added, and an income changed", async () => {
      suggestions = [SUGGESTION];
      renderPage();
      const panel = await expand("Återkommande inkomster");
      await userEvent.click(within(panel).getByRole("button", { name: /Lägg till/ }));
      await waitFor(() => expect(callsTo(fetchMock, "POST", "/recurring-income")[0][1]).toMatchObject({ name: "Bonus", amount: 500000, matchPattern: "BONUS" }));
      const income = panel.querySelector("[data-income='1']") as HTMLElement;
      await userEvent.click(within(income).getByRole("button", { name: "Ändra" }));
      const day = within(income).getByDisplayValue("24");
      await userEvent.clear(day);
      await userEvent.type(day, "25");
      await userEvent.click(within(income).getByRole("button", { name: "Spara" }));
      await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-income/1")).toEqual([["/api/recurring-income/1", { dayOfMonth: 25 }]]));
    });

    it("Bil: the distances and a diesel price", async () => {
      renderPage();
      const panel = await expand("Bil");
      await userEvent.type(within(panel).getByLabelText("Literpris"), "21,49");
      await userEvent.click(within(panel).getByRole("button", { name: /Lägg till pris/ }));
      await waitFor(() => expect(callsTo(fetchMock, "POST", "/fuel/prices")[0][1]).toMatchObject({ price: 2149 }));
      await userEvent.click(within(panel).getByRole("button", { name: "Ändra" }));
      const km = within(panel).getByLabelText("Sträcka per pass (tur och retur)");
      await userEvent.clear(km);
      await userEvent.type(km, "80");
      await userEvent.click(within(panel).getByRole("button", { name: "Spara" }));
      await waitFor(() => expect(callsTo(fetchMock, "PUT", "/fuel/settings")[0][1]).toMatchObject({ kmPerShift: 80, otherKmPerMonth: 200 }));
    });

    it("Kontakter: a name changed", async () => {
      renderPage();
      const panel = await expand("Kontakter");
      await userEvent.click(within(panel).getByRole("button", { name: "Ändra" }));
      const name = within(panel).getByLabelText("Namn för +46XX5550019");
      await userEvent.clear(name);
      await userEvent.type(name, "Kim");
      await userEvent.click(within(panel).getByRole("button", { name: "Spara" }));
      await waitFor(() => expect(callsTo(fetchMock, "PUT", "/contacts")).toEqual([["/api/contacts", { counterparty: "+46XX5550019", name: "Kim" }]]));
    });
  });
});
