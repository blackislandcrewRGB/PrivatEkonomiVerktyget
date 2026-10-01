import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Cashflow as Data } from "../../../api";
import { Toaster } from "../../../components/Toast";
import { callsTo, mockApi } from "../../../../test/api";
import { Cashflow } from "./CashflowView";

const days = Array.from({ length: 91 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 8, 19 + i)).toISOString().slice(0, 10);
  return {
    date,
    balance: 1000000 - i * 10000 + (date >= "2026-09-24" ? 2500000 : 0),
    variable: i ? 10000 : 0,
    events: [] as Data["events"],
  };
});
days[5].events = [{ date: days[5].date, kind: "income", name: "Lön", amount: 2500000 }];
days[6].events = [
  {
    date: days[6].date,
    kind: "invoice",
    name: "Bank Norwegian: faktura",
    amount: -350000,
    estimate: true,
    paced: 180000,
  },
];
days[52].events = [{ date: days[52].date, kind: "fixed", name: "Försäkring", amount: -50000 }];
const DATA: Data = {
  today: "2026-09-19",
  horizon: "2026-12-18",
  partner: true,
  partnerName: "Mio",
  start: 1000000,
  accounts: [],
  liquid: {
    accounts: [{ account: "isk", name: "ISK", ore: 150000, date: "2026-09-18" }],
    depositedOre: 50000,
    since: "2026-09-18",
    totalOre: 200000,
  },
  buffer: 200000,
  days,
  events: days.flatMap((d) => d.events),
  lowest: { date: "2026-09-23", balance: 960000 },
  safeToSpend: 760000,
  variable: {
    perDay: 10000,
    total: 900000,
    fuel: null,
    fullPerDay: 10000,
    bankPerDay: 4000,
    cards: [{ accountId: 4, name: "Bank Norwegian", perDay: 6000 }],
  },
  foodOnly: false,
  planned: [
    {
      id: 3,
      date: "2026-11-10",
      amount: -1500000,
      description: "Resa i november",
      accountId: null,
      shared: false,
      payDate: "2026-11-10",
      card: null,
      partnerHalf: 0,
      partnerDate: null,
    },
    {
      id: 5,
      date: "2026-09-24",
      amount: -800000,
      description: "Telefon",
      accountId: 4,
      shared: true,
      payDate: "2026-10-25",
      card: "Bank Norwegian",
      partnerHalf: 400000,
      partnerDate: "2026-10-25",
    },
  ],
};

/**
 * Har jag råd?: 3 000 kr is green, 6 000 kr yellow (under the buffer), 8 000 kr red
 * from the cash flow and yellow from ISK; a card and shared as asked.
 */
const AFFORD = (url: string) => {
  const q = new URLSearchParams(url.split("?")[1]);
  const amount = Number(q.get("amount"));
  const card = q.get("accountId") === "4";
  const shared = q.get("shared") === "1";
  const savings = q.get("funding") === "savings";
  const end = { date: "2026-12-18", balance: 2600000 - (savings ? 0 : amount) };
  const before = {
    lowest: { date: "2026-11-23", balance: 114616 },
    end: { date: "2026-12-18", balance: 2600000 },
    safeToSpend: -85384,
    bufferMonths: 0.17,
    withSavingsMonths: 8.3,
  };
  const common = {
    input: {
      amount,
      date: q.get("date"),
      accountId: card ? 4 : null,
      shared,
      funding: savings ? "savings" : "cash",
      partner: true,
    },
    payment: card
      ? {
          payDate: "2026-10-25",
          card: "Bank Norwegian",
          partnerHalf: shared ? 400000 : 0,
          partnerDate: shared ? "2026-10-25" : null,
        }
      : {
          payDate: q.get("date"),
          card: null,
          partnerHalf: 0,
          partnerDate: null,
        },
    netCost: amount,
    before,
    waitUntil: null,
    salary: {
      date: "2026-09-25",
      amount: 2450000,
      name: "Lön (prognos, 140 tim)",
      forecast: true,
    },
    limits: { buffer: 200000, redBelowMonths: 3 },
    horizon: "2026-12-18",
  };
  if (amount <= 300000) {
    return {
      ...common,
      before: {
        ...before,
        lowest: { date: "2026-09-23", balance: 960000 },
        safeToSpend: 760000,
      },
      after: {
        lowest: { date: "2026-09-23", balance: 660000 },
        end,
        safeToSpend: 460000,
        bufferMonths: 0.1,
        withSavingsMonths: 8.1,
      },
      verdict: "green",
      headline: "Ja, det ryms",
      reasons: ["Kassaflödet håller sig över bufferten: lägst 6 600 kr den 23/9, safe to spend 4 600 kr efter köpet."],
      alternative: null,
      monthStarts: [],
    };
  }
  if (amount <= 600000) {
    return {
      ...common,
      after: {
        lowest: { date: "2026-11-23", balance: 114616 - 500000 + 400000 },
        end,
        safeToSpend: -185384,
        bufferMonths: 0,
        withSavingsMonths: 8.0,
      },
      verdict: "yellow",
      headline: "Ja, men det går under bufferten",
      reasons: ["Kassaflödet går under bufferten 2 000 kr: lägst 146 kr den 23/11."],
      alternative: null,
      monthStarts: [],
    };
  }
  return {
    ...common,
    after: savings
      ? {
          lowest: { date: "2026-11-23", balance: 114616 },
          end,
          safeToSpend: -85384,
          bufferMonths: 0.17,
          withSavingsMonths: 8.0,
        }
      : {
          lowest: { date: "2026-11-23", balance: -685384 },
          end,
          safeToSpend: -885384,
          bufferMonths: 0,
          withSavingsMonths: 8.0,
        },
    verdict: savings ? "yellow" : "red",
    headline: savings ? "Ja, med pengar från sparandet" : "Nej, inte från kassaflödet",
    reasons: savings
      ? ["Tas 8 000 kr från sparandet på ISK räcker pengarna 8 månader med sparandet (i dag 8,3)."]
      : ["Kassaflödet går under noll: lägst −6 854 kr den 23/11 (utan köpet 1 146 kr)."],
    alternative: savings ? null : { funding: "savings", verdict: "yellow", withSavingsMonths: 8.0 },
    monthStarts: [
      {
        date: "2026-10-01",
        month: "2026-09",
        before: 1912286,
        after: savings ? 1912286 : 1112286,
      },
      {
        date: "2026-11-01",
        month: "2026-10",
        before: 1500000,
        after: savings ? 1500000 : 700000,
      },
      {
        date: "2026-12-01",
        month: "2026-11",
        before: 900000,
        after: savings ? 900000 : 100000,
      },
    ],
  };
};

let fetchMock: ReturnType<typeof mockApi>;
beforeEach(() => {
  sessionStorage.clear();
  fetchMock = mockApi({
    "GET /cashflow": DATA,
    "GET /afford/snapshot": (url: string) => ({
      markdown: `# Ekonomiskt läge\n${url.includes("amount=") ? "## Köpet jag funderar på" : ""}`,
    }),
    "GET /afford": (url: string) => AFFORD(url),
    "GET /accounts": [
      { id: 2, name: "Swedbank e-sparkonto", kind: "bank" },
      { id: 4, name: "Bank Norwegian", kind: "credit_card" },
    ],
    "POST /cashflow/planned": { id: 4 },
    "PUT /cashflow/settings": { buffer: 200000, foodOnly: true },
    "DELETE /cashflow/planned": {},
  });
});

const renderTab = () =>
  render(
    <>
      <Cashflow onNavigate={vi.fn()} />
      <Toaster />
    </>,
  );

describe("Översikt › Kassaflöde", () => {
  it("safe to spend from the lowest point and the buffer; the days with events and the balance after them", async () => {
    renderTab();
    expect(await screen.findByText("7 600 kr")).toBeInTheDocument();
    expect(screen.getByTestId("safe-to-spend")).toHaveTextContent("7 600 kr");
    expect(screen.getByText("lägsta punkten minus bufferten").parentElement).toHaveTextContent(/lägsta punkten minus bufferten\s*2 000 kr\s*ändra/);
    // Today, the lowest point (the day before the salary) and the 90th day, as three boxes.
    const figures = screen.getByTestId("cashflow-figures");
    expect(figures).toHaveTextContent(/I dag 19\/9\s*10 000 kr/);
    expect(figures).toHaveTextContent(/Lägsta punkt · 23\/9\s*9 600 kr\s*dagen före lönen/);
    expect(figures).toHaveTextContent(/Om 90 dagar · 18\/12\s*26 000 kr\s*\+16 000 kr från i dag/);
    expect(screen.getByText(/^Rörliga utgifter/)).toHaveTextContent("Rörliga utgifter 100 kr/dag dras varje dag");
    const salary = document.querySelector('[data-day="2026-09-24"]') as HTMLElement;
    expect(within(salary).getByText("Lön")).toBeInTheDocument();
    expect(within(salary).getByText("34 500 kr")).toBeInTheDocument();
    // Today's figure includes the cash on Avanza, with where it comes from.
    const split = screen.getByText("bank 8 000 kr · Avanza 2 000 kr");
    expect(split.getAttribute("title")?.replace(/\s/g, " ")).toContain("likvida på ISK 1 500 kr (inlagt 18/9), insatt sedan 18/9 500 kr");
    expect(screen.getByText("Bankkontona + likvider på Avanza")).toBeInTheDocument();
    // The pace isn't a figure of its own any more.
    expect(screen.queryByText(/^Rörligt/)).toBeNull();
  });

  it("a scenario is saved as a planned expense; planned items can be removed; Mio's payments can be left out", async () => {
    renderTab();
    await userEvent.type(await screen.findByLabelText("Belopp"), "15000");
    const save = screen.getByRole("button", { name: /Spara som planerad/ });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Datum"), "2026-11-10");
    await userEvent.type(screen.getByLabelText("Beskrivning"), "Resa");
    // Drawn on the curve, and said in its label.
    await waitFor(() => expect(screen.getByRole("figure").getAttribute("aria-label")).toMatch(/Med tänk om-köpet Resa: lägst/));
    await userEvent.click(save);
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST", "/cashflow/planned")).toEqual([
        [
          "/api/cashflow/planned",
          {
            date: "2026-11-10",
            amount: -1500000,
            description: "Resa",
            accountId: null,
            shared: false,
          },
        ],
      ]),
    );

    await userEvent.click(screen.getByRole("button", { name: "Ta bort Resa i november" }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/cashflow/planned/3")).toHaveLength(1));

    await userEvent.click(screen.getByRole("switch", { name: /Räkna med betalningar från Mio/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/api/cashflow?partner=0"))).toBe(true));
  });

  it("a purchase on a card is drawn on the invoice's pay day, and a shared one's half comes back", async () => {
    renderTab();
    // A saved one says when it leaves the bank.
    expect(await screen.findByText("köpt 24/9 på Bank Norwegian, dras 25/10 · delat, Mios halva 4 000 kr tillbaka 25/10")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Belopp"), "8000");
    await userEvent.type(screen.getByLabelText("Datum"), "2026-09-24");
    await userEvent.type(screen.getByLabelText("Beskrivning"), "Telefon");
    await userEvent.selectOptions(screen.getByLabelText("Betalas med"), "Bank Norwegian");
    await userEvent.click(screen.getByRole("switch", { name: "Delat med Mio" }));
    // (Mio's payments may be left out by the test before: the view remembers it.)
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/afford").at(-1)?.[0]).toMatch(/^\/api\/afford\?amount=800000&date=2026-09-24&accountId=4&shared=1(&partner=0)?$/));
    expect(await screen.findByTestId("scenario-payment")).toHaveTextContent("köpt 24/9 på Bank Norwegian, dras 25/10 · delat, Mios halva 4 000 kr tillbaka 25/10");
    await userEvent.click(screen.getByRole("button", { name: /Spara som planerad/ }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST", "/cashflow/planned").at(-1)?.[1]).toEqual({
        date: "2026-09-24",
        amount: -800000,
        description: "Telefon",
        accountId: 4,
        shared: true,
      }),
    );
  });

  it("Har jag råd?: the answer shows before saving — Ja, Knappt or Nej from the server's verdict", async () => {
    renderTab();
    await screen.findByLabelText("Belopp");
    const typeIn = async (amount: string) => {
      await userEvent.clear(screen.getByLabelText("Belopp"));
      await userEvent.type(screen.getByLabelText("Belopp"), amount);
    };
    await typeIn("3000");
    expect(screen.queryByTestId("afford-verdict")).toBeNull();
    await userEvent.type(screen.getByLabelText("Datum"), "2026-09-24");
    const ja = await screen.findByTestId("afford-verdict");
    expect(ja).toHaveAttribute("data-verdict", "green");
    expect(within(ja).getByTestId("afford-answer").textContent?.replace(/\s/g, " ")).toBe(
      "Ja: Ja. Lägsta punkten blir 6 600 kr den 23/9 i stället för 9 600 kr, och du landar på 23 000 kr den 18/12.",
    );
    // Spara som planerad and where the money comes from are in the answer.
    expect(within(ja).getByRole("button", { name: "Spara som planerad" })).toBeEnabled();
    expect(within(ja).getByLabelText("Pengarna tas från")).toHaveValue("cash");

    await typeIn("6000");
    await waitFor(() => expect(screen.getByTestId("afford-verdict")).toHaveAttribute("data-verdict", "yellow"));
    expect(screen.getByTestId("afford-answer").textContent?.replace(/\s/g, " ")).toBe("Knappt: Knappt – lägsta punkten blir 146 kr den 23/11, under bufferten på 2 000 kr.");

    await typeIn("8000");
    await waitFor(() => expect(screen.getByTestId("afford-verdict")).toHaveAttribute("data-verdict", "red"));
    expect(screen.getByTestId("afford-answer").textContent?.replace(/\s/g, " ")).toBe("Nej: Nej – kassan går under noll den 23/11 (−6 854 kr).");
  });

  it("asks the server once the typing has paused, not per keystroke", async () => {
    renderTab();
    await userEvent.type(await screen.findByLabelText("Datum"), "2026-09-24");
    await userEvent.type(screen.getByLabelText("Belopp"), "123456");
    await screen.findByTestId("afford-verdict");
    const calls = callsTo(fetchMock, "GET", "/afford");
    expect(calls).toHaveLength(1);
    // (Mio's payments may be left out by a test before: the view remembers it.)
    expect(calls[0][0]).toMatch(/^\/api\/afford\?amount=12345600&date=2026-09-24(&partner=0)?$/);
  });

  it("Visa uträkningen: why, before and after; red from the cash flow, yellow with the money from ISK", async () => {
    renderTab();
    await userEvent.type(await screen.findByLabelText("Belopp"), "8000");
    await userEvent.type(screen.getByLabelText("Datum"), "2026-09-24");
    await userEvent.type(screen.getByLabelText("Beskrivning"), "iPhone");
    await screen.findByTestId("afford-verdict");
    expect(screen.queryByTestId("afford-details")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Visa uträkningen" }));
    const card = screen.getByTestId("afford-details");
    expect(card).toHaveTextContent("Nej, inte från kassaflödet");
    expect(card).toHaveTextContent("Kassaflödet går under noll: lägst −6 854 kr den 23/11");
    const row = within(card).getByText("Lägsta punkt").closest("tr")!;
    expect(row).toHaveTextContent(/1\s146 kr \(23\/11\).*−6\s854 kr \(23\/11\)/);
    expect(within(card).getByText("Uthållighet med sparandet").closest("tr")).toHaveTextContent("8,3 mån8 mån");
    // What is over on the 1st, the way the month is counted: the first two 1sts the purchase touches.
    expect(within(card).getByText("Kvar vid månadsskiftet 1/10").closest("tr")).toHaveTextContent(/19\s123 kr11\s123 kr/);
    expect(within(card).getByText("Kvar vid månadsskiftet 1/11")).toBeInTheDocument();
    expect(within(card).queryByText("Kvar vid månadsskiftet 1/12")).toBeNull();

    await userEvent.click(within(card).getByRole("button", { name: "Räkna med pengar från ISK" }));
    expect(screen.getByLabelText("Pengarna tas från")).toHaveValue("savings");
    await waitFor(() => expect(screen.getByTestId("afford-verdict")).toHaveAttribute("data-verdict", "yellow"));
    expect(screen.getByTestId("afford-answer")).toHaveTextContent("Knappt – tas 8 000 kr från sparandet på ISK räcker pengarna 8 månader med sparandet (i dag 8,3).");
    // Saved with the money from ISK: the purchase, and the money moved to the bank the day it is paid.
    await userEvent.click(screen.getByRole("button", { name: /Spara som planerad/ }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST", "/cashflow/planned").map(([, b]) => b)).toEqual([
        {
          date: "2026-09-24",
          amount: -800000,
          description: "iPhone",
          accountId: null,
          shared: false,
        },
        { date: "2026-09-24", amount: 800000, description: "Från ISK: iPhone" },
      ]),
    );
  });

  it("Kopiera läget: shown first, with the purchase when there is one, then copied", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: /Kopiera läget/ }));
    expect(await screen.findByTestId("snapshot-text")).toHaveTextContent("# Ekonomiskt läge");
    expect(screen.getByTestId("snapshot-text")).not.toHaveTextContent("Köpet");
    await userEvent.click(screen.getByRole("button", { name: "Avbryt" }));

    await userEvent.type(screen.getByLabelText("Belopp"), "8000");
    await userEvent.type(screen.getByLabelText("Datum"), "2026-09-24");
    await screen.findByTestId("afford-verdict");
    await userEvent.click(screen.getByRole("button", { name: /Kopiera läget/ }));
    expect(await screen.findByTestId("snapshot-text")).toHaveTextContent("## Köpet jag funderar på");
    expect(callsTo(fetchMock, "GET", "/afford/snapshot").at(-1)?.[0]).toMatch(/^\/api\/afford\/snapshot\?amount=800000&date=2026-09-24/);
    await userEvent.click(screen.getByRole("button", { name: /^Kopiera$/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("# Ekonomiskt läge\n## Köpet jag funderar på"));
    expect(await screen.findByText("Läget är kopierat. Klistra in det i en Claude-chatt.")).toBeInTheDocument();
  });

  it("'Räkna bara med mat på kortet' is turned on and off with a click, and the forecast is fetched again", async () => {
    renderTab();
    const box = await screen.findByRole("switch", {
      name: "Räkna bara med mat på kortet",
    });
    expect(box).not.toBeChecked();
    const loads = () =>
      fetchMock.mock.calls.filter(([u, i]) => String(u).startsWith("/api/cashflow") && !String(u).includes("/pay-day") && !(i as RequestInit | undefined)?.method).length;
    const before = loads();
    await userEvent.click(box);
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/cashflow/settings")).toEqual([["/api/cashflow/settings", { foodOnly: true }]]));
    await waitFor(() => expect(loads()).toBeGreaterThan(before));
  });

  it("with only the food counted the box is ticked", async () => {
    fetchMock = mockApi({
      "GET /cashflow": {
        ...DATA,
        foodOnly: true,
        variable: { ...DATA.variable, perDay: 4000, fullPerDay: 10000 },
      },
      "GET /accounts": [],
    });
    renderTab();
    expect(
      await screen.findByRole("switch", {
        name: "Räkna bara med mat på kortet",
      }),
    ).toBeChecked();
  });

  it("Dag för dag: up to the next salary and its bills, 30 or 90 days; the lowest day has its own row", async () => {
    renderTab();
    const list = await screen.findByTestId("day-list");
    const days = () => [...list.querySelectorAll("[data-day]")].map((e) => e.getAttribute("data-day"));
    // The salary 24/9 and the invoice it pays 25/9; the lowest point 23/9 with nothing else on it.
    expect(days()).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
    expect(list.querySelector('[data-day="2026-09-23"]')).toHaveTextContent(/Lägsta punkt\s*rörliga utgifter 100 kr\/dag har dragits/);
    await userEvent.click(screen.getByRole("radio", { name: "90 dagar" }));
    expect(days()).toEqual(["2026-09-23", "2026-09-24", "2026-09-25", "2026-11-10"]);
    expect(screen.queryByRole("button", { name: /Visa alla 90 dagar/ })).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Till nästa lön" }));
    await userEvent.click(screen.getByRole("button", { name: /Visa alla 90 dagar/ }));
    expect(days()).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "90 dagar" })).toHaveAttribute("aria-checked", "true");
  });

  it("an invoice says how much of it is still to be bought", async () => {
    renderTab();
    await screen.findByTestId("cashflow-chart");
    const invoiceDay = document.querySelector('[data-day="2026-09-25"]') as HTMLElement;
    expect(invoiceDay).toHaveTextContent(/Bank Norwegian: fakturakortfaktura, uppskattad, varav ca 1\s800 kr kommande köp/);
  });
});
