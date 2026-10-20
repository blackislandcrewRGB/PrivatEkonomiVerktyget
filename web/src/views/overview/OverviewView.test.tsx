import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Category, Overview } from "../../api";
import { reloadCategories } from "../../categories";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { PageHeader } from "../../shell/PageHeader";
import { setShare } from "../../lib/share";
import { callsTo, mockApi } from "../../../test/api";
import { OverviewView } from "./OverviewView";
import { ManualEntryHost, openManualEntry } from "./ManualEntry";
import { ItemDialogHost, closeItemDialog } from "../items/ItemDialogHost";

const cat = (id: number, name: string, parentId: number | null = null): Category => ({
  id,
  name,
  parentId,
  color: null,
  isTransfer: false,
  isSettlement: false,
  systemKey: null,
});

const ESPAR = { id: 2, name: "Swedbank e-sparkonto", kind: "bank" as const };
const balance = (id: number, name: string, kind: "bank" | "credit_card", ore: number) => ({
  id,
  name,
  kind,
  source: kind === "bank" ? ("swedbank" as const) : ("mastercard" as const),
  trackBalance: true,
  balance: ore,
  updatedAt: "2026-09-19",
  ageDays: 0,
  stale: false,
  invoice: null,
  invoiceImported: false,
  nextInvoice: null,
  debt: null as Overview["balances"][number]["debt"],
});

function overview(): Overview {
  // 478 kr/day, 300 of it from the bank and 178 on the cards.
  const pace = { days: 30, from: "2026-08-21", to: "2026-09-19", total: 1434000, perDay: 47800, bankPerDay: 30000, cardPerDay: 17800 };
  return {
    today: "2026-09-19",
    payday: {
      incomeId: 1,
      name: "Lön",
      accountId: 2,
      date: "2026-09-24",
      month: "2026-09",
      daysUntil: 5,
      expected: 2450000,
      expectedSource: "estimate",
      override: null,
      estimate: 2450000,
      forecast: null,
      late: false,
      received: null,
    },
    forecast: {
      start: 2562300,
      startAccounts: [
        { id: 1, name: "Swedbank Privatkonto", balance: 412300 },
        { id: 2, name: ESPAR.name, balance: 2150000 },
      ],
      otherIncome: [],
      fixed: 39900,
      fixedCount: 1,
      invoices: [],
      fuel: null,
      left: 2522400,
      days: 5,
      perDay: 504480,
      partner: { amount: 0, partnerName: "Mio", month: "2026-09", latestSettled: null },
    },
    pace,
    paceHousehold: { ...pace, total: 2000000, perDay: 66700, bankPerDay: 40000, cardPerDay: 26700 },
    money: {
      bankOre: 1012300,
      iskOre: 150000,
      totalOre: 1162300,
      accounts: [
        { id: 1, name: "Swedbank Privatkonto", balance: 412300 },
        { id: 2, name: "Swedbank e-sparkonto", balance: 600000 },
      ],
    },
    // September to the 19th: nothing bought on the 2nd, 5th and 7th; today (19th) nothing yet.
    noSpend: {
      month: "2026-09",
      days: Array.from({ length: 30 }, (_, i) => {
        const date = `2026-09-${String(i + 1).padStart(2, "0")}`;
        const status = i + 1 > 19 ? "future" : i + 1 === 19 ? "today" : [2, 5, 7].includes(i + 1) ? "free" : "spent";
        return { date, status: status as "free" | "spent" | "today" | "future", items: status === "spent" ? [{ name: "Kjell & Co", amount: 29900 }] : [] };
      }),
      free: 3,
      past: 18,
      amount: 448500,
      usual: { toDate: 380000, perMonth: 620000, day: 19, from: "2026-06", to: "2026-08" },
    },
    // Ate out on the 3rd and the 12th.
    eatingOut: {
      month: "2026-09",
      days: Array.from({ length: 30 }, (_, i) => {
        const date = `2026-09-${String(i + 1).padStart(2, "0")}`;
        const status = i + 1 > 19 ? "future" : i + 1 === 19 ? "today" : [3, 12].includes(i + 1) ? "out" : "home";
        return { date, status: status as "out" | "home" | "today" | "future", items: status === "out" ? [{ name: "Max", amount: 14500 }] : [] };
      }),
      count: 2,
      amount: 29000,
      usual: { toDate: 41000, perMonth: 72000, day: 19, from: "2026-06", to: "2026-08" },
    },
    groceryWeeks: {
      month: "2026-09",
      weeks: [
        { week: 36, from: "2026-09-01", to: "2026-09-06", amount: 180000, status: "past" },
        { week: 37, from: "2026-09-07", to: "2026-09-13", amount: 210000, status: "past" },
        { week: 38, from: "2026-09-14", to: "2026-09-20", amount: 60000, status: "current" },
        { week: 39, from: "2026-09-21", to: "2026-09-27", amount: 0, status: "future" },
        { week: 40, from: "2026-09-28", to: "2026-09-30", amount: 0, status: "future" },
      ],
      total: 450000,
      averagePerWeek: 190000,
      averageFrom: "2026-06",
      averageTo: "2026-08",
      usual: { toDate: 420000, perMonth: 820000, day: 19, from: "2026-06", to: "2026-08" },
    },
    balances: [
      balance(1, "Swedbank Privatkonto", "bank", 412300),
      balance(2, ESPAR.name, "bank", 2150000),
      {
        ...balance(3, "Swedbank Mastercard Guld", "credit_card", -1250000),
        invoiceImported: true,
        invoice: {
          statementId: 7,
          accountId: 3,
          accountName: "Swedbank Mastercard Guld",
          dueDate: "2026-09-30",
          amountDue: 1050000,
          minPayment: null,
          paidAmount: 0,
          status: "unpaid",
          paidBy: null,
          daysUntilDue: 11,
        },
      },
    ],
    recurring: [],
    month: {
      day: 19,
      categories: [{ categoryId: 1, name: "Mat", color: "", current: 197500, average: 126500 }],
      household: [{ categoryId: 1, name: "Mat", color: "", current: 395000, average: 253000 }],
    },
    portfolio: null,
    // 11 623 kr now + the salary 24 500 kr − 22 899 kr of bills = 13 224 kr on the 1st (the server's terms, as they come).
    monthStart: {
      date: "2026-10-01",
      balance: 1_322_400,
      cashOre: 426_000,
      month: "2026-09",
      foodOnly: false,
      partner: true,
      start: 1_162_300,
      terms: [
        { key: "income", label: "Lön", amount: 2_450_000, from: "2026-09-24", to: "2026-09-24", estimate: false, items: [{ date: "2026-09-24", name: "Lön", amount: 2_450_000, estimate: false }] },
        {
          key: "bills",
          label: "Räkningar",
          amount: -2_289_900,
          from: "2026-09-20",
          to: "2026-09-30",
          estimate: true,
          items: [
            { date: "2026-09-20", name: "Gym", amount: -39_900, estimate: false },
            { date: "2026-09-20", name: "Rörligt från banken", amount: -450_000, estimate: true },
            { date: "2026-09-25", name: "Hyra", amount: -750_000, estimate: false },
            { date: "2026-09-30", name: "Swedbank Mastercard Guld: faktura", amount: -1_050_000, estimate: false },
          ],
        },
      ],
    },
    situation: { moneyOre: 18_450_000, netExCsnOre: 18_300_000, netIncCsnOre: -14_800_000, bufferMonths: 0.03, bufferAccount: "Swedbank e-sparkonto" },
    warnings: [],
    upcomingInvoices: [],
    timeline: {
      from: "2026-09-19",
      to: "2026-10-02",
      payday: "2026-09-24",
      accountsTo: "2026-10-02",
      accountsTotal: 789900,
      events: [
        { date: "2026-09-20", kind: "expense", name: "Gym", amount: 39900, accountId: 2, onCard: false, status: "kommande", expenseId: 5, period: "2026-09" },
        { date: "2026-09-23", kind: "expense", name: "Spotify", amount: 18900, accountId: 3, onCard: true, status: "kommande", expenseId: 6, period: "2026-09" },
        { date: "2026-09-24", kind: "income", name: "Lön", amount: 2450000, accountId: 2, onCard: false, status: "expected" },
        { date: "2026-09-25", kind: "expense", name: "Hyra", amount: 750000, accountId: 2, onCard: false, status: "kommande", expenseId: 8, period: "2026-09" },
        { date: "2026-09-30", kind: "invoice", name: "Swedbank Mastercard Guld", amount: 1050000, accountId: 3, onCard: false, status: "unpaid", statementId: 7 },
        { date: "2026-09-25", kind: "work", name: "Schemadeadline: schema för oktober ska vara mottaget", amount: 0, accountId: null, onCard: false, status: "expected", month: "2026-10" },
      ],
      accounts: [
        {
          accountId: 2,
          accountName: ESPAR.name,
          kind: "bank",
          before: "2026-09-24",
          beforePayday: true,
          total: 39900,
          count: 1,
          windowTotal: 789900,
          windowCount: 2,
          items: [
            { expenseId: 5, period: "2026-09", name: "Gym", amount: 39900, dueDate: "2026-09-20", beforePayday: true },
            { expenseId: 8, period: "2026-09", name: "Hyra", amount: 750000, dueDate: "2026-09-25", beforePayday: false },
          ],
        },
      ],
    },
    tasks: [
      { id: "invoice:7", kind: "invoice_due", statementId: 7, accountId: 3, text: "Swedbank Mastercard Guld: faktura 10 500 kr förfaller 30/9" },
      { id: "review", kind: "review", count: 12, text: "12 att granska" },
      { id: "nightly_backup:failed:2026-09-23T03:45:02Z", kind: "backup", text: "Nattkopian av databasen misslyckades 23/9: disken är full" },
      {
        id: "missed_charge:9:2026-09",
        kind: "watch",
        text: "CSN (1 600 kr) skulle dragits 5/9 från Swedbank e-sparkonto men syns inte",
        finding: { key: "missed_charge:9:2026-09", kind: "missed_charge", text: "CSN …", date: "2026-09-05", accountId: 2, expenseId: 9, period: "2026-09", amount: 160000 },
      },
      {
        id: "price_drift:expense:4:194",
        kind: "watch",
        text: "Parkster: 215 kr i stället för 208 kr (+4 %)",
        finding: { key: "price_drift:expense:4:194", kind: "price_drift", text: "Parkster …", date: "2026-09-17", expenseId: 4, series: "expense:4", oldAmount: 20800, newAmount: 21511 },
      },
      {
        id: "double_charge:10:11",
        kind: "watch",
        text: "EXEMPELBUTIK AB: 249 kr dragen två gånger (7/9 och 8/9)",
        finding: { key: "double_charge:10:11", kind: "double_charge", text: "EXEMPELBUTIK …", date: "2026-09-08", accountId: 4, transactionId: 10, otherTransactionId: 11, amount: 24900 },
      },
      {
        id: "subscription_stopped:6:2026-06",
        kind: "watch",
        text: "Splice har inte dragits sedan juni – avslutat? Pausa den i verktyget",
        finding: { key: "subscription_stopped:6:2026-06", kind: "subscription_stopped", text: "Splice …", date: "2026-08-20", expenseId: 6, period: "2026-06" },
      },
      {
        id: "yearly_renewal:12:2026-10",
        kind: "watch",
        text: "TV-paketet förnyas 1/10 (1 500 kr), om 12 dagar – behålla den?",
        finding: { key: "yearly_renewal:12:2026-10", kind: "yearly_renewal", text: "TV-paketet …", date: "2026-10-01", expenseId: 12, period: "2026-10", amount: 150000, yearly: true },
      },
      {
        id: "return_deadline:7",
        kind: "watch",
        text: "Ångerrätten på Tangentbord går ut 23/9, om 3 dagar",
        finding: { key: "return_deadline:7", kind: "return_deadline", text: "Ångerrätten …", date: "2026-09-23", itemId: 7 },
      },
      {
        id: "maybe_item:42",
        kind: "watch",
        text: "KJELL & CO 1 299 kr 14/9 – är det en pryl?",
        finding: { key: "maybe_item:42", kind: "maybe_item", text: "KJELL …", date: "2026-09-14", transactionId: 42, amount: 129900, merchant: "KJELL & CO" },
      },
      {
        id: "yearly_renewal:13:2026-09",
        kind: "watch",
        text: "Bilskatt (2 800 kr) ska vara betald senast 30/9, om 11 dagar",
        finding: { key: "yearly_renewal:13:2026-09", kind: "yearly_renewal", text: "Bilskatt …", date: "2026-09-30", expenseId: 13, period: "2026-09", amount: 280000, yearly: true, invoice: true },
      },
    ],
  };
}

const CASHFLOW = {
  today: "2026-09-19",
  horizon: "2026-12-18",
  partner: true,
  partnerName: "Mio",
  start: 1000000,
  accounts: [],
  liquid: { accounts: [], depositedOre: 0, since: null, totalOre: 0 },
  buffer: 200000,
  days: [{ date: "2026-09-19", balance: 1000000, variable: 0, events: [] }],
  events: [],
  lowest: { date: "2026-09-19", balance: 1000000 },
  safeToSpend: 800000,
  variable: { perDay: 10000, total: 0, fuel: null, fullPerDay: 10000, bankPerDay: 10000, cards: [] },
  foodOnly: false,
  planned: [],
};

let fetchMock: ReturnType<typeof mockApi>;
/** The mocked routes; a test can swap one before it renders. */
let routes: Record<string, unknown>;
const navigated = vi.fn();
beforeEach(async () => {
  localStorage.clear();
  navigated.mockClear();
  // The dialog is app-wide state; a test that left it open must not reach the next.
  closeItemDialog();
  setShare("mine");
  routes = {
    "/categories": [cat(1, "Mat"), cat(2, "Livsmedel", 1), cat(3, "Bil")],
    "GET /overview": overview(),
    "GET /accounts": [],
    "/settings": { partnerSwishNumbers: [], partnerName: "Mio" },
    "GET /items/suggest/": { transactionId: 42, name: "KJELL & CO", merchant: "KJELL & CO", priceOre: 129900, purchaseDate: "2026-09-14", category: "Elektronik", icon: null, categoryOptions: ["Elektronik"] },
    "PUT /statements": {},
    "PUT /salary/schedule": {},
    "PUT /recurring-income": {},
    "PUT /recurring-expenses": {},
    "PUT /accounts": {},
    "POST /transactions": { id: 1 },
    "POST /watch": { ok: true },
    "PATCH /recurring-expenses": {},
    "GET /cashflow": { ...CASHFLOW },
    "GET /manual-data": [],
    "GET /digest": {
      from: "2026-09-14",
      to: "2026-09-20",
      title: "Veckan som gick (14–20/9)",
      lines: ["**Rörligt, min del:** 950 kr (snitt 8 veckor 1 000 kr, −5 %)", "**Nästa vecka:** 1 dragning, 7 500 kr", "Hyra 7 500 kr 25/9"],
      markdown: "",
      spent: 95000,
      average: 100000,
      largest: [
        { name: "Systembolaget", date: "2026-09-18", amount: 39700 },
        { name: "Amazon", date: "2026-09-15", amount: 33000 },
      ],
      coming: [{ name: "Hyra", date: "2026-09-25", amount: 750000 }],
      comingTotal: 750000,
      review: 0,
      safeToSpend: 456400,
      lowest: { date: "2026-09-24", balance: 456400 },
      sentAt: null,
      canSend: false,
    },
  };
  fetchMock = mockApi(routes);
  await reloadCategories();
});

function renderOverview() {
  return render(
    <TooltipProvider>
      <PageHeader title="Översikt" />
      <OverviewView onNavigate={navigated} />
      <ManualEntryHost />
      {/* Mounted in the app: 'Skapa pryl' from Att göra opens this one. */}
      <ItemDialogHost />
      <Toaster />
    </TooltipProvider>,
  );
}

describe("Översikt", () => {
  it("asks for the overview, the week and the API costs at once, not one after the other", () => {
    renderOverview();
    const asked = fetchMock.mock.calls.map(([u]) => String(u));
    expect(asked).toEqual(expect.arrayContaining(["/api/overview", "/api/digest", "/api/overview/api-costs"]));
  });

  it("answers first: the money there is now, and the days nothing was bought, in green", async () => {
    renderOverview();
    expect(await screen.findByRole("heading", { name: "Pengar nu" })).toBeInTheDocument();
    // The bank accounts and the cash on ISK.
    expect(screen.getAllByText("11 623 kr")).toHaveLength(2); // the big figure, and the first box of the way to the 1st
    expect([...screen.getByTestId("money-split").children].map((li) => li.textContent?.replace(/\s/g, " "))).toEqual(["Privatkonto 4 123", "e-sparkonto 6 000", "ISK-likvider 1 500"]);
    // No pace to measure against any more: the days nothing was bought instead.
    expect(screen.queryByText(/Utgiftstakt/)).toBeNull();
    const dots = screen.getByTestId("no-spend");
    expect(dots).toHaveTextContent("Dagar utan köp · 3 av 18");
    expect(dots.querySelectorAll('[data-status="free"]')).toHaveLength(3);
    expect(dots.querySelector('[data-date="2026-09-19"]')).toHaveAttribute("data-status", "today");
    expect(dots.querySelector('[data-date="2026-09-01"]')?.getAttribute("aria-label")?.replace(/\s/g, " ")).toBe("1/9: Kjell & Co 299 kr");
    expect(screen.getByText("Livsmedel och bilen (bränsle, parkering, trängselskatt med mera) räknas inte som köp.")).toBeInTheDocument();
    // How often the household ate out.
    const out = screen.getByTestId("eating-out");
    expect(out.textContent?.replace(/\s/g, " ")).toContain("Restaurang & hämtmat · 2 gånger");
    expect(out.querySelectorAll('[data-status="out"]')).toHaveLength(2);
    expect(out.querySelector('[data-date="2026-09-12"]')?.getAttribute("aria-label")?.replace(/\s/g, " ")).toBe("12/9: Max 145 kr");
  });

  it("the month so far as three rings, full at the usual for the same days, the figures beside them", async () => {
    renderOverview();
    const card = (await screen.findByRole("heading", { name: "September så här långt" })).closest("section")!;
    const svg = within(card).getByRole("img");
    expect(svg.getAttribute("aria-label")).toBe("Tre ringar, andel av snittet så här långt: Köp 118 %, Livsmedel 107 %, Restaurang & hämtmat 71 %. Dag 19 av 30.");
    expect(svg).toHaveTextContent("dag19/30");
    // Over the usual: a full lap and a red one from the top for what is over.
    const buy = svg.querySelector('[data-ring-arc="buy"]')!;
    expect(buy.querySelector("[data-lap]")).toHaveAttribute("data-lap", "1.000");
    expect(buy.querySelector("[data-over]")).toHaveAttribute("data-over", (448500 / 380000 - 1).toFixed(3));
    const eating = svg.querySelector('[data-ring-arc="eating-out"]')!;
    expect(eating.querySelector("[data-lap]")).toHaveAttribute("data-lap", (29000 / 41000).toFixed(3));
    expect(eating.querySelector("[data-over]")).toBeNull();

    const legend = within(card).getByRole("list", { name: "Förklaring till ringarna" });
    const row = (key: string) => legend.querySelector(`[data-ring="${key}"]`)!.textContent?.replace(/\s/g, " ");
    expect(row("buy")).toBe("Köp4 485 kr118 %snitt 3 800 kr så här långt · 6 200 kr/mån · 685 kr över");
    expect(row("groceries")).toBe("Livsmedel4 500 kr107 %snitt 4 200 kr så här långt · 8 200 kr/mån · 300 kr över");
    expect(row("eating-out")).toBe("Restaurang & hämtmat290 kr71 %2 gånger · snitt 410 kr så här långt · 720 kr/mån · 120 kr under");
    // Over or under in words, and in colour.
    expect(screen.getByTestId("grocery-usual").querySelector(".text-caution-text")).toHaveTextContent("300 kr över");
    expect(screen.getByTestId("eating-out-usual").querySelector(".text-positive-text")).toHaveTextContent("120 kr under");

    // The grocery shop week by week, against the usual week.
    const food = screen.getByLabelText("Livsmedel i september per vecka");
    expect(food.textContent?.replace(/\s/g, " ")).toContain("Livsmedel per veckavanlig vecka 1 900 kr");
    expect(food.querySelector('[data-week="37"]')?.getAttribute("title")?.replace(/\s/g, " ")).toBe("Vecka 37 (7–13/9): 2 100 kr");
    expect(food.querySelector('[data-week="38"]')?.getAttribute("title")?.replace(/\s/g, " ")).toBe("Vecka 38 (14–20/9): 600 kr hittills");
    expect(food.querySelector('[data-week="40"]')?.getAttribute("title")).toBe("Vecka 40 (28–30/9): inte än");
  });

  it("where the money is: a segment per account and the cash on ISK, in the Wallet colours, a small one still seen", async () => {
    renderOverview();
    const bar = await screen.findByTestId("money-bar");
    const parts = [...bar.children] as HTMLElement[];
    expect(parts.map((p) => p.getAttribute("data-part"))).toEqual(["a1", "a2", "isk"]);
    expect(parts.map((p) => [...p.classList].find((c) => c.startsWith("bg-")))).toEqual(["bg-wallet-private", "bg-wallet-savings", "bg-wallet-isk"]);
    for (const p of parts) expect(p).toHaveClass("min-w-1");
    expect(parts.map((p) => Number(p.style.flexGrow).toFixed(3))).toEqual([412300, 600000, 150000].map((o) => (o / 1162300).toFixed(3)));
  });

  it("the way to the 1st: the money now and the cash flow's terms, equal to Kvar vid månadsskiftet, each box telling what is in it", async () => {
    renderOverview();
    const eq = await screen.findByTestId("month-start");
    expect(within(eq).getByRole("heading").textContent).toBe("Så här blir det den 1 oktober");
    expect(eq).toHaveTextContent("när septembers räkningar är betalda");
    const box = (key: string) => eq.querySelector(`[data-term="${key}"]`)!.textContent?.replace(/\s/g, " ");
    // The server's own figures, in its order: nothing added up in the card.
    expect([...eq.querySelectorAll("[data-term]")].map((t) => t.getAttribute("data-term"))).toEqual(["start", "income", "bills", "result"]);
    expect(box("start")).toBe("Pengar nu11 623 kr");
    expect(box("income")).toBe("+Lön 24/9+24 500 kr");
    expect(box("bills")).toBe("−Räkningar 20/9–30/9−22 899 kr");
    expect(box("result")).toBe("=Kvar 1/1013 224 krvarav 4 260 på ISK");
    // What the bills are made of, on a tap.
    await userEvent.click(within(eq).getByRole("button", { name: /^minus Räkningar/ }));
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent?.replace(/\s/g, " ")).toContain("25/9 Hyra−7 500 kr");
    expect(tip.textContent?.replace(/\s/g, " ")).toContain("20/9 Rörligt från banken (uppskattat)−4 500 kr");
  });

  it("no salary before the 1st: no salary box", async () => {
    const data = overview();
    data.monthStart = { ...data.monthStart!, start: 1_162_300, balance: 1_162_300 - 2_289_900, terms: data.monthStart!.terms!.filter((t) => t.key !== "income") };
    routes["GET /overview"] = data;
    renderOverview();
    const eq = await screen.findByTestId("month-start");
    expect([...eq.querySelectorAll("[data-term]")].map((t) => t.getAttribute("data-term"))).toEqual(["start", "bills", "result"]);
    expect(eq.querySelector('[data-term="result"]')!.textContent?.replace(/\s/g, " ")).toBe("=Kvar 1/10−11 276 krvarav 4 260 på ISK");
  });

  it("the bills behind the pill in the corner: it opens the list under the card, and closes it", async () => {
    renderOverview();
    const card = (await screen.findByRole("heading", { name: "Pengar nu" })).closest("section")!;
    const pill = within(card).getByRole("button", { name: /^Räkningar till/ });
    expect(pill.textContent?.replace(/\s/g, " ")).toBe("Räkningar till 2/10−7 899 kr");
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(within(card).queryByRole("button", { name: /^e-sparkonto:/ })).toBeNull();
    await userEvent.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(within(card).getByRole("heading", { name: "Räkningar 20/9–25/9" })).toBeInTheDocument();
    const row = within(card).getByRole("button", { name: /^e-sparkonto:/ });
    expect(row.getAttribute("aria-label")?.replace(/\s/g, " ")).toBe("e-sparkonto: −7 899 kr dras 20/9–25/9 · 399 kr före lönen 24/9, 2 st");
    await userEvent.click(row);
    expect(within(card).getByText("Efter lönen 24/9")).toBeInTheDocument();
    expect(within(card).getByText("−7 500 kr")).toBeInTheDocument();
    await userEvent.click(pill);
    expect(within(card).queryByRole("button", { name: /^e-sparkonto:/ })).toBeNull();
  });

  it("the next salary: the estimate, changed for the month from the payslip", async () => {
    renderOverview();
    const line = await screen.findByTestId("salary-line");
    expect(line.textContent?.replace(/\s/g, " ")).toBe("Nästa lön 24/9 om 5 dagar, ca +24 500 kr (uppskattning · ändra)Kassaflöde →");
    await userEvent.click(within(line).getByRole("button", { name: "ändra" }));
    await userEvent.type(screen.getByLabelText("Förväntat för september"), "25000");
    await userEvent.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/recurring-income/1/overrides/2026-09")).toEqual([["/api/recurring-income/1/overrides/2026-09", { amount: 2500000 }]]));
  });

  it("a salary booked but not yet in the balance is still the next one: what is drawn is said by its days", async () => {
    const data = overview();
    data.today = "2026-09-24";
    data.payday = {
      ...data.payday!,
      date: "2026-09-25",
      daysUntil: 1,
      expected: 2620000,
      expectedSource: "forecast",
      forecast: { workMonth: "2026-08", payDate: "2026-09-25", gross: 3300000, net: 2620000, hours: 140, vacationHours: 80 },
      pending: { bookingDate: "2026-09-24", availableDate: "2026-09-25", amount: 2620000 },
    };
    data.balances = data.balances.map((b) =>
      b.id === 3
        ? { ...b, nextInvoice: { accountId: 3, accountName: b.name, periodFrom: "2026-09-04", periodTo: "2026-10-03", dueDate: "2026-10-30", soFar: 100000, expectedFixed: 120000, estimate: 310500 } }
        : b,
    );
    data.timeline = {
      ...data.timeline,
      from: "2026-09-24",
      to: "2026-10-07",
      payday: "2026-09-25",
      accountsTo: "2026-10-07",
      accountsTotal: 929900,
      events: [],
      accounts: [
        {
          accountId: 2,
          accountName: ESPAR.name,
          kind: "bank",
          before: "2026-09-25",
          beforePayday: true,
          total: 0,
          count: 0,
          windowTotal: 809900,
          windowCount: 2,
          items: [
            { expenseId: 8, period: "2026-09", name: "Hyra", amount: 750000, dueDate: "2026-09-25", beforePayday: false },
            { expenseId: 9, period: "2026-09", name: "Gym", amount: 59900, dueDate: "2026-09-30", beforePayday: false },
          ],
        },
        {
          accountId: 3,
          accountName: "Swedbank Mastercard Guld",
          kind: "credit_card",
          before: "2026-09-25",
          beforePayday: true,
          total: 0,
          count: 0,
          windowTotal: 120000,
          windowCount: 1,
          items: [{ expenseId: 6, period: "2026-09", name: "Claude", amount: 120000, dueDate: "2026-09-30", beforePayday: false }],
        },
      ],
    };
    routes["GET /overview"] = data;
    renderOverview();
    const card = (await screen.findByRole("heading", { name: "Pengar nu" })).closest("section")!;
    expect(within(card).getByTestId("salary-line").textContent?.replace(/\s/g, " ")).toBe(
      "Lön för september bokförd 24/9, i saldot 25/9 +26 200,00 kr, precis som beräknatKassaflöde →",
    );
    // Payday is tomorrow: the rows run the 14 days.
    await userEvent.click(within(card).getByRole("button", { name: /^Räkningar till 7\/10/ }));
    const row = (name: RegExp) => within(card).getByRole("button", { name }).getAttribute("aria-label")?.replace(/\s/g, " ");
    // Nothing leaves before the salary: the rent goes the day it comes.
    expect(row(/^e-sparkonto:/)).toBe("e-sparkonto: −8 099 kr dras 25/9–30/9, från lönen 25/9, 2 st");
    expect(row(/^Mastercard:/)).toBe("Mastercard: −1 200 kr på kortet 30/9, betalas med fakturan 30/10, 1 st");
  });

  it("with payday after the 14 days, the pill and the rows go to that salary", async () => {
    const data = overview();
    data.payday = { ...data.payday!, date: "2026-10-23", month: "2026-10", daysUntil: 34 };
    data.timeline = {
      ...data.timeline,
      payday: "2026-10-23",
      accountsTo: "2026-10-22",
      accounts: [{ ...data.timeline.accounts[0], before: "2026-10-23", total: 789900, count: 2, items: data.timeline.accounts[0].items.map((i) => ({ ...i, beforePayday: true })) }],
    };
    routes["GET /overview"] = data;
    renderOverview();
    const pill = await screen.findByRole("button", { name: /^Räkningar till 23\/10/ });
    await userEvent.click(pill);
    const row = screen.getByRole("button", { name: /^e-sparkonto:/ });
    expect(row.getAttribute("aria-label")?.replace(/\s/g, " ")).toBe("e-sparkonto: −7 899 kr dras 20/9–25/9, före lönen 23/10, 2 st");
  });

  it("a payslip read in for the month is what the next salary says: its amount, and a way to Lön", async () => {
    const data = overview();
    data.payday = {
      ...data.payday!,
      date: "2026-10-23",
      month: "2026-10",
      daysUntil: 3,
      expected: 2380228,
      expectedSource: "forecast",
      forecast: { workMonth: "2026-09", payDate: "2026-10-23", gross: 2940728, net: 2380228, hours: 147, vacationHours: 0, fromSpec: true },
    };
    routes["GET /overview"] = data;
    renderOverview();
    const line = await screen.findByTestId("salary-line");
    expect(line.textContent?.replace(/\s/g, " ")).toContain("+23 802 kr (enligt lönespecen för september · Lön)");
    expect(line.textContent).not.toContain("prognos");
    await userEvent.click(within(line).getByRole("button", { name: "Lön" }));
    expect(navigated).toHaveBeenCalledWith("salary");
  });

  it("the salary received this month, against the forecast", async () => {
    const data = overview();
    data.payday = { ...data.payday!, date: "2026-10-23", month: "2026-10", daysUntil: 34, received: { month: "2026-09", bookingDate: "2026-09-19", amount: 2620000, forecast: 2620000, diff: 0 } };
    routes["GET /overview"] = data;
    renderOverview();
    expect((await screen.findByTestId("salary-line")).textContent?.replace(/\s/g, " ")).toBe(
      "Lön för september +26 200,00 kr, precis som beräknat · nästa lön 23/10 om 34 dagar, ca +24 500 kr (uppskattning · ändra)Kassaflöde →",
    );
    // No bar to the next salary any more.
    expect(screen.queryByTestId("payday-bar")).toBeNull();
  });

  it("Att göra with nothing to do: one row with a tick", async () => {
    routes["GET /overview"] = { ...overview(), tasks: [] };
    renderOverview();
    const row = await screen.findByTestId("tasks-empty");
    expect(row.textContent).toBe("Att göraInget just nu");
  });

  it("Att göra: buttons act, and a task dismissed for the day stays dismissed", async () => {
    const { unmount } = renderOverview();
    const invoice = (await screen.findByText(/faktura 10 500 kr förfaller/)).closest("li")!;
    await userEvent.click(within(invoice).getByRole("button", { name: "Markera betald" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/statements/7/paid")).toEqual([["/api/statements/7/paid", { paid: true }]]));
    expect(await screen.findByText("Fakturan är markerad som betald.")).toBeInTheDocument();

    // Vakt: a missed draw is ticked off for its period.
    const missed = screen.getByText(/CSN \(1 600 kr\) skulle dragits 5\/9/).closest("li")!;
    await userEvent.click(within(missed).getByRole("button", { name: "Markera betald" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/recurring-expenses/9/marks/2026-09")).toHaveLength(1));
    // Or not drawn at all that month: paused for a while.
    await userEvent.click(within(missed).getByRole("button", { name: "Drogs inte (pausad)" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/recurring-expenses/9/marks/2026-09").at(-1)?.[1]).toEqual({ skipped: true }));
    expect(await screen.findByText("Ingen dragning väntas den månaden.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Avfärda för i dag: 12 att granska" }));
    // The task ticks itself off: the row stays a moment with a check drawn on
    // it, then collapses and is gone.
    const leaving = screen.getByText("12 att granska").closest("li")!;
    expect(leaving.querySelector("[data-check]")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("12 att granska")).not.toBeInTheDocument());
    unmount();
    renderOverview();
    await screen.findByText(/faktura 10 500 kr förfaller/);
    expect(screen.queryByText("12 att granska")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1 avfärdad i dag · visa igen" }));
    expect(screen.getByText("12 att granska")).toBeInTheDocument();
  });

  it("a failed nightly copy is a task that leads to the backups", async () => {
    renderOverview();
    const task = (await screen.findByText("Nattkopian av databasen misslyckades 23/9: disken är full")).closest("li")!;
    await userEvent.click(within(task).getByRole("button", { name: "Visa" }));
    expect(window.location.pathname).toBe("/installningar");
  });

  it("Vakt: accept a new price, keep both of a double charge (for good, with Ångra), pause a stopped subscription", async () => {
    renderOverview();
    const drift = (await screen.findByText("Parkster: 215 kr i stället för 208 kr (+4 %)")).closest("li")!;
    await userEvent.click(within(drift).getByRole("button", { name: "Acceptera nytt belopp" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/watch/accept")).toEqual([["/api/watch/accept", { key: "price_drift:expense:4:194" }]]));
    // Parkster with extra parking: its price isn't watched any more.
    await userEvent.click(within(drift).getByRole("button", { name: "Varierar – fråga inte" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/watch/mute")).toEqual([["/api/watch/mute", { key: "price_drift:expense:4:194" }]]));

    const double = screen.getByText(/EXEMPELBUTIK AB: 249 kr dragen två gånger/).closest("li")!;
    expect(within(double).getByRole("button", { name: "Visa" })).toBeInTheDocument();
    await userEvent.click(within(double).getByRole("button", { name: "Behåll båda" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/watch/dismiss")).toEqual([["/api/watch/dismiss", { key: "double_charge:10:11" }]]));
    // The toast queue is app-wide: the newest Ångra is this one.
    await userEvent.click((await screen.findAllByRole("button", { name: "Ångra" })).at(-1)!);
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/watch/restore")).toEqual([["/api/watch/restore", { key: "double_charge:10:11" }]]));

    const stopped = screen.getByText(/Splice har inte dragits sedan juni/).closest("li")!;
    await userEvent.click(within(stopped).getByRole("button", { name: "Pausa" }));
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/6")).toEqual([["/api/recurring-expenses/6", { paused: true }]]));
    // Dismissing a finding is for good (the server remembers), not for the day.
    expect(screen.getByRole("button", { name: /^Avfärda: Splice/ })).toBeInTheDocument();
  });

  it("Vakt, prylar: a deadline opens the thing, and a purchase that might be one is created or turned down", async () => {
    renderOverview();
    const deadline = (await screen.findByText(/Ångerrätten på Tangentbord/)).closest("li")!;
    await userEvent.click(within(deadline).getByRole("button", { name: "Visa prylen" }));
    // Goes to Prylar, where the intent opens that one.
    expect(navigated).toHaveBeenCalledWith("items");

    const maybe = screen.getByText(/är det en pryl\?/).closest("li")!;
    await userEvent.click(within(maybe).getByRole("button", { name: "Skapa pryl" }));
    // The dialog is the app's own, filled in from that row.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Handlare")).toHaveValue("KJELL & CO");
    await userEvent.click(within(dialog).getByRole("button", { name: "Avbryt" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await userEvent.click(within(maybe).getByRole("button", { name: "Nej" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/watch/dismiss").at(-1)).toEqual(["/api/watch/dismiss", { key: "maybe_item:42" }]));
    expect(await screen.findByText("Frågan kommer inte tillbaka för det köpet.")).toBeInTheDocument();
  });

  it("Vakt, yearly: a renewal kept (dismissed for good) or ended (paused); a bill marked paid for its period", async () => {
    renderOverview();
    const iptv = (await screen.findByText(/TV-paketet förnyas 1\/10/)).closest("li")!;
    await userEvent.click(within(iptv).getByRole("button", { name: "Avsluta" }));
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/12")).toEqual([["/api/recurring-expenses/12", { paused: true }]]));
    await userEvent.click(within(iptv).getByRole("button", { name: "Behåll" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/watch/dismiss")).toEqual([["/api/watch/dismiss", { key: "yearly_renewal:12:2026-10" }]]));
    const tax = screen.getByText(/Bilskatt \(2 800 kr\) ska vara betald senast/).closest("li")!;
    expect(within(tax).queryByRole("button", { name: "Avsluta" })).toBeNull();
    await userEvent.click(within(tax).getByRole("button", { name: "Markera betald" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/recurring-expenses/13/marks/2026-09")).toHaveLength(1));
  });

  it("Veckan som gick: the Sunday digest as five boxes", async () => {
    renderOverview();
    await screen.findByRole("heading", { name: "Pengar nu" });
    const digest = (await screen.findByRole("heading", { name: "Veckan som gick 14–20/9" })).closest("section")!;
    const box = (label: string) => within(digest).getByRole("heading", { name: label }).parentElement!.textContent?.replace(/\s/g, " ");
    expect(box("Rörligt, min del")).toBe("Rörligt, min del950 kr−5 % mot 8-veckorssnittet 1 000 kr");
    expect(box("Största köp")).toBe("Största köpSystembolaget397 krAmazon330 kr");
    expect(box("Nästa vecka")).toBe("Nästa vecka7 500 kr1 dragning: Hyra 7 500 kr 25/9");
    expect(box("Att granska")).toBe("Att granska0inga okategoriserade rader");
    expect(box("Safe to spend")).toBe("Safe to spend4 564 krlägst 4 564 kr den 24/9");
  });

  it("the tab Kassaflöde 90 dagar is in the address", async () => {
    window.history.replaceState(null, "", "/");
    renderOverview();
    await userEvent.click(await screen.findByRole("button", { name: "Kassaflöde 90 dagar" }));
    expect(window.location.search).toBe("?flik=kassaflode");
    expect(await screen.findByText("Safe to spend")).toBeInTheDocument();
    expect(screen.queryByText("Att göra")).not.toBeInTheDocument();
    window.history.replaceState(null, "", "/");
  });

  it("what is typed in by hand has a tab of its own, last in the row", async () => {
    window.history.replaceState(null, "", "/");
    renderOverview();
    await userEvent.click(await screen.findByRole("button", { name: "Att fylla i" }));
    expect(window.location.search).toBe("?flik=att-fylla-i");
    expect(await screen.findByText("Inget att fylla i än")).toBeInTheDocument();
    expect(screen.queryByText("Att göra")).not.toBeInTheDocument();
    window.history.replaceState(null, "", "/");
  });

  it("Ekonomisk situation: the money in total, and whether the buffer would carry three months", async () => {
    renderOverview();
    const row = (await screen.findByRole("heading", { name: "Ekonomisk situation" })).closest("section")!;
    const text = (row.textContent ?? "").replace(/\s/g, " ");
    // Pengar totalt, as the tab leads with; not the net.
    expect(text).toContain("pengar totalt");
    expect(text).toContain("184 500,00 kr");
    expect(text).not.toContain("183 000,00");
    // A buffer under six months is the one thing here worth a colour; under three, bold too.
    expect(within(row).getByText("0 mån")).toHaveClass("text-caution-text", "font-semibold");
    // Two figures and a link, nothing more: the sheet is a tab of its own.
    expect(text).not.toContain("312 456");
  });

  it("Ekonomisk situation splits the money into a bar: the securities by zone, the cash on ISK, the bank accounts", async () => {
    const data = overview();
    data.portfolio = { totalOre: 20_000_000, priceDate: "2026-09-18", zones: { base: 0.65, bet: 0.35 }, betState: "over", missing: 0, stale: 1 };
    routes["GET /overview"] = data;
    renderOverview();
    const card = (await screen.findByRole("heading", { name: "Ekonomisk situation" })).closest("section")!;
    const bar = within(card).getByTestId("situation-bar");
    expect([...bar.children].map((c) => `${c.getAttribute("data-part")} ${(c as HTMLElement).style.width}`)).toEqual([
      `base ${(13_000_000 / 21_162_300) * 100}%`,
      `bet ${(7_000_000 / 21_162_300) * 100}%`,
      `isk ${(150_000 / 21_162_300) * 100}%`,
      `bank ${(1_012_300 / 21_162_300) * 100}%`,
    ]);
    const legend = within(card).getByRole("list", { name: "Förklaring till fördelningen" });
    expect(legend.textContent?.replace(/\s/g, " ")).toBe("Värdepapper, basen 65 %Värdepapper, bet-zonen 35 %ISK-likvider 1 500 krBankkonton 10 123 kr");
    // The bet zone over its share: in words where it stands, and in orange.
    expect(within(legend).getByText("Värdepapper, bet-zonen 35 %")).toHaveClass("text-caution-text");
    expect(card.textContent?.replace(/\s/g, " ")).toContain("Fast i värdepapper 200 000,00 kr · kurser från 18/9 · 1 innehav med gammal kurs · bufferten 0 mån · Innehav · Balansräkning");
  });

  it("the tab Ekonomisk situation is in the address, and has the overview's own switch out of the way", async () => {
    window.history.replaceState(null, "", "/");
    renderOverview();
    await userEvent.click(await screen.findByRole("button", { name: "Ekonomisk situation" }));
    expect(window.location.search).toBe("?flik=situation");
    // Everything on this tab is my share by definition, so the Min del |
    // Hushållet control has nothing to say here.
    expect(screen.queryByRole("radiogroup", { name: "Vems utgifter" })).not.toBeInTheDocument();
    expect(screen.queryByText("Att göra")).not.toBeInTheDocument();
    window.history.replaceState(null, "", "/");
  });

  it("the pension has a tab of its own, to the right of Ekonomisk situation", async () => {
    window.history.replaceState(null, "", "/");
    renderOverview();
    const tabs = within(await screen.findByRole("navigation", { name: "Flikar" })).getAllByRole("button").map((b) => b.textContent);
    expect(tabs).toEqual(["Översikt", "Kassaflöde 90 dagar", "Ekonomisk situation", "Pension", "Att fylla i"]);
    await userEvent.click(screen.getByRole("button", { name: "Pension" }));
    expect(window.location.search).toBe("?flik=pension");
    expect(screen.queryByRole("radiogroup", { name: "Vems utgifter" })).not.toBeInTheDocument();
    expect(screen.queryByText("Att göra")).not.toBeInTheDocument();
    window.history.replaceState(null, "", "/");
  });

  it("the 14 days as a calendar list: today, the days with something on them, the quiet days folded", async () => {
    renderOverview();
    await screen.findByText("Kommande 14 dagar");
    const today = document.querySelector('[data-day="2026-09-19"]') as HTMLElement;
    expect(today.textContent).toBe("lör19sepI daginga dragningar");
    const gym = document.querySelector('[data-day="2026-09-20"]') as HTMLElement;
    expect(gym.textContent?.replace(/\s/g, " ")).toBe("sön20sepGym1 fast utgift−399 kr");
    const payday = document.querySelector('[data-day="2026-09-24"]') as HTMLElement;
    expect(payday.textContent?.replace(/\s/g, " ")).toBe("tor24sepLönlön+24 500 kr");
    const invoice = document.querySelector('[data-day="2026-09-30"]') as HTMLElement;
    expect(invoice.textContent?.replace(/\s/g, " ")).toBe("ons30sepFaktura Mastercardkortfaktura−10 500 kr");
    // The days with something on them, and the rest folded: 21–22, 26–29, 1–2 October.
    expect([...document.querySelectorAll("[data-day]")].map((d) => d.getAttribute("data-day"))).toEqual([
      "2026-09-19",
      "2026-09-20",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-30",
    ]);
    expect([...document.querySelectorAll("[data-days]")].map((d) => d.getAttribute("data-days"))).toEqual(["2026-09-21/2026-09-22", "2026-09-26/2026-09-29", "2026-10-01/2026-10-02"]);
    expect((document.querySelector('[data-days="2026-09-26/2026-09-29"]') as HTMLElement).textContent).toBe("lör–tis26–29sepinget planerat");
    // A row opens to the day's events.
    const rent = document.querySelector('[data-day="2026-09-25"]') as HTMLElement;
    await userEvent.click(within(rent).getByRole("button", { name: /^fre 25 sep: Hyra/ }));
    expect(within(rent).getByText("· e-sparkonto")).toBeInTheDocument();

  });

  it("the work schedule's deadline is a Jobb event of its own, ticked off as received", async () => {
    renderOverview();
    await screen.findByText("Kommande 14 dagar");
    expect(screen.getByRole("list", { name: "Förklaring" })).toHaveTextContent("jobb");
    const day = document.querySelector('[data-day="2026-09-25"]') as HTMLElement;
    expect(within(day).getByRole("button", { name: /^fre 25 sep:/ })).toHaveAccessibleName(/Schemadeadline: schema för oktober ska vara mottaget/);
    await userEvent.click(within(day).getByRole("button", { name: "Markera schemat för oktober som mottaget" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/salary/schedule/2026-10")).toEqual([["/api/salary/schedule/2026-10", { received: true }]]));
  });

  it("clicking a balance edits it; a card's menu marks its invoice paid", async () => {
    renderOverview();
    await screen.findByText("Saldon");
    await userEvent.click(screen.getAllByTitle("Uppdatera saldot")[0]);
    const input = screen.getByLabelText("Saldo på Swedbank Privatkonto");
    expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, "4 200{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/accounts/1/balance")).toEqual([["/api/accounts/1/balance", { balance: 420000, date: "2026-09-19" }]]));

    await userEvent.click(screen.getByRole("button", { name: "Mer för Swedbank Mastercard Guld" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Markera fakturan betald" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/statements/7/paid")).toHaveLength(1));
  });

  it("Saldon as Wallet cards: the colour says the kind, the invoice is on the card", async () => {
    renderOverview();
    await screen.findByText("Saldon");
    const card = (id: number) => document.querySelector(`[data-balance="${id}"]`) as HTMLElement;
    expect(card(1)).toHaveClass("bg-wallet-private");
    expect(card(2)).toHaveClass("bg-wallet-savings");
    expect(card(3)).toHaveClass("bg-wallet-gold");
    expect(card(1).textContent?.replace(/\s/g, " ")).toBe("Swedbank Privatkontouppdaterat i dag4 123,00 kr");
    expect(card(3).textContent?.replace(/\s/g, " ")).toContain("Faktura 10 500 kr · förfaller 30/9 om 11 dagar · obetald");
  });

  it("a card's worked-out debt says what it rests on", async () => {
    const data = overview();
    data.balances = data.balances.map((b) =>
      b.id === 3 ? { ...b, balance: -168_000, debt: { amountOre: 168_000, unpaid: 0, since: 168_000, settledTo: "2026-09-04", dueDate: "2026-09-30", invoicePaid: true, lastPurchase: "2026-09-18" } } : b,
    );
    fetchMock = mockApi({ "/categories": [cat(1, "Mat")], "GET /overview": data, "GET /accounts": [] });
    renderOverview();
    const card = (await screen.findByRole("heading", { name: "Swedbank Mastercard Guld" })).closest("[data-balance]")!;
    const text = card.textContent!.replace(/\s/g, " ");
    expect(text).toContain("skuld · fakturan betald + 1 680 kr köpt sedan 4/9 (inläst t.o.m. 18/9)");
    expect(within(card as HTMLElement).getByTitle("Uppdatera skulden")).toHaveTextContent("skuld1 680,00 kr");
    expect(text).not.toContain("från fakturan");
  });

  it("a card whose balance isn't followed shows no amount and can't be updated", async () => {
    const data = overview();
    data.balances = [...data.balances, { ...balance(4, "Bank Norwegian", "credit_card", -50000), source: "norwegian", trackBalance: false }];
    fetchMock = mockApi({ "/categories": [cat(1, "Mat")], "GET /overview": data, "GET /accounts": [] });
    renderOverview();
    const card = (await screen.findByRole("heading", { name: "Bank Norwegian" })).closest("[data-balance]")!;
    expect(card).toHaveTextContent("Bank Norwegian · inget saldo följs för kontot.");
    expect(within(card as HTMLElement).queryByTitle("Uppdatera skulden")).toBeNull();
    await userEvent.click(within(card as HTMLElement).getByRole("button", { name: "Mer för Bank Norwegian" }));
    expect(screen.queryByRole("menuitem", { name: "Uppdatera skuld" })).toBeNull();
  });

  it("Den här månaden as a treemap: a tile per category, the colour and the words say over or under; the rest as text", async () => {
    const data = overview();
    data.month.categories = [
      { categoryId: 1, name: "Mat", color: "", current: 363_600, average: 350_900 },
      { categoryId: 3, name: "Bil", color: "", current: 129_600, average: 53_500 },
      { categoryId: 4, name: "Prylar & hem", color: "", current: 29_500, average: 207_800 },
      { categoryId: 5, name: "Nöje", color: "", current: 9_000, average: 43_000 },
      { categoryId: 6, name: "Resor", color: "", current: 0, average: 80_100 },
      { categoryId: 7, name: "Övrigt", color: "", current: -1_600, average: 2_000 },
    ];
    routes["GET /overview"] = data;
    renderOverview();
    const map = await screen.findByTestId("treemap");
    const tile = (id: number) => map.querySelector(`[data-category="${id}"]`) as HTMLElement;
    // Sorted largest first; Nöje is under 3 % of the month and gets a line of text instead.
    expect([...map.querySelectorAll("[data-category]")].map((t) => t.getAttribute("data-category"))).toEqual(["1", "3", "4"]);
    expect(tile(1)).toHaveAttribute("data-status", "pace");
    expect(tile(1).textContent?.replace(/\s/g, " ")).toBe("Matsnitt 3 509 kr · i takt3 636 kr");
    expect(tile(3)).toHaveAttribute("data-status", "over");
    expect(tile(3).textContent?.replace(/\s/g, " ")).toContain("snitt 535 kr · 761 kr över");
    expect(tile(4)).toHaveAttribute("data-status", "under");
    // The largest takes the full height on the left.
    expect(tile(1).style.top).toBe("0%");
    expect(tile(1).style.height).toBe("100%");
    const card = map.closest("section")!;
    const text = card.textContent?.replace(/\s/g, " ");
    expect(text).toContain("Små: Nöje 90 kr (snitt 430 kr · 340 kr under)");
    expect(text).toContain("Tillbaka: Övrigt 16 kr (snitt 20 kr)");
    expect(text).toContain("Inget än: Resor (snitt 801)");
    // A tile opens the month's rows for its category.
    await userEvent.click(tile(3));
    expect(decodeURIComponent(window.location.href)).toMatch(/\/transaktioner\?category=3$/);
    window.history.replaceState(null, "", "/");
  });

  it("Min del | Hushållet is one switch for the app and is remembered", async () => {
    renderOverview();
    expect(await screen.findByText("Den här månaden, din del")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Hushållet" }));
    expect(screen.getByText("Den här månaden, hushållet")).toBeInTheDocument();
    expect(localStorage.getItem("privatekonomi.share")).toBe("household");
  });

  it("'Registrera' (also from the command palette) saves a one-off row and reloads", async () => {
    renderOverview();
    await screen.findByRole("heading", { name: "Pengar nu" });
    openManualEntry();
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByPlaceholderText("t.ex. Gåva från mormor"), "Gåva");
    await userEvent.type(within(dialog).getByLabelText("Belopp (kr)"), "500");
    await userEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/transactions")[0][1]).toMatchObject({ label: "Gåva", amount: 50000 }));
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/overview").length).toBeGreaterThanOrEqual(2));
  });
});
