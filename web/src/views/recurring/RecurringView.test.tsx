import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account, Category, ExpenseEstimates, RecurringExpense } from "../../api";
import { setShare } from "../../lib/share";
import { reloadCategories } from "../../categories";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { PageHeader } from "../../shell/PageHeader";
import { callsTo, mockApi } from "../../../test/api";
import { shiftMonth } from "./MonthCalendar";
import { RecurringView } from "./RecurringView";
import { todayIso } from "./model";

const cat = (id: number, name: string, parentId: number | null = null): Category => ({
  id,
  name,
  parentId,
  color: null,
  isTransfer: false,
  isSettlement: false,
  systemKey: null,
});
const account = (id: number, name: string, kind: Account["kind"] = "bank"): Account => ({
  id,
  name,
  balance: 0,
  balanceUpdatedAt: null,
  note: null,
  kind,
  source: kind === "bank" ? "swedbank" : "mastercard",
  accountRef: null,
  clearing: null, trackBalance: true,
});
const ACCOUNTS = [account(2, "Swedbank e-sparkonto"), account(3, "Swedbank Mastercard Guld", "credit_card")];
// This month in local time, as the view picks it (UTC is last month 00–02 on the 1st).
const MONTH = todayIso().slice(0, 7);

function expense(id: number, name: string, over: Partial<RecurringExpense> = {}): RecurringExpense {
  const amount = over.amount ?? 10000;
  return {
    id,
    name,
    amount,
    scheduleType: "day_of_month",
    anchorDay: 25,
    bankDayRule: "none",
    dateBasis: "booking",
    scheduleText: "fast dag 25",
    nextDate: `${MONTH}-25`,
    offSchedule: 0,
    suggestion: null,
    paymentMethod: "autogiro",
    accountId: 2,
    previousAccountId: null,
    accountFrom: null,
    matchPattern: name.toUpperCase(),
    shared: false,
    categoryId: 1,
    link: null,
    note: null,
    paused: false,
    lastPeriod: null,
    skippedPeriods: [],
    remindBeforeCharge: false,
    billingCycle: "monthly",
    yearlyAvailable: false,
    boundUntil: null,
    partOfId: null,
    partOfName: null,
    partNames: [],
    linkedCount: 3,
    latestCharge: { bookingDate: "2026-08-25", amount: -amount },
    amountChanged: false,
    latestExpected: amount,
    variesByMonth: false,
    thisMonthAmount: amount,
    thisMonth: { period: MONTH, dueDate: `${MONTH}-25`, status: "kommande", amount, transaction: null },
    ...over,
  };
}

const AVG = { from: "2026-06", to: "2026-08", household: 790000, mine: 434500, mineShare: 0.55 };
const ESTIMATES: ExpenseEstimates = {
  salary: { average: 2500000, count: 6, from: "2026-03", to: "2026-08" },
  food: { amount: 800000, mine: 440000, source: "entered", average: AVG },
  fuel: { amount: 162500, mine: 148000, source: "forecast", shifts: 14, average: { ...AVG, household: 190000, mine: 172900, mineShare: 0.91 } },
};

let expenses: RecurringExpense[];
let fetchMock: ReturnType<typeof mockApi>;
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  setShare("household");
  window.history.replaceState(null, "", "/fasta-utgifter");
  expenses = [
    expense(1, "Hyra", { amount: 750000, thisMonthAmount: 750000 }),
    expense(2, "CSN", {
      anchorDay: 30,
      amountChanged: true,
      amount: 185000,
      thisMonthAmount: 185000,
      latestExpected: 185000,
      latestCharge: { bookingDate: "2026-08-31", amount: -186000 },
    }),
    expense(3, "Spotify", { accountId: 3, anchorDay: 23, paymentMethod: "credit_card", amount: 18900, thisMonthAmount: 18900 }),
  ];
  fetchMock = mockApi(routesNow());
  await reloadCategories();
});

/** The API as the tests start from (expenses read at call time). */
function routesNow() {
  return {
    "/categories": [cat(1, "Boende"), cat(4, "Nöje")],
    "GET /recurring-expenses/calendar": [{ expenseId: 1, period: MONTH, date: `${MONTH}-25` }],
    "GET /recurring-expenses/estimates": ESTIMATES,
    "PUT /recurring-expenses/estimates": { ...ESTIMATES, food: { ...ESTIMATES.food, amount: 790000, mine: 432000 } },
    "GET /recurring-expenses/": (url: string) => (url.includes("/months") ? [] : { months: [], charges: [] }),
    "GET /recurring-expenses": () => expenses,
    "GET /accounts": ACCOUNTS,
    "GET /recurring-income": [],
    "GET /salary/schedule": [{ date: `${MONTH}-25`, month: shiftMonth(MONTH, 1), name: "Schemadeadline: schema för nästa månad ska vara mottaget", received: false }],
    "PUT /salary/schedule": {},
    "PATCH /recurring-expenses": (url: string, init: { json?: unknown }) => {
      const id = Number(url.split("/").pop());
      expenses = expenses.map((e) => (e.id === id ? { ...e, ...(init.json as object) } : e));
      return expenses.find((e) => e.id === id);
    },
    "POST /recurring-expenses": (_: string, init: { json?: unknown }) => {
      const created = expense(9, (init.json as { name: string }).name, init.json as Partial<RecurringExpense>);
      expenses = [...expenses, created];
      return created;
    },
    "PUT /recurring-expenses": { ok: true },
  };
}

function renderView() {
  return render(
    <TooltipProvider>
      <PageHeader title="Fasta utgifter" />
      <RecurringView />
      <Toaster />
    </TooltipProvider>,
  );
}
const panelTitle = () => document.querySelector("[role=dialog][data-side-panel] h2")?.textContent ?? null;

describe("Fasta utgifter", () => {
  it("summarises and groups per account with subtotals; groups fold", async () => {
    renderView();
    const total = (await screen.findByRole("heading", { name: "Fasta utgifter per månad, hushållet" })).closest("section")!;
    expect(within(total).getByText(/^9\s539 kr$/)).toBeInTheDocument(); // 7 500 + 1 850 + 189
    // The household's sum isn't set against my salary.
    expect(total).not.toHaveTextContent(/lönen/);
    const group = screen.getByRole("button", { name: /Swedbank e-sparkonto/ });
    expect(group).toHaveTextContent(/9\s350 kr\/mån/);
    expect(document.querySelectorAll('[data-group="2"] [data-expense]')).toHaveLength(2);
    await userEvent.click(group);
    expect(document.querySelectorAll('[data-group="2"] [data-expense]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-group="3"] [data-expense]')).toHaveLength(1);
    // Folded groups are remembered for the session: open it again for the other tests.
    await userEvent.click(group);
    expect(document.querySelectorAll('[data-group="2"] [data-expense]')).toHaveLength(2);
  });

  it("Min del: shared expenses at half in the rows, subtotals and cards; food and fuel on top", async () => {
    expenses = expenses.map((e) => (e.name === "Hyra" ? { ...e, shared: true } : e));
    renderView();
    await screen.findByRole("heading", { name: "Fasta utgifter per månad, hushållet" });
    await userEvent.click(screen.getByRole("radio", { name: "Min del" }));
    const total = screen.getByRole("heading", { name: "Fasta utgifter per månad, min del" }).closest("section")!;
    const figure = (name: string) => total.querySelector(`[data-figure="${name}"]`) as HTMLElement;
    await waitFor(() => expect(figure("total")).toHaveTextContent(/^5\s789 kr$/)); // 3 750 + 1 850 + 189, counted up to
    // No breakdown under it: Eget has a card of its own.
    expect(total).not.toHaveTextContent(/delat/);
    expect(await within(screen.getByLabelText("Eget och årsvis")).findByText(/^2\s039 kr$/)).toBeInTheDocument();
    const hyra = document.querySelector('[data-expense="1"]') as HTMLElement;
    expect(hyra).toHaveTextContent(/3\s750 kr/);
    expect(hyra).toHaveTextContent(/halva av 7\s500 kr/);
    expect(screen.getByRole("button", { name: /Swedbank e-sparkonto/ })).toHaveTextContent(/5\s600 kr\/mån/);
    // With food and fuel, my part of each: 5 789 + 4 400 + 1 480.
    await waitFor(() => expect(figure("with-food")).toHaveTextContent(/Med mat och bränsle 11\s669 kr/));
    expect(figure("with-food")).toHaveTextContent(/av snittlönen 25\s000 kr/);
    // What is left of the usual salary: without food and fuel in words, with them as the bar's last segment.
    expect(total).toHaveTextContent(/utan mat och bränsle är 19\s211 kr kvar av lönen/);
    const left = total.querySelector('[data-segment="left"]') as HTMLElement;
    expect(left.dataset.ore).toBe("1333100");
  });

  it("Den här månaden: what is left to draw is the groups' 'kvar denna månad' added up", async () => {
    expenses = expenses.map((e) => (e.name === "CSN" ? { ...e, thisMonth: { ...e.thisMonth!, status: "dragen" } } : e));
    renderView();
    const card = (await screen.findByRole("heading", { name: "Den här månaden" })).closest("section")!;
    // Hyra 7 500 and Spotify 189 are still to come; CSN is drawn.
    await waitFor(() => expect(card.querySelector('[data-figure="left-to-draw"]')).toHaveTextContent(/^7\s689 kr$/));
    expect(card).toHaveTextContent(/kvar att dra · 2 av 3 kommande/);
    expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("button", { name: /Swedbank e-sparkonto/ })).toHaveTextContent(/kvar denna månad 7\s500 kr/);
    expect(screen.getByRole("button", { name: /Swedbank Mastercard Guld/ })).toHaveTextContent(/kvar denna månad 189 kr/);
  });

  it("the salary bar: the household's has no salary; over the salary it says by how much", async () => {
    renderView();
    const bar = await screen.findByRole("img", { name: /^Fasta 9\s539\skr, Mat 8\s000\skr, Bränsle 1\s625\skr$/ });
    expect(bar.querySelector('[data-segment="left"]')).toBeNull();
    cleanup();
    setShare("mine");
    expenses = expenses.map((e) => (e.name === "Hyra" ? { ...e, amount: 2000000, thisMonthAmount: 2000000 } : e));
    renderView();
    const over = await screen.findByRole("img", { name: /över snittlönen$/ });
    expect(over).toHaveAttribute("data-over");
    // 20 000 + 1 850 + 189 + 4 400 + 1 480 = 27 919 against 25 000.
    expect(over).toHaveAccessibleName(/2\s919\skr över snittlönen$/);
    // 20 000 + 1 850 + 189 = 22 039 is under 25 000 on its own.
    expect(screen.getByRole("heading", { name: "Fasta utgifter per månad, min del" }).closest("section")).toHaveTextContent(/utan mat och bränsle är 2\s961 kr kvar av lönen/);
  });

  it("remembers a folded group on the device (localStorage) until it is opened again", async () => {
    renderView();
    await userEvent.click(await screen.findByRole("button", { name: /Swedbank e-sparkonto/ }));
    expect(JSON.parse(localStorage.getItem("recurring.collapsed")!)).toEqual(["2"]);
    cleanup();
    sessionStorage.clear();
    renderView();
    const group = await screen.findByRole("button", { name: /Swedbank e-sparkonto/ });
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelectorAll('[data-group="2"] [data-expense]')).toHaveLength(0);
    await userEvent.click(group);
    expect(JSON.parse(localStorage.getItem("recurring.collapsed")!)).toEqual([]);
  });

  it("tags and statuses: bound, paused, off schedule, a rise, parts of a draw and the yearly ones", async () => {
    expenses = [
      expense(1, "Hyra", { boundUntil: "2027-03", thisMonth: { period: MONTH, dueDate: `${MONTH}-25`, status: "dragen", amount: 10000, transaction: null } }),
      expense(2, "Splice", { paused: true, thisMonth: null, nextDate: null }),
      expense(3, "Claude", { offSchedule: 1, amountChanged: true, latestExpected: 120000, latestCharge: { bookingDate: "2026-09-01", amount: -103800 } }),
      expense(4, "Bredband", { partNames: ["Mobilabonnemang"], thisMonth: { period: MONTH, dueDate: `${MONTH}-25`, status: "forfallen", amount: 10000, transaction: null } }),
      expense(5, "Mobilabonnemang", { partOfName: "Bredband" }),
      expense(6, "TV-paketet", {
        billingCycle: "yearly",
        anchorMonth: 10,
        anchorDay: 1,
        thisMonth: null,
        thisYear: { period: "2026-10", dueDate: "2026-10-01", status: "kommande", amount: 162000, transaction: null },
      }),
      expense(7, "Bilskatt", {
        billingCycle: "yearly",
        anchorMonth: 6,
        anchorDay: 30,
        thisMonth: null,
        thisYear: { period: "2026-06", dueDate: "2026-06-30", status: "dragen", amount: 284000, transaction: { id: 1, bookingDate: "2026-06-09", amount: -284000 } },
      }),
    ];
    renderView();
    await screen.findByText("Splice");
    const row = (id: number) => document.querySelector(`[data-expense="${id}"]`) as HTMLElement;
    const pill = (id: number, text: string) => within(row(id)).getByText(text);
    expect(pill(1, "bunden")).toHaveAttribute("data-pill", "grey");
    expect(within(row(1)).getByText("dragen")).toHaveClass("bg-positive-soft", "text-positive-text");
    expect(pill(2, "pausad")).toHaveAttribute("data-pill", "grey");
    expect(within(row(2)).getByText("Splice")).toHaveClass("text-ink-3");
    expect(pill(3, "1 avvek")).toHaveAttribute("data-pill", "orange");
    expect(within(row(3)).getByLabelText("Beloppet har ändrats").parentElement).toHaveClass("text-caution-text");
    expect(within(row(3)).getByText("kommande")).toHaveClass("bg-card-inset", "text-ink-2");
    expect(pill(4, "+ Mobilabonnemang")).toHaveAttribute("data-pill", "blue");
    expect(within(row(4)).getByText("förfallen")).toHaveClass("bg-alarm-soft");
    expect(pill(5, "i Bredbands dragning")).toHaveAttribute("data-pill", "blue");
    expect(row(6)).toHaveTextContent(/kommande i år/);
    expect(row(6)).toHaveTextContent(/per år/);
    expect(row(7)).toHaveTextContent(/dragen i år/);
    expect(row(7)).toHaveTextContent(/30 jun/);
  });

  it("Uppskattat: food entered for the household (or back to the average), fuel from Pendling", async () => {
    renderView();
    const section = (await screen.findByRole("heading", { name: "Uppskattat" })).closest("section")!;
    expect(within(section).getByLabelText("Mat per månad, hushållet")).toHaveValue("8000");
    expect(section).toHaveTextContent(/livsmedel, restaurang och hämtmat: snitt juni–aug 7\s900 kr\/mån, din del 4\s345 kr \(55 %\)/);
    expect(section).toHaveTextContent(/enligt Pendling & bränsle \(14 pass den här månaden\)/);
    await userEvent.click(within(section).getByRole("button", { name: "använd snittet" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/recurring-expenses/estimates")).toEqual([["/api/recurring-expenses/estimates", { food: null }]]));
    const field = within(section).getByLabelText("Mat per månad, hushållet");
    await userEvent.clear(field);
    await userEvent.type(field, "7500{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/recurring-expenses/estimates").at(-1)).toEqual(["/api/recurring-expenses/estimates", { food: 750000 }]));
  });

  it("a picture from the panel: asks whether it is only this expense or every purchase at the rule's merchant", async () => {
    expenses = [...expenses, expense(4, "Pocket", { icon: { brand: "apple" }, iconRule: { id: 7, pattern: "APPLE.COM/BILL", hasImage: false } })];
    fetchMock = mockApi({
      ...routesNow(),
      "POST /recurring-expenses/4/icon": { iconPath: "aaaaaaaaaaaaaaaaaaaa.png" },
      "POST /rules/7/icon": { iconPath: "bbbbbbbbbbbbbbbbbbbb.png", icon: { image: "/api/icons/bbbbbbbbbbbbbbbbbbbb.png" } },
    });
    renderView();
    await userEvent.click(await screen.findByText("Pocket"));
    const panel = await screen.findByRole("dialog", { name: "Pocket" });
    expect(within(panel).getByText("Varumärkets ikon.")).toBeInTheDocument();
    const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "pocket.png", { type: "image/png" });

    await userEvent.upload(within(panel).getByLabelText("Välj bild"), png());
    const ask = await screen.findByRole("dialog", { name: "Var ska bilden gälla?" });
    expect(within(ask).getByText("Gäller bilden bara Pocket, eller alla köp hos APPLE.COM/BILL?")).toBeInTheDocument();
    // The default is only the expense.
    await waitFor(() => expect(within(ask).getByRole("button", { name: "Bara Pocket" })).toHaveFocus());
    await userEvent.click(within(ask).getByRole("button", { name: "Alla köp hos APPLE.COM/BILL" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/rules/7/icon")).toHaveLength(1));
    expect(callsTo(fetchMock, "POST", "/recurring-expenses/4/icon")).toHaveLength(0);

    await userEvent.upload(within(panel).getByLabelText("Välj bild"), png());
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/recurring-expenses/4/icon")).toHaveLength(1));
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/recurring-expenses/4/icon"))!;
    expect(((init as RequestInit).body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("yearly expenses: their own group last, the date, this year's status, and what to put aside a month", async () => {
    expenses = [
      ...expenses,
      expense(6, "Bilskatt", {
        billingCycle: "yearly",
        anchorDay: 30,
        anchorMonth: 6,
        amount: 284000,
        thisMonthAmount: 284000,
        nextDate: "2027-06-30",
        thisMonth: null,
        thisYear: { period: "2026-06", dueDate: "2026-06-30", status: "dragen", amount: 284000, transaction: { id: 1, bookingDate: "2026-06-09", amount: -284000 } },
      }),
    ];
    renderView();
    await screen.findByText("Bilskatt");
    const groups = [...document.querySelectorAll("[data-group]")].map((g) => g.getAttribute("data-group"));
    expect(groups.at(-1)).toBe("yearly");
    const group = document.querySelector('[data-group="yearly"]') as HTMLElement;
    expect(within(group).getByRole("button", { name: /Årsvis/ })).toHaveTextContent(/2\s840 kr\/år/);
    const row = within(group).getByText("Bilskatt").closest("[data-expense]") as HTMLElement;
    expect(row).toHaveTextContent("30 jun");
    expect(row).toHaveTextContent("i år");
    // In a card of its own with Eget, not in the monthly sum.
    const card = screen.getByLabelText("Eget och årsvis");
    expect(await within(card).findByText(/^2\s840 kr$/)).toBeInTheDocument();
    expect(card).toHaveTextContent(/per år · 237 kr\/mån/);
    expect(card).toHaveTextContent(/Eget/);
    expect(screen.queryByText("Nästa 7 dagar")).toBeNull();
    // Not in the monthly sum: that is what is drawn every month.
    const total = screen.getByRole("heading", { name: "Fasta utgifter per månad, hushållet" }).closest("section")!;
    expect(await within(total).findByText(/^9\s539 kr$/)).toBeInTheDocument();
  });

  it("priced in euro: the price and VAT, what it comes to in kronor, and a new price compared in euro", async () => {
    expenses = [
      ...expenses,
      expense(6, "Claude", {
        amount: 127400,
        currency: "EUR",
        foreignAmount: 9000,
        vatPercent: 25,
        foreignPrice: { currency: "EUR", price: 9000, vatPercent: 25, withVat: 11250, rate: 11.272, rateDate: "2026-09-23", markup: 0.005, amount: 127400 },
        amountChanged: true,
        latestCharge: { bookingDate: "2026-08-30", amount: -25460 },
        latestForeign: { currency: "EUR", expected: 11250, charged: 2250 },
      }),
    ];
    renderView();
    await userEvent.click(await screen.findByText("Claude"));
    const panel = await screen.findByRole("dialog", { name: "Claude" });
    expect(within(panel).getByText(/Priset har ändrats 112,50 € → 22,50 € \(med moms\)/)).toBeInTheDocument();
    expect(within(panel).getByRole("radio", { name: "EUR" })).toBeChecked();
    expect(within(panel).getByLabelText("Pris i EUR utan moms")).toHaveValue("90");
    expect(within(panel).getByTestId("foreign-price").textContent?.replace(/\s/g, " ")).toBe(
      "1 274 kr per månad112,50 € med moms × 11,272 (Riksbanken 23/9) + bankens påslag 0,5 %. Följer kursen varje dag.",
    );
    // Pro: 18 € before VAT.
    const price = within(panel).getByLabelText("Pris i EUR utan moms");
    await userEvent.clear(price);
    await userEvent.type(price, "18{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/6").at(-1)?.[1]).toEqual({ foreignAmount: 1800 }));
    // Back to kronor.
    await userEvent.click(within(panel).getByRole("radio", { name: "kr" }));
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/6").at(-1)?.[1]).toEqual({ currency: null, foreignAmount: null, vatPercent: null }));
  });

  it("a new price from the next draw: the month and the price, in euro before VAT for one priced in euro; shown until it is the price", async () => {
    expenses = [
      ...expenses,
      expense(6, "Claude", {
        amount: 127400,
        currency: "EUR",
        foreignAmount: 9000,
        vatPercent: 25,
        nextPeriod: "2026-09",
        foreignPrice: { currency: "EUR", price: 9000, vatPercent: 25, withVat: 11250, rate: 11.272, rateDate: "2026-09-23", markup: 0.005, amount: 127400 },
      }),
    ];
    renderView();
    await userEvent.click(await screen.findByText("Claude"));
    const panel = await screen.findByRole("dialog", { name: "Claude" });
    await userEvent.click(within(panel).getByRole("button", { name: "Ändra pris från nästa dragning…" }));
    const form = within(panel).getByRole("form", { name: "Ändra pris" });
    // From the next draw's month by default.
    expect(within(form).getByLabelText("Från månad")).toHaveValue("2026-09");
    await userEvent.selectOptions(within(form).getByLabelText("Från månad"), "2026-10");
    await userEvent.type(within(form).getByLabelText("Nytt pris i EUR utan moms"), "18");
    await userEvent.click(within(form).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/6").at(-1)?.[1]).toEqual({ nextFrom: "2026-10", nextForeignAmount: 1800 }));
    // The server has worked out the kronor.
    expenses = expenses.map((e) => (e.id === 6 ? { ...e, nextFrom: "2026-10", nextForeignAmount: 1800, nextAmount: 25480 } : e));
    cleanup();
    renderView();
    await userEvent.click(await screen.findByText("Claude"));
    const again = await screen.findByRole("dialog", { name: "Claude" });
    expect(within(again).getByTestId("price-change").textContent?.replace(/\s/g, " ")).toContain("Från oktober 2026: 255 kr (22,50 € med moms)");
    await userEvent.click(within(within(again).getByTestId("price-change")).getByRole("button", { name: "Ta bort" }));
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/6").at(-1)?.[1]).toEqual({ nextFrom: null }));
  });

  it("switching an expense to euro starts with 25 % VAT", async () => {
    renderView();
    await userEvent.click(await screen.findByText("CSN"));
    const panel = await screen.findByRole("dialog", { name: "CSN" });
    await userEvent.click(within(panel).getByRole("radio", { name: "EUR" }));
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/2").at(-1)?.[1]).toEqual({ currency: "EUR", vatPercent: 25 }));
  });

  it("a yearly expense gets a month next to its day", async () => {
    expenses = [...expenses, expense(5, "Bilskatt", { billingCycle: "yearly", anchorDay: 30, anchorMonth: null })];
    renderView();
    await userEvent.click(await screen.findByText("Bilskatt"));
    const panel = await screen.findByRole("dialog", { name: "Bilskatt" });
    expect(within(panel).getByText("Datum")).toBeInTheDocument();
    await userEvent.selectOptions(within(panel).getByLabelText("Månad"), "juni");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/5").at(-1)?.[1]).toEqual({ anchorMonth: 6 }));
    // A monthly one has no month.
    await userEvent.click(screen.getByText("Hyra"));
    expect(within(await screen.findByRole("dialog", { name: "Hyra" })).queryByLabelText("Månad")).toBeNull();
  });

  it("a picture that is too big or of the wrong type is refused before it is sent", async () => {
    expenses = [...expenses, expense(4, "Pocket")];
    renderView();
    await userEvent.click(await screen.findByText("Pocket"));
    const panel = await screen.findByRole("dialog", { name: "Pocket" });
    const input = within(panel).getByLabelText("Välj bild");
    await userEvent.upload(input, new File([new Uint8Array(201 * 1024)], "stor.png", { type: "image/png" }));
    expect((await screen.findAllByText(/högst 200 kB går/)).at(-1)).toBeInTheDocument();
    await userEvent.upload(input, new File(["GIF89a"], "bild.gif", { type: "image/gif" }), { applyAccept: false });
    expect((await screen.findAllByText("Bara PNG, JPG, WebP eller SVG går.")).at(-1)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/icon"))).toHaveLength(0);
  });

  it("the table is read-only: j/k move, Enter opens the panel, which follows the row", async () => {
    renderView();
    await screen.findByText("Hyra");
    expect(document.querySelector("table select, table input")).toBeNull();
    await userEvent.keyboard("j");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(panelTitle()).toBe("Hyra"));
    await userEvent.keyboard("j");
    await waitFor(() => expect(panelTitle()).toBe("CSN"));
    await userEvent.keyboard("k");
    await waitFor(() => expect(panelTitle()).toBe("Hyra"));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(panelTitle()).toBeNull());
  });

  it("the panel saves a field, updates a changed amount and marks this month paid", async () => {
    renderView();
    await userEvent.click(await screen.findByText("CSN"));
    const panel = await screen.findByRole("dialog", { name: "CSN" });
    expect(within(panel).getByText(/Beloppet har ändrats 1\s850 kr → 1\s860 kr/)).toBeInTheDocument();

    const name = within(panel).getByLabelText("Namn");
    await userEvent.clear(name);
    await userEvent.type(name, "CSN lån{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/2")).toEqual([["/api/recurring-expenses/2", { name: "CSN lån" }]]));

    await userEvent.click(within(panel).getByRole("button", { name: "Uppdatera" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/recurring-expenses/2/accept-latest-amount")).toHaveLength(1));

    await userEvent.click(within(panel).getByRole("button", { name: "Markera betald" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", `/recurring-expenses/2/marks/${MONTH}`)).toEqual([[`/api/recurring-expenses/2/marks/${MONTH}`, { paid: true }]]));
  });

  it("moved to another card: the one before up to a month, which can be changed or undone", async () => {
    expenses = expenses.map((e) => (e.id === 3 ? { ...e, accountId: 2, previousAccountId: 3, accountFrom: "2026-10" } : e));
    renderView();
    await userEvent.click(await screen.findByText("Spotify"));
    const panel = await screen.findByRole("dialog", { name: "Spotify" });
    expect(within(panel).getByTestId("account-move")).toHaveTextContent(/Swedbank Mastercard Guld till och med september 2026\. Dragningar före bytet kopplas dit/);
    fireEvent.change(within(panel).getByLabelText("Nytt konto från"), { target: { value: "2026-11" } });
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/3").at(-1)?.[1]).toEqual({ accountFrom: "2026-11" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Kontot var fel från början" }));
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/3").at(-1)?.[1]).toEqual({ previousAccountId: null }));
  });

  it("paused after a last draw: counted and shared up to it", async () => {
    expenses = expenses.map((e) => (e.id === 3 ? { ...e, paused: true, lastPeriod: "2026-09" } : e));
    renderView();
    await userEvent.click(await screen.findByText("Spotify"));
    const panel = await screen.findByRole("dialog", { name: "Spotify" });
    expect(within(panel).getByText("Uppsagd efter sista dragningen")).toBeInTheDocument();
    expect(within(panel).getByTestId("last-period")).toHaveTextContent("Räknas, kopplas och delas till och med september 2026, sedan inte.");
    fireEvent.change(within(panel).getByLabelText("Sista dragning"), { target: { value: "2026-10" } });
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/3").at(-1)?.[1]).toEqual({ lastPeriod: "2026-10" }));
  });

  it("the rent's notices: month, due day, paid or not, and the PDF", async () => {
    fetchMock = mockApi({
      ...routesNow(),
      "GET /rent-notices": (url: string) =>
        url.includes("expenseId=1")
          ? [
              { id: 7, issuer: "Exempel Förvaltning AB", number: "102", noticeDate: "2026-09-11", dueDate: "2026-10-30", rentMonth: "2026-11", period: "2026-10", amount: 750000, lines: [], bankgiro: null, paid: null },
              { id: 6, issuer: "Exempel Förvaltning AB", number: "101", noticeDate: "2026-09-11", dueDate: "2026-09-30", rentMonth: "2026-10", period: "2026-09", amount: 750000, lines: [], bankgiro: null, paid: { date: "2026-09-25", amount: 750000 } },
            ]
          : [],
    });
    renderView();
    await userEvent.click(await screen.findByText("Hyra"));
    const panel = await screen.findByRole("dialog", { name: "Hyra" });
    const [nov, oct] = within(await within(panel).findByTestId("rent-notices")).getAllByRole("listitem");
    expect(nov).toHaveTextContent("november 2026avi 102 · förfaller 30/10inte betald");
    expect(oct).toHaveTextContent("oktober 2026avi 101 · förfaller 30/9 · betald 25/9");
    expect(within(oct).getByRole("link", { name: "Öppna avi 101 (PDF)" })).toHaveAttribute("href", "/api/rent-notices/6/pdf");
  });

  it("months without a draw: listed, added and taken away", async () => {
    expenses = expenses.map((e) => (e.id === 3 ? { ...e, skippedPeriods: ["2026-07"] } : e));
    renderView();
    await userEvent.click(await screen.findByText("Spotify"));
    const panel = await screen.findByRole("dialog", { name: "Spotify" });
    const block = within(panel).getByTestId("skipped-months");
    expect(block).toHaveTextContent("juli 2026");
    fireEvent.change(within(block).getByLabelText("Månad utan dragning"), { target: { value: "2026-08" } });
    await userEvent.click(within(block).getByRole("button", { name: "Lägg till" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/recurring-expenses/3/marks/2026-08")).toEqual([["/api/recurring-expenses/3/marks/2026-08", { skipped: true }]]));
    await userEvent.click(within(block).getByRole("button", { name: "Ta bort juli 2026" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/recurring-expenses/3/marks/2026-07")).toEqual([["/api/recurring-expenses/3/marks/2026-07", { skipped: false }]]));
  });

  it("an expense can be drawn together with another: it then follows that one's day and account", async () => {
    renderView();
    await userEvent.click(await screen.findByText("Spotify"));
    const panel = await screen.findByRole("dialog", { name: "Spotify" });
    const drawn = within(panel).getByRole("combobox", { name: "Dras tillsammans med" });
    expect(within(drawn).getAllByRole("option").map((o) => o.textContent)).toEqual(["Egen dragning", "Dras tillsammans med Hyra", "Dras tillsammans med CSN"]);
    expect(within(panel).getByLabelText("Dag")).toBeInTheDocument();
    await userEvent.selectOptions(drawn, "Dras tillsammans med Hyra");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/recurring-expenses/3")).toEqual([["/api/recurring-expenses/3", { partOfId: 1 }]]));
    // Its own day, account and bank text give way to Hyra's.
    await waitFor(() => expect(within(panel).queryByLabelText("Dag")).not.toBeInTheDocument());
    expect(within(panel).getByText(/Ingen egen dragning: följer Hyras dag och konto/)).toBeInTheDocument();
  });

  it("n opens the same panel empty; Skapa creates the expense and keeps it open", async () => {
    renderView();
    await screen.findByText("Hyra");
    await userEvent.keyboard("n");
    const panel = await screen.findByRole("dialog", { name: "Ny fast utgift" });
    expect(within(panel).getByLabelText("Namn")).toHaveFocus();
    await userEvent.click(within(panel).getByRole("button", { name: "Skapa" }));
    expect(within(panel).getByText("Ge utgiften ett namn.")).toBeInTheDocument();

    await userEvent.type(within(panel).getByLabelText("Namn"), "Gym");
    await userEvent.type(within(panel).getByLabelText("Belopp"), "399");
    await userEvent.type(within(panel).getByLabelText("Dag"), "sista");
    await userEvent.click(within(panel).getByRole("radio", { name: "Föregående" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Skapa" }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST", "/recurring-expenses")[0][1]).toMatchObject({
        name: "Gym",
        amount: 39900,
        scheduleType: "last_day",
        bankDayRule: "previous",
        paymentMethod: "autogiro",
      }),
    );
    await waitFor(() => expect(panelTitle()).toBe("Gym"));
  });

  it("v switches to the calendar in the URL; → moves a month", async () => {
    renderView();
    await screen.findByText("Hyra");
    await userEvent.keyboard("v");
    expect(window.location.search).toBe("?vy=kalender");
    expect(await screen.findByRole("grid", { name: /Dragningar i/ })).toBeInTheDocument();
    const chip = await screen.findByRole("button", { name: "Hyra" });
    await userEvent.click(chip);
    await waitFor(() => expect(panelTitle()).toBe("Hyra"));
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{ArrowRight}");
    expect(window.location.search).toMatch(/^\?vy=kalender&manad=\d{4}-\d{2}$/);
    await userEvent.keyboard("t");
    expect(window.location.search).toBe("?vy=kalender");
    await userEvent.keyboard("v");
    expect(window.location.search).toBe("");
  });

  it("the calendar has the work schedule's deadline (Jobb), with 'Mottaget' under the day", async () => {
    window.history.replaceState(null, "", "/?vy=kalender");
    renderView();
    const cell = (await screen.findByRole("grid", { name: /Dragningar i/ })).querySelector(`[data-date="${MONTH}-25"]`) as HTMLElement;
    await waitFor(() => expect(cell.querySelector(`[data-work="${shiftMonth(MONTH, 1)}"]`)).toBeInTheDocument());
    expect(screen.getByRole("list", { name: "Konton" })).toHaveTextContent("jobb");
    await userEvent.click(cell);
    const row = await screen.findByTestId("schedule-deadline");
    expect(row).toHaveTextContent("Schemadeadline: schema för nästa månad ska vara mottaget");
    await userEvent.click(within(row).getByRole("button", { name: "Mottaget" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", `/salary/schedule/${shiftMonth(MONTH, 1)}`)).toEqual([[`/api/salary/schedule/${shiftMonth(MONTH, 1)}`, { received: true }]]));
    window.history.replaceState(null, "", "/");
  });

  it("opening from a transaction's link opens that expense", async () => {
    const onFocused = vi.fn();
    render(
      <TooltipProvider>
        <PageHeader title="Fasta utgifter" />
        <RecurringView focusId={3} onFocused={onFocused} />
      </TooltipProvider>,
    );
    await waitFor(() => expect(panelTitle()).toBe("Spotify"));
    expect(onFocused).toHaveBeenCalled();
  });
});
