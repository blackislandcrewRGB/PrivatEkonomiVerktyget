import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { Toaster } from "../../../components/Toast";
import { clearPersistentState } from "../../../usePersistentState";
import { callsTo, mockApi } from "../../../../test/api";
import { Situation } from "./SituationView";

/**
 * Ekonomisk situation: balansräkningen.
 *
 * What is checked here is what the view must never do — mix the car into the
 * headline figure, print a zero where nothing is known, or show one number
 * where the sheet has two.
 */

const SHEET = {
  on: "2026-09-20",
  liquid: [
    { key: "account:1", name: "Swedbank Privatkonto", amountOre: 842_500, basis: "saldo från 20/9", asOf: "2026-09-20", unknown: false },
    { key: "account:2", name: "Swedbank e-sparkonto", amountOre: 1_237_500, basis: "saldo från 20/9", asOf: "2026-09-20", unknown: false },
    { key: "securities:isk", name: "ISK värdepapper", amountOre: 15_250_000, basis: "kurser från 18/9", asOf: "2026-09-18", unknown: false },
    { key: "cash:isk", name: "ISK likvider", amountOre: 1_375_000, basis: "inlagt 18/9", asOf: "2026-09-18", unknown: false },
    { key: "partner", name: "Mio är skyldig dig", amountOre: 800_000, basis: "Delad ekonomi till och med 2026-09", asOf: null, unknown: false },
  ],
  debts: [
    { key: "card:3", name: "Swedbank Mastercard Guld", amountOre: 150_000, basis: "fakturan 30/9 är betald, 1 500 kr köpt sedan 4/9", asOf: null, unknown: false },
    {
      key: "card:4",
      name: "Bank Norwegian",
      amountOre: 620_000,
      basis: "köpt sedan fakturaperioden som slutade 15/8",
      asOf: null,
      unknown: false,
      payments: [
        { payDate: "2026-09-25", amountOre: 400_000 },
        { payDate: "2026-10-25", amountOre: 220_000 },
      ],
    },
  ],
  csn: { key: "csn", name: "CSN", amountOre: 20_000_000, basis: "200 000 kr den 20/9", asOf: "2026-09-20", unknown: false },
  illiquid: [{ key: "car", name: "Bilen", amountOre: 6_000_000, basis: "60 000 kr den 20/9 · annonser", asOf: "2026-09-20", unknown: false }],
  totals: {
    // Bank, ISK securities and cash: not what Mio owes.
    moneyOre: 18_705_000,
    liquidOre: 19_505_000,
    debtsOre: 770_000,
    csnOre: 20_000_000,
    illiquidOre: 6_000_000,
    netExCsnOre: 18_735_000,
    netIncCsnOre: -1_265_000,
    netExCsnWithIlliquidOre: 24_735_000,
    netIncCsnWithIlliquidOre: 4_735_000,
  },
  notes: [],
  ahead: {
    from: "2026-09-20",
    to: "2026-10-23",
    startOre: 18_705_000,
    items: [
      { date: "2026-09-24", kind: "income", name: "Lön (prognos, 140 tim)", amount: 2_150_000 },
      { date: "2026-09-25", kind: "invoice", name: "Bank Norwegian: faktura", amount: -620_000 },
      { date: "2026-09-25", kind: "fixed", name: "Hyra", amount: -750_000 },
      { date: "2026-09-25", kind: "partner", name: "Från Mio", amount: 800_000, estimate: true },
    ],
    endOre: 20_285_000,
    salaries: ["2026-09-24", "2026-10-24"],
  },
};

const MANUAL = [
  {
    id: 1,
    key: "csn",
    kind: "debt",
    name: "CSN",
    amountOre: 20_000_000,
    valueDate: "2026-09-20",
    liquid: false,
    recurringExpenseId: 13,
    source: null,
    note: null,
    currentOre: 20_000_000,
    paidOre: 0,
    charges: 0,
    lastChargeDate: null,
  },
  {
    id: 2,
    key: "car",
    kind: "asset",
    name: "Bilen",
    amountOre: 6_000_000,
    valueDate: "2026-09-20",
    liquid: false,
    recurringExpenseId: null,
    source: "annonser",
    note: null,
    currentOre: 6_000_000,
    paidOre: 0,
    charges: 0,
    lastChargeDate: null,
  },
];

/** Swedish formatting uses a non-breaking space in a thousand. */
const plain = (text: string) => text.replace(/\s/g, " ");


/**
 * The endurance needs its own mock: the prefix 'GET /networth' would
 * otherwise answer '/networth/endurance' with the balance sheet.
 */
const ENDURANCE = {
  on: "2026-09-20",
  cost: {
    variableOre: 1_320_000,
    fixedOre: 880_000,
    totalOre: 2_200_000,
    from: "2026-06-01",
    to: "2026-08-31",
    months: 3,
    fixedCount: 23,
    fuel: { ore: 120_000, source: "forecast", shifts: 14 },
    groceriesOre: 260_000,
    essentialsOre: 1_140_000,
  },
  capital: { bufferOre: 1_237_500, bufferAccount: { id: 2, name: "Swedbank e-sparkonto" }, cash: [{ account: "isk", name: "ISK", ore: 1_375_000, date: "2026-09-18" }], cashOre: 1_375_000, portfolioOre: 15_250_000 },
  akassa: {
    grossOre: 2_700_000,
    payslips: 8,
    qualifyingOre: 2_700_000,
    cappedByCeiling: false,
    taxRate: 0.19,
    taxFromPayslips: true,
    steps: [
      { days: 100, rate: 0.8, monthlyNetOre: 1_750_000 },
      { days: 100, rate: 0.7, monthlyNetOre: 1_530_000 },
      { days: 100, rate: 0.65, monthlyNetOre: 1_420_000 },
    ],
    totalDays: 300,
    months: 300 / 22,
  },
  current: {
    monthlyOre: 2_200_000,
    buffer: { months: 0.56, missing: null, formula: "Swedbank e-sparkonto 12 375 kr ÷ 22 000 kr/mån = 0,6 månader" },
    withSavings: { months: 8.12, missing: null, formula: "(12 375 kr + 166 250 kr) ÷ 22 000 kr/mån = 8,1 månader" },
    withAkassa: { months: 17.06, missing: null, formula: "27 000 kr/mån i snitt, 80 % i 100 dagar — 178 625 kr räcker tills det tar slut = 17,1 månader", akassaMonths: 13.64 },
  },
  essential: {
    monthlyOre: 1_140_000,
    buffer: { months: 1.09, missing: null, formula: "Swedbank e-sparkonto 12 375 kr ÷ 11 400 kr/mån = 1,1 månader" },
    withSavings: { months: 15.67, missing: null, formula: "(12 375 kr + 166 250 kr) ÷ 11 400 kr/mån = 15,7 månader" },
    withAkassa: { months: 35.0, missing: null, formula: "27 000 kr/mån i snitt — 178 625 kr räcker tills det tar slut = 35,0 månader", akassaMonths: 13.64 },
  },
};


/** Likewise: 'GET /networth' would otherwise answer '/networth/flow'. */
const FLOW = {
  from: "2026-06-01",
  to: "2026-08-31",
  months: 3,
  perMonth: { incomeOre: 2_650_000, fixedOre: 900_000, variableOre: 1_050_000, leftOre: 700_000 },
  refundsOre: 360_000,
  fixedShareOfIncome: 0.34,
  savingsRate: 0.249,
  destinations: {
    portfolioOre: 660_000,
    bufferOre: 90_000,
    bufferAccount: { id: 2, name: "Swedbank e-sparkonto" },
    unexplainedOre: -50_000,
  },
  monthly: [
    { month: "2026-06", incomeOre: 2_500_000, fixedOre: 950_000, variableOre: 800_000, leftOre: 750_000, fixedShareOfIncome: 0.38 },
    { month: "2026-07", incomeOre: 2_700_000, fixedOre: 880_000, variableOre: 1_100_000, leftOre: 720_000, fixedShareOfIncome: 0.326 },
    { month: "2026-08", incomeOre: 2_750_000, fixedOre: 870_000, variableOre: 1_250_000, leftOre: 630_000, fixedShareOfIncome: 0.316 },
  ],
  csn: {
    anchorOre: 20_000_000,
    anchorDate: "2026-09-20",
    remainingOre: 20_000_000,
    paidSinceAnchorOre: 0,
    paidThisYearOre: 1_440_000,
    chargesThisYear: 8,
    rateOre: 180_000,
    monthsLeft: 112,
    payoffMonth: "2036-01",
  },
};


/** And again for the pension: 'GET /networth' would answer that path too. */


/** The history, mocked like the rest: 'GET /networth' would answer it too. */
const HISTORY = {
  months: [
    {
      month: "2026-07",
      date: "2026-07-31",
      accountsOre: 500_000,
      securitiesOre: 19_000_000,
      cashOre: 0,
      partnerOre: 400_000,
      cardsOre: 300_000,
      otherDebtOre: 0,
      csnOre: 39_400_000,
      illiquidOre: 6_000_000,
      netExCsnOre: 19_600_000,
      netIncCsnOre: -19_800_000,
      estimated: true,
      note: "Framräknad i efterhand.",
    },
    {
      month: "2026-08",
      date: "2026-08-31",
      accountsOre: 600_000,
      securitiesOre: 20_000_000,
      cashOre: 0,
      partnerOre: 500_000,
      cardsOre: 400_000,
      otherDebtOre: 0,
      csnOre: 39_200_000,
      illiquidOre: 6_000_000,
      netExCsnOre: 20_700_000,
      netIncCsnOre: -18_500_000,
      estimated: false,
      note: null,
    },
  ],
  today: { month: "2026-09", date: "2026-09-20", netExCsnOre: 18_735_000, netIncCsnOre: -1_265_000, illiquidOre: 6_000_000 },
  earliest: "2026-07",
  missing: "Längre bak går inte att räkna: inget värde för sparandet finns före 2026-06-30.",
};

let fetchMock: ReturnType<typeof mockApi>;

const routes = (sheet: unknown = SHEET, endurance: unknown = ENDURANCE, flow: unknown = FLOW, hist: unknown = HISTORY) => ({
  "GET /networth/manual": MANUAL,
  "GET /networth/endurance": endurance,
  "GET /networth/flow": flow,
  "GET /networth/history": hist,
  "GET /networth": sheet,
  "PUT /networth/manual": (_u: string, i: { json?: unknown }) => ({ ...MANUAL[1], ...(i.json as object) }),
});

const renderSituation = (sheet: unknown = SHEET, endurance: unknown = ENDURANCE, flow: unknown = FLOW, hist: unknown = HISTORY) => {
  fetchMock = mockApi(routes(sheet, endurance, flow, hist));
  return render(
    <TooltipProvider>
      <Situation onNavigate={() => {}} />
      <Toaster />
    </TooltipProvider>,
  );
};

beforeEach(() => clearPersistentState());
afterEach(() => clearPersistentState());

describe("Ekonomisk situation", () => {
  it("the big figure is the money in total; both nets under it", async () => {
    renderSituation();
    const card = (await screen.findByRole("heading", { name: "Pengar totalt" })).closest("section")!;
    // Bank, ISK securities and cash.
    expect(plain(card.textContent ?? "")).toContain("187 050 kr");
    // Both nets are always there: they answer different questions.
    expect(plain(screen.getByTestId("networth-line").textContent ?? "")).toBe("Nettoförmögenhet exkl. CSN 187 350 kr med CSN −12 650 kr");
  });

  it("splits the figure in a bar, one part per account and the ISK; Mio and the car are not in it", async () => {
    const user = userEvent.setup();
    renderSituation();
    const bar = await screen.findByTestId("networth-bar");
    const parts = () => [...bar.querySelectorAll("[data-part]")].map((e) => e.getAttribute("data-part"));
    // What Mio owes is not in Pengar totalt, so not in its bar.
    expect(parts()).toEqual(["account:1", "account:2", "securities:isk", "cash:isk"]);
    expect(plain(bar.getAttribute("aria-label") ?? "")).toBe("Pengar totalt fördelat: Privatkonto 8 425 kr, e-sparkonto 12 375 kr, ISK värdepapper 152 500 kr, ISK likvider 13 750 kr.");
    // The bar's parts add up to the figure: 187 050 kr.
    expect(SHEET.liquid.filter((r) => r.key !== "partner").reduce((s, r) => s + r.amountOre, 0)).toBe(SHEET.totals.moneyOre);
    await user.click(screen.getByRole("switch", { name: /Visa illikvida/ }));
    expect(parts()).toEqual(["account:1", "account:2", "securities:isk", "cash:isk", "car"]);
  });

  it("Framåt: an equation to what is left after the salary and the bills, the key days, and every day folded away", async () => {
    const user = userEvent.setup();
    renderSituation();
    const ahead = await screen.findByTestId("networth-ahead");
    expect(plain(ahead.textContent ?? "")).toContain("Framåt till 23/10 · lönen efter kommer 24/10");
    // Today + what comes in − what goes out = what is left; summed from the list's items.
    const terms = [...within(ahead).getByTestId("ahead-equation").querySelectorAll("[data-term]")].map((t) => plain(t.textContent ?? ""));
    expect(terms).toEqual([
      "I dag187 050 kr",
      "+Lön 24/9 + från Mio+29 500 kr",
      "−Hyra, fakturor−13 700 kr",
      "=Efter lön och räkningar202 850 kr",
    ]);
    expect(187_050 + 29_500 - 13_700).toBe(202_850);
    expect(plain(screen.getByTestId("ahead-end").textContent ?? "")).toBe("202 850 kr");
    // The days worth seeing: the one most goes out, and the salary.
    const key = [...within(ahead).getByTestId("ahead-key-days").querySelectorAll("[data-key-day]")].map((d) => plain(d.textContent ?? ""));
    expect(key).toEqual(["24/9208 550 krLön (prognos, 140 tim) +21 500", "25/9202 850 krFrån Mio +8 000 · Hyra −7 500 · Norwegian −6 200"]);
    // The list is folded until asked for, and then the same as before.
    expect(ahead.querySelector("[data-day]")).toBeNull();
    await user.click(within(ahead).getByRole("button", { name: "Visa alla 2 dagar med händelser ›" }));
    const salary = ahead.querySelector('[data-day="2026-09-24"]') as HTMLElement;
    expect(plain(salary.textContent ?? "")).toBe("24/9Lön (prognos, 140 tim)+21 500 kr208 550 kr");
    const bills = ahead.querySelector('[data-day="2026-09-25"]') as HTMLElement;
    expect(plain(bills.textContent ?? "")).toContain("Bank Norwegian: faktura−6 200 kr");
    expect(plain(bills.textContent ?? "")).toContain("Från Miouppskattad+8 000 kr");
    expect(plain(bills.textContent ?? "")).toContain("202 850 kr");
    expect(ahead).toHaveTextContent("Kortfakturorna räknar med det du troligen handlar på korten resten av perioden");
  });

  it("keeps the car out until it is asked for, and then on its own line", async () => {
    const user = userEvent.setup();
    renderSituation();
    const sheet = await screen.findByLabelText("Balansräkning");
    // It is still in 'Hålls för hand' below, which is where it is edited —
    // but not on the sheet, and not in the total.
    expect(within(sheet).queryByText("Bilen")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Visa illikvida (bilen)" }));
    expect(await screen.findByText("Illikvida tillgångar")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Pengar totalt" }).closest("section")!;
    // 187 050 + 60 000 and 187 350 + 60 000, and the car still on a line of its own below.
    expect(plain(card.textContent ?? "")).toContain("247 050 kr");
    expect(plain(screen.getByTestId("networth-line").textContent ?? "")).toBe("Nettoförmögenhet exkl. CSN 247 350 kr med CSN 47 350 kr");
  });

  it("puts the loan apart from the other debts, in a box of its own", async () => {
    renderSituation();
    const loan = await screen.findByTestId("csn-loan");
    expect(within(loan).getByRole("heading", { name: "Studielån · CSN" })).toBeInTheDocument();
    expect(plain(loan.textContent ?? "")).toContain("−200 000 kr");
    expect(loan.textContent).toContain("inte mot årets pengar");
    // It is not also counted among the ordinary debts, or in their sum.
    const debts = screen.getByRole("region", { name: "Skulder" });
    expect(debts.querySelector('[data-row="csn"]')).toBeNull();
    expect(plain(within(debts).getByRole("heading", { name: "Skulder" }).parentElement!.textContent ?? "")).toBe("Skulder−7 700 kr");
  });

  it("says 'okänd' where nothing is known, instead of a zero", async () => {
    renderSituation({
      ...SHEET,
      debts: [{ key: "card:4", name: "Bank Norwegian", amountOre: 0, basis: "ingen faktura registrerad", asOf: null, unknown: true }],
      notes: ["Bank Norwegian: ingen faktura registrerad och ingen betalning att räkna från — skulden är okänd."],
    });
    const row = (await screen.findByText("Bank Norwegian")).closest("li")!;
    expect(within(row).getByText("okänd")).toBeInTheDocument();
    expect(within(row).queryByText(/0 kr/)).not.toBeInTheDocument();
    expect(screen.getByText(/skulden är okänd/)).toBeInTheDocument();
  });

  it("changes a figure with the day it was true", async () => {
    const user = userEvent.setup();
    renderSituation();
    await user.click(await screen.findByRole("button", { name: "Ändra Bilen" }));

    const amount = await screen.findByLabelText("Belopp");
    expect(amount).toHaveValue("60000");
    await user.clear(amount);
    await user.type(amount, "55000");
    await user.clear(screen.getByLabelText("Värdedatum"));
    await user.type(screen.getByLabelText("Värdedatum"), "2026-10-01");
    await user.click(screen.getByRole("button", { name: "Spara" }));

    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/networth/manual/2")).toHaveLength(1));
    // The day goes with the amount: without it the charges since would be
    // subtracted from the new figure as well.
    expect(callsTo(fetchMock, "PUT", "/networth/manual/2")[0][1]).toMatchObject({ amountOre: 5_500_000, valueDate: "2026-10-01" });
  });

  it("splits a card's debt by the month it is paid, with a bar in two parts", async () => {
    renderSituation();
    const card = (await screen.findByText("Bank Norwegian")).closest("li")!;
    expect(plain(within(card).getByTestId("debt-payments").textContent ?? "")).toBe("betalas i september 4 000 kr (25/9) · i oktober 2 200 kr (25/10)");
  });

  it("writes out what each figure rests on", async () => {
    renderSituation();
    const card = (await screen.findByText("Swedbank Mastercard Guld")).closest("li")!;
    expect(plain(card.textContent ?? "")).toContain("fakturan 30/9 är betald, 1 500 kr köpt sedan 4/9");
    const sheet = screen.getByLabelText("Balansräkning");
    const partner = within(sheet).getByText("Mio är skyldig dig").closest("li")!;
    expect(partner.textContent).toContain("Delad ekonomi till och med 2026-09");
    // The assets with their sum.
    expect(plain(within(sheet).getByRole("heading", { name: "Tillgångar" }).parentElement!.textContent ?? "")).toBe("Tillgångar195 050 kr");
  });
});

describe("Uthållighet", () => {
  const level = (section: HTMLElement, name: string) => within(section).getByRole("heading", { name }).parentElement!;
  const value = (el: HTMLElement) => within(el).getByTestId("level-value");

  it("shows the three levels, and only colours the buffer (under 3 months red, under 6 orange)", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Uthållighet");
    // Under three months of expenses put aside is the one thing here worth a
    // colour; how long the whole portfolio lasts is a fact, not a grade.
    expect(plain(value(level(section, "Buffert")).textContent ?? "")).toBe("1,1 månader");
    expect(value(level(section, "Buffert"))).toHaveClass("text-alarm");
    expect(plain(value(level(section, "Med sparandet")).textContent ?? "")).toBe("15,7 månader");
    expect(value(level(section, "Med sparandet"))).not.toHaveClass("text-alarm");
  });

  it("draws the levels on one scale, 36 months a full bar, never past it", async () => {
    renderSituation(SHEET, { ...ENDURANCE, essential: { ...ENDURANCE.essential, withAkassa: { ...ENDURANCE.essential.withAkassa, months: 43.3 } } });
    const section = await screen.findByLabelText("Uthållighet");
    const width = (name: string) => (level(section, name).querySelector("[data-bar]") as HTMLElement).style.width;
    // 1,1 of 36, 15,7 of 36, and 43,3 months with the a-kassa past the scale: full.
    expect(parseFloat(width("Buffert"))).toBeCloseTo((ENDURANCE.essential.buffer.months! / 36) * 100, 5);
    expect(parseFloat(width("Med sparandet"))).toBeCloseTo((ENDURANCE.essential.withSavings.months! / 36) * 100, 5);
    expect(width("Med a-kassa")).toBe("100%");
    expect(section).toHaveTextContent("Skalan i staplarna är 36 månader.");
  });

  it("counts only what would still have to be paid, and says what that is", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Uthållighet");
    const text = plain(section.textContent ?? "");
    // No choice of rate: the rate spent now is not what a month without income costs.
    expect(within(section).queryByRole("radio")).toBeNull();
    expect(text).not.toContain("Snittutgift");
    // Fixed expenses and the food shop, and the reason there is no fuel.
    expect(text).toContain("Nödvändigt per månad 11 400 kr · fasta 8 800 kr + dagligvaror 2 600 kr");
    expect(text).toContain("Fasta 8 800 kr är 23 utgifter, delade till hälften");
    expect(text).toContain("inget bränsle — pendlingen slutar med jobbet");
    expect(text).toContain("2,9 år");
  });

  it("says how much of the a-kassa level the insurance pays for", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Uthållighet");
    const akassa = level(section, "Med a-kassa");
    expect(plain(akassa.textContent ?? "")).toContain("2,9 år");
    expect(plain(akassa.textContent ?? "")).toContain("varav 13,6 månader med a-kassa");
    // The arithmetic is under the number, not hidden behind a tooltip.
    expect(plain(akassa.textContent ?? "")).toContain("178 625 kr räcker tills det tar slut");
  });

  it("counts in years once the months stop meaning anything", async () => {
    renderSituation(SHEET, { ...ENDURANCE, essential: { ...ENDURANCE.essential, withSavings: { months: 30, missing: null, formula: "" } } });
    const section = await screen.findByLabelText("Uthållighet");
    expect(plain(value(level(section, "Med sparandet")).textContent ?? "")).toBe("2,5 år");
  });

  it("says why there is no number instead of showing a zero", async () => {
    renderSituation(SHEET, { ...ENDURANCE, akassa: null, essential: { ...ENDURANCE.essential, withAkassa: { months: null, missing: "Ingen lönespec att räkna ersättningsgrundande inkomst från.", formula: "" } } });
    const section = await screen.findByLabelText("Uthållighet");
    expect(within(section).getByText("Ingen lönespec att räkna ersättningsgrundande inkomst från.")).toBeInTheDocument();
  });
});

describe("Flöde per månad", () => {
  it("shows the arithmetic from income down to what was left", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Flöde per månad");
    const text = plain(section.textContent ?? "");
    expect(text).toContain("Nettoinkomst");
    expect(text).toContain("26 500 kr");
    expect(text).toContain("34 % av nettoinkomsten");
    expect(text).toContain("Kvar efter allt");
    expect(text).toContain("7 000 kr");
  });

  it("says how much came back, so the two views can be told apart", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Flöde per månad");
    // Uthållighet counts 14 100 kr and this counts 10 500 kr. The difference
    // is written out rather than left as two figures that disagree.
    expect(plain(section.textContent ?? "")).toContain("netto — 3 600 kr/mån kom tillbaka och är avräknat");
  });

  it("traces where the surplus went, negative included", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Flöde per månad");
    const text = plain(section.textContent ?? "");
    expect(text).toContain("Till portföljen");
    expect(text).toContain("sparkvot 24,9 %");
    expect(text).toContain("Till Swedbank e-sparkonto");
    expect(text).toContain("kontots nettoförändring");
    expect(text).toContain("−500 kr");
    expect(text).toContain("mer sattes undan än vad som blev över");
  });

  it("shows the loan with its rate and its end, and a bar that starts empty", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Flöde per månad");
    const text = plain(section.textContent ?? "");
    expect(text).toContain("Återstår 200 000 kr");
    expect(text).toContain("betalt i år 14 400 kr");
    expect(text).toContain("slutbetalt januari 2036");
    expect(text).toContain("takten i år är 1 800 kr/mån på 8 dragningar");
    // Nothing paid since the anchor yet, so the bar is empty — and it says
    // what it is measuring rather than implying the loan is untouched.
    expect(text).toContain("0 kr av 200 000 kr betalt sedan 20/9");
    expect(within(section).getByRole("img", { name: /0 % av lånet betalt sedan 20\/9/ })).toBeInTheDocument();
  });

  it("leaves the end date out when nothing has been drawn", async () => {
    renderSituation(SHEET, ENDURANCE, { ...FLOW, csn: { ...FLOW.csn, paidThisYearOre: 0, chargesThisYear: 0, rateOre: null, monthsLeft: null, payoffMonth: null } });
    const section = await screen.findByLabelText("Flöde per månad");
    expect(plain(section.textContent ?? "")).not.toContain("slutbetalt");
  });
});

describe("Pension", () => {
  it("has a tab of its own: Ekonomisk situation no longer shows it", async () => {
    renderSituation();
    await screen.findByRole("heading", { name: "Pengar totalt" });
    expect(screen.queryByLabelText("Låst till 65+")).toBeNull();
    // 420 000 kr of pension, and the headline is still what the sheet says.
    const card = screen.getByRole("heading", { name: "Pengar totalt" }).closest("section")!;
    expect(plain(card.textContent ?? "")).toContain("187 050 kr");
  });
});

describe("Historik", () => {
  it("lists the months, newest first, and marks the estimated ones", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Historik");
    const rows = within(section).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent?.slice(0, 8))).toEqual(["aug 2026", "juli 202"]);
    // A month worked out backwards is not the same kind of thing as one that
    // was recorded, and the table says which is which.
    expect(within(rows[1]).getByText("uppskattad")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("uppskattad")).not.toBeInTheDocument();
  });

  it("shows both nets and the illiquid column", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Historik");
    const august = within(section).getAllByRole("row")[1];
    const text = plain(august.textContent ?? "");
    expect(text).toContain("207 000 kr");
    expect(text).toContain("−185 000 kr");
    expect(text).toContain("60 000 kr");
  });

  it("says why the line doesn't start earlier", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Historik");
    expect(plain(section.textContent ?? "")).toContain("inget värde för sparandet finns före 2026-06-30");
    // With the way to put the savings' values in: the Att fylla i tab.
    expect(within(section).getByRole("button", { name: "Lägg in månadsvärden" })).toBeInTheDocument();
  });

  it("draws twelve bars ending on today: saved ones blue, worked out ones lighter, the rest placeholders", async () => {
    renderSituation();
    const section = await screen.findByLabelText("Historik");
    const bars = [...within(section).getByTestId("history-bars").querySelectorAll("[data-month]")].map((b) => [b.getAttribute("data-month"), b.getAttribute("data-state")]);
    expect(bars).toHaveLength(12);
    expect(bars.slice(-3)).toEqual([
      ["2026-07", "estimated"],
      ["2026-08", "saved"],
      ["2026-09", "saved"],
    ]);
    expect(bars.slice(0, 9).every(([, state]) => state === "missing")).toBe(true);
  });

  it("has nothing to draw before the first month is saved", async () => {
    renderSituation(SHEET, ENDURANCE, FLOW, { ...HISTORY, months: [], earliest: null });
    const section = await screen.findByLabelText("Historik");
    expect(within(section).getByText(/Ingen månad är sparad än/)).toBeInTheDocument();
    expect(within(section).queryByRole("table")).not.toBeInTheDocument();
  });
});
