import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { reloadCategories } from "../categories";
import { TooltipProvider } from "../components/ui/tooltip";
import { Toaster } from "../components/Toast";
import { PageHeader } from "../shell/PageHeader";
import { callsTo, mockApi } from "../../test/api";
import { AnalysisView } from "./analysis/AnalysisView";
import { SettingsView } from "./settings/SettingsView";

const wrap = (title: string, node: React.ReactNode) =>
  render(
    <TooltipProvider>
      <PageHeader title={title} />
      {node}
      <Toaster />
    </TooltipProvider>,
  );
/** Folds a compact section out and gives its panel. */
async function openSection(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name}`), expanded: false }));
  return screen.getByRole("region", { name });
}

const CATEGORIES = [{ id: 1, name: "Mat", parentId: null, color: "#117733", isTransfer: false, isSettlement: false, systemKey: null }];

describe("Analys", () => {
  let fetchMock: ReturnType<typeof mockApi>;
  beforeEach(async () => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/analys");
    fetchMock = mockApi({
      "/categories": CATEGORIES,
      "/analysis/categories": {
        months: ["2026-08", "2026-09"],
        series: [{ key: "1", categoryId: 1, name: "Mat", color: "#117733" }],
        data: [
          { month: "2026-08", "1": 150000, total: 150000 },
          { month: "2026-09", "1": -4500, total: -4500 },
        ],
        parent: null,
      },
      "/analysis/compare": {
        a: { from: "2026-08-01", to: "2026-08-31" },
        b: { from: "2026-07-01", to: "2026-07-31" },
        rows: [{ key: "1", categoryId: 1, parentKey: null, name: "Mat", a: 150000, b: 100000, diff: 50000, pct: 0.5 }],
        total: { key: "total", categoryId: null, parentKey: null, name: "Totalt", a: 150000, b: 100000, diff: 50000, pct: 0.5 },
        days: { a: 31, b: 31 },
      },
    });
    await reloadCategories();
  });

  it("the period is a segmented control in the header, shared by the tabs; refunds are green with +", async () => {
    wrap("Analys", <AnalysisView openTransactions={() => {}} />);
    expect((await screen.findAllByText("+45 kr"))[0]).toHaveClass("text-positive-text");
    expect(callsTo(fetchMock, "GET", "/analysis/categories").at(-1)![0]).toMatch(/months=13/);
    await userEvent.click(screen.getByRole("radio", { name: "3 mån" }));
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/analysis/categories").at(-1)![0]).toMatch(/months=4/));
    // The first column stays put when the table scrolls.
    expect(screen.getByRole("columnheader", { name: "Kategori" })).toHaveClass("sticky");
    // The period is in the address, and a tab keeps it.
    expect(window.location.search).toBe("?period=3m");
    await userEvent.click(screen.getByRole("button", { name: "Snitt" }));
    expect(window.location.search).toBe("?period=3m&flik=snitt");
  });

  it("tabs live in the URL; 'Jämför perioder' shows Δ as a pill and hides the header period", async () => {
    wrap("Analys", <AnalysisView openTransactions={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Jämför perioder" }));
    expect(window.location.search).toBe("?flik=jamfor");
    expect(screen.queryByRole("radiogroup", { name: "Period" })).not.toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Per kategori" });
    const mat = within(table).getByText("Mat").closest("tr")!;
    expect(mat.querySelector("[data-tone]")).toHaveAttribute("data-tone", "more");
    expect(mat).toHaveTextContent(/\+500 kr · \+50 %/);
  });
});

const WATCH = {
  kinds: { price_drift: true, double_charge: true, unusual_amount: true, new_merchant: true, missed_charge: true, subscription_stopped: true },
  labels: {
    price_drift: "Prisdrift",
    double_charge: "Dubbeldebitering",
    unusual_amount: "Ovanligt belopp",
    new_merchant: "Ny handlare",
    missed_charge: "Utebliven dragning",
    subscription_stopped: "Abonnemang som inte dras",
  },
  muted: [{ series: "expense:4", name: "Parkster" }],
};

const REFERENCE = {
  household: null,
  partnerName: "Mio",
  options: {
    year: 2026,
    ageGroups: [
      { key: "18-24", label: "18–24 år" },
      { key: "25-50", label: "25–50 år" },
    ],
    food: [
      { key: "food_home", name: "Livsmedel, all mat lagas hemma" },
      { key: "food_home_no_weekday_lunch", name: "Livsmedel, utom lunch på vardagar" },
    ],
    items: [
      { key: "food_home", name: "Livsmedel, all mat lagas hemma", scope: "individual" },
      { key: "food_home_no_weekday_lunch", name: "Livsmedel, utom lunch på vardagar", scope: "individual" },
      { key: "clothing", name: "Kläder och skor", scope: "individual" },
      { key: "household_electricity", name: "Hushållsel", scope: "household" },
      { key: "water_sewage", name: "Vatten och avlopp", scope: "household" },
    ],
  },
};

describe("Inställningar", () => {
  let fetchMock: ReturnType<typeof mockApi>;
  beforeEach(() => {
    fetchMock = mockApi({
      "GET /accounts": [{ id: 1, name: "Swedbank Privatkonto", balance: 412300, balanceUpdatedAt: null, note: null, kind: "bank", source: "swedbank", accountRef: "••1234", clearing: "80000", trackBalance: true }],
      "PATCH /accounts": {},
      "/recurring-income/suggestions": [],
      "GET /recurring-income": [],
      "GET /settings": { partnerSwishNumbers: ["+46765550019"], partnerName: "Mio" },
      "PUT /settings": (_: string, init: { json?: unknown }) => ({ partnerSwishNumbers: (init.json as { partnerSwishNumbers: string[] }).partnerSwishNumbers, partnerName: "Mio" }),
      "GET /contacts": [{ id: 1, counterparty: "+46765550019", name: "Mio", note: null }],
      "/health": { ok: true, databasePath: "/data/finance.db", counts: { categories: 57, rules: 69, accounts: 1, transactions: 1938 } },
      "GET /data/backups": { dir: "/data/backups", backups: [{ name: "finance-2026-09-19T05-42-58-start.db", kind: "start", createdAt: "2026-09-19T05:42:58Z", size: 900000 }] },
      "POST /data/backups": { name: "finance-2026-09-19T06-00-00-manuell.db", backups: [] },
      "GET /watch/settings": WATCH,
      "PUT /watch/settings": { ...WATCH, kinds: { ...WATCH.kinds, new_merchant: false } },
      "POST /watch/unmute": { ...WATCH, muted: [] },
      "GET /cashflow/settings": { buffer: 200000 },
      "PUT /cashflow/settings": { buffer: 350000 },
      "GET /afford/settings": { redBelowMonths: 3 },
      "PUT /afford/settings": { redBelowMonths: 6 },
      "GET /digest": { title: "Veckan som gick (14–20/9)", lines: [], sentAt: null, canSend: true },
      "POST /digest/send": { ok: true, sentAt: "2026-09-20T17:00:00.000Z" },
      "GET /reference-budget/household": REFERENCE,
      "PUT /reference-budget/household": (_: string, init: { json?: unknown }) => ({ ...REFERENCE, household: init.json }),
    });
  });

  it("Referensbudget: set up the household, a food variant per person and what doesn't apply", async () => {
    wrap("Inställningar", <SettingsView />);
    const card = await openSection("Referensbudget");
    expect(within(card).getByText(/Inte inställt än/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Ändra" }));
    // You are there from the start; the partner is added by name.
    await userEvent.click(within(card).getByRole("button", { name: "Mio" }));
    await userEvent.selectOptions(within(card).getByLabelText("Mio, mat"), "food_home_no_weekday_lunch");
    await userEvent.type(within(card).getByLabelText("Mio, ålder"), "3x4");
    // The food variants are chosen per person, never excluded.
    expect(within(card).queryByRole("checkbox", { name: /Livsmedel/ })).toBeNull();
    await userEvent.click(within(card).getByRole("checkbox", { name: "Vatten och avlopp" }));
    await userEvent.click(within(card).getByRole("checkbox", { name: "Hushållsel" }));
    await userEvent.click(within(card).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/reference-budget/household")).toHaveLength(1));
    expect(callsTo(fetchMock, "PUT", "/reference-budget/household")[0][1]).toEqual({
      persons: [
        { role: "me", ageGroup: "25-50", food: "food_home", age: null },
        { role: "partner", ageGroup: "25-50", food: "food_home_no_weekday_lunch", age: 34 },
      ],
      excluded: ["water_sewage", "household_electricity"],
    });
    const text = (await within(card).findByText(/2 personer i hushållet/)).textContent;
    expect(text).toContain("Räknas inte: Vatten och avlopp, Hushållsel.");
    expect(within(card).getByText(/25–50 år \(34 år\) · utom lunch på vardagar/)).toBeInTheDocument();
  });

  it("Veckodigest: 'Skicka nu' sends it and says when", async () => {
    wrap("Inställningar", <SettingsView />);
    const card = await openSection("Veckodigest");
    expect(within(card).getByText("Inte skickad än.")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: /Skicka nu/ }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/digest/send")).toHaveLength(1));
    expect(await within(card).findByText(/Senast skickad 20 sep/)).toBeInTheDocument();
  });

  it("Kassaflöde: the buffer in kronor, and Har jag råd?'s red limit in months", async () => {
    wrap("Inställningar", <SettingsView />);
    const card = await openSection("Kassaflöde");
    expect(within(card).getByText(/2 000,00 kr/)).toBeInTheDocument();
    expect(await within(card).findByText("3 månader")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Ändra" }));
    const field = within(card).getByLabelText("Buffert");
    await userEvent.clear(field);
    await userEvent.type(field, "3500");
    const red = within(card).getByLabelText("Röd gräns");
    await userEvent.clear(red);
    await userEvent.type(red, "6");
    await userEvent.click(within(card).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/cashflow/settings")).toEqual([["/api/cashflow/settings", { buffer: 350000 }]]));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/afford/settings")).toEqual([["/api/afford/settings", { redBelowMonths: 6 }]]));
    expect(await within(card).findByText(/3 500,00 kr/)).toBeInTheDocument();
    expect(within(card).getByText("6 månader")).toBeInTheDocument();
  });

  it("Vakt: each kind turned on and off at once; a muted price series watched again", async () => {
    wrap("Inställningar", <SettingsView />);
    const card = (await screen.findByRole("heading", { name: "Vakt" })).closest("section")!;
    await userEvent.click(within(card).getByRole("switch", { name: "Ny handlare" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/watch/settings")).toEqual([["/api/watch/settings", { kinds: { new_merchant: false } }]]));
    expect(within(card).getByRole("switch", { name: "Ny handlare" })).not.toBeChecked();
    expect(within(card).getByText("Parkster")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Bevaka igen" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/watch/unmute")).toEqual([["/api/watch/unmute", { series: "expense:4" }]]));
    await waitFor(() => expect(within(card).queryByText("Parkster")).not.toBeInTheDocument());
  });

  it("edits a card with Spara/Avbryt: only what changed is saved", async () => {
    wrap("Inställningar", <SettingsView />);
    const card = (await screen.findByRole("heading", { name: "Konton och bankkopplingar" })).closest("section")!;
    await userEvent.click(within(card).getByRole("button", { name: "Ändra" }));
    await userEvent.type(within(card).getByLabelText("Anteckning för Swedbank Privatkonto"), "Vardagskonto");
    await userEvent.click(within(card).getByRole("button", { name: "Avbryt" }));
    expect(callsTo(fetchMock, "PATCH", "/accounts")).toHaveLength(0);
    await userEvent.click(within(card).getByRole("button", { name: "Ändra" }));
    await userEvent.type(within(card).getByLabelText("Anteckning för Swedbank Privatkonto"), "Vardagskonto");
    await userEvent.click(within(card).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/accounts/1")).toEqual([["/api/accounts/1", { note: "Vardagskonto" }]]));
    // An account without a balance to follow (Bank Norwegian: only the card).
    await userEvent.click(within(card).getByRole("button", { name: "Ändra" }));
    await userEvent.click(within(card).getByRole("switch", { name: "Följ saldot för Swedbank Privatkonto" }));
    await userEvent.click(within(card).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/accounts/1").at(-1)).toEqual(["/api/accounts/1", { trackBalance: false }]));
  });

  it("saves the partner's numbers and my name, backs up now and offers the export", async () => {
    wrap("Inställningar", <SettingsView />);
    const partner = await openSection("Partner");
    await userEvent.click(within(partner).getByRole("button", { name: "Ändra" }));
    const field = within(partner).getByRole("textbox", { name: /Swish-nummer/ });
    await userEvent.clear(field);
    await userEvent.type(field, "+46765550019, 0701234567");
    // My own name, for my initial in Delad ekonomi.
    await userEvent.type(within(partner).getByRole("textbox", { name: "Ditt namn" }), "Kim");
    await userEvent.click(within(partner).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/settings")[0][1]).toEqual({ partnerSwishNumbers: ["+46765550019", "0701234567"], ownName: "Kim" }));

    const data = screen.getByRole("heading", { name: "Data" }).closest("section")!;
    expect(within(data).getByText("vid start")).toBeInTheDocument();
    expect(within(data).getByRole("link", { name: /Allt som JSON/ })).toHaveAttribute("href", "/api/data/export?format=json");
    await userEvent.click(within(data).getByRole("button", { name: /Säkerhetskopiera nu/ }));
    expect(await screen.findByText(/Säkerhetskopian finance-2026-09-19T06-00-00-manuell\.db är skapad/)).toBeInTheDocument();
  });
});
