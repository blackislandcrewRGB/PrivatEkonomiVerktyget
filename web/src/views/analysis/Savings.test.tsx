import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SavingsOverview } from "../../api";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { Savings } from "./Savings";

// jsdom has no layout: the chart gets a fixed size so its bars are drawn.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 900, height: 240 }),
}));

const MONTHS = [
  { month: "2026-06", deposited: 500000, withdrawn: 0, net: 500000, income: 3000000, rate: 1 / 6 },
  { month: "2026-07", deposited: 0, withdrawn: 800000, net: -800000, income: 3000000, rate: -0.8 / 3 },
];
const base: SavingsOverview = {
  categoryId: 53,
  months: MONTHS,
  total: { deposited: 500000, withdrawn: 800000, net: -300000, income: 6000000, rate: -0.05 },
  allTime: { since: "2024-08-23", net: 9627344 },
  holdings: [],
  portfolio: null,
};

let data: SavingsOverview;
let fetchMock: ReturnType<typeof mockApi>;
beforeEach(() => {
  data = base;
  // Less motion: the bars are drawn in full at once, with their labels (Recharts adds them after the bars have grown).
  vi.spyOn(window, "matchMedia").mockImplementation(
    (q: string) =>
      ({ matches: q.includes("prefers-reduced-motion"), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList,
  );
  fetchMock = mockApi({
    "GET /savings": () => data,
    // After inflation: nothing to measure here, so it stays out of these tests.
    "GET /savings/real": { kpiMonth: null, points: [], totals: null, periods: [], years: [], buffer: null },
    // The Innehav section sits above this one and asks for its own numbers;
    // an empty portfolio keeps it out of the way of these tests.
    "GET /savings/portfolio": {
      on: "2026-09-20",
      holdings: [],
      instruments: [],
      accounts: [],
      zones: { base: { zone: "base", valueOre: 0, share: null, targetShare: 0.8 }, bet: { zone: "bet", valueOre: 0, share: null, targetShare: 0.2 } },
      policy: { betShare: null, state: "unknown", trimOre: null, toBaseOre: null, roomOre: null, text: "Inget värderat innehav att fördela ännu." },
      totalOre: 0,
      investedOre: 0,
      priceDate: null,
      missing: [],
      reconciliation: { on: "2026-09-20", securitiesOre: 0, cashOre: null, cashDate: null, computedOre: 0, enteredOre: null, enteredDate: null, differenceOre: null, text: "" },
    },
    "POST /savings/holdings": (_: string, init: { json?: unknown }) => {
      const h = { id: 1, name: (init.json as { name: string }).name, values: [], latest: null };
      data = { ...data, holdings: [h] };
      return h;
    },
    "PUT /savings/holdings": { ok: true },
    "PATCH /savings/holdings": { ok: true },
    "DELETE /savings/holdings": { ok: true },
  });
});

const renderTab = (openTransactions = vi.fn()) =>
  render(
    <TooltipProvider>
      <Savings from="2026-06-01" to="2026-07-31" period={{ preset: "custom", from: "2026-06-01", to: "2026-07-31" }} share="mine" showPrivate={false} openTransactions={openTransactions} />
      <Toaster />
    </TooltipProvider>,
  );

describe("Analys › Sparande", () => {
  it("shows put in, taken out, net and the savings rate per month; a month opens its rows", async () => {
    const open = vi.fn();
    renderTab(open);
    const table = (await screen.findByText("Per månad")).closest("section")!;
    const july = within(table).getByText(/juli 2026/).closest("tr")!;
    expect(july).toHaveTextContent(/8\s000 kr/);
    expect(july).toHaveTextContent(/−8\s000 kr/);
    expect(july).toHaveTextContent(/−26,7 %/);
    expect(screen.getByText(/96\s273 kr sedan/)).toBeInTheDocument();
    await userEvent.click(july);
    expect(open).toHaveBeenCalledWith({ period: "2026-07", categoryId: "53" });
  });

  it("adds the ISK with today's value, then enters more values in kronor", async () => {
    renderTab();
    await userEvent.type(await screen.findByLabelText("Värde i dag"), "218 203");
    await userEvent.click(screen.getByRole("button", { name: "Lägg till" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/savings/holdings")).toEqual([["/api/savings/holdings", { name: "Avanza ISK" }]]));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/savings/holdings/1/values")[0][1]).toMatchObject({ value: 21820300 }));
    const value = await screen.findByLabelText("Värde för Avanza ISK");
    await userEvent.type(value, "125 000{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/savings/holdings/1/values")[1][1]).toMatchObject({ value: 12500000 }));
  });

  it("the return: what the value grew beyond the money put in since the first value", async () => {
    data = {
      ...base,
      holdings: [{ id: 1, name: "Avanza ISK", values: [{ date: "2026-06-01", value: 10000000 }, { date: "2026-08-31", value: 10500000 }], latest: { date: "2026-08-31", value: 10500000 } }],
      portfolio: {
        since: "2026-06-01",
        startValue: 10000000,
        date: "2026-08-31",
        value: 10500000,
        deposited: 200000,
        change: 500000,
        return: 300000,
        returnRate: 300000 / 10200000,
        depositedSinceValue: 500000,
        points: [
          { date: "2026-06-01", value: 10000000, deposited: null, change: null, return: null },
          { date: "2026-08-31", value: 10500000, deposited: 200000, change: 500000, return: 300000 },
        ],
      },
    };
    renderTab();
    const stat = (await screen.findAllByText("Avkastning"))[0].parentElement!;
    expect(stat).toHaveTextContent(/\+3\s000 kr/);
    expect(stat).toHaveTextContent(/2,9 %/);
    expect(screen.getByText(/Efter senaste värdet har du satt in netto/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ta bort värdet 2026-08-31" }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/savings/holdings/1/values/2026-08-31")).toHaveLength(1));
  });

  it("a single value can be removed (with Ångra); the holding can be renamed and removed", async () => {
    data = {
      ...base,
      holdings: [{ id: 1, name: "218203", values: [{ date: "2026-09-19", value: 21820300 }], latest: { date: "2026-09-19", value: 21820300 } }],
      portfolio: {
        since: "2026-09-19",
        startValue: 21820300,
        date: "2026-09-19",
        value: 21820300,
        deposited: 0,
        change: 0,
        return: 0,
        returnRate: 0,
        depositedSinceValue: 0,
        points: [{ date: "2026-09-19", value: 21820300, deposited: null, change: null, return: null }],
      },
    };
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Ta bort värdet 2026-09-19" }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/savings/holdings/1/values/2026-09-19")).toHaveLength(1));
    // The toast queue is app-wide: the newest Ångra is this one.
    await userEvent.click((await screen.findAllByRole("button", { name: "Ångra" })).at(-1)!);
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/savings/holdings/1/values")).toEqual([["/api/savings/holdings/1/values", { date: "2026-09-19", value: 21820300 }]]));

    await userEvent.click(screen.getByRole("button", { name: "Byt namn på 218203" }));
    const nameBox = screen.getByLabelText("Nytt namn");
    await userEvent.clear(nameBox);
    await userEvent.type(nameBox, "Avanza ISK{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/savings/holdings/1")).toEqual([["/api/savings/holdings/1", { name: "Avanza ISK" }]]));

    await userEvent.click(screen.getByRole("button", { name: "Ta bort 218203" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Värdet tas bort också");
    await userEvent.click(within(dialog).getByRole("button", { name: "Ta bort" }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/savings/holdings/1").map((c) => c[0])).toContain("/api/savings/holdings/1"));
  });

  it("the savings rate over each bar: up green, down red; a month with more taken out than put in goes down", async () => {
    renderTab();
    await screen.findByText("Sparat per månad");
    const bar = (m: string) => document.querySelector<SVGElement>(`[data-bar="${m}"]`)!;
    expect(bar("2026-06").dataset.direction).toBe("up");
    expect(bar("2026-07").dataset.direction).toBe("down");
    const pill = (m: string) => document.querySelector<SVGElement>(`[data-rate-pill="${m}"]`)!;
    expect([pill("2026-06").dataset.tone, pill("2026-06").textContent]).toEqual(["up", "+17 %"]);
    expect([pill("2026-07").dataset.tone, pill("2026-07").textContent]).toEqual(["down", "−27 %"]);
    // The table's pill in the same tones, with a decimal.
    const table = screen.getByRole("table", { name: "Sparat per månad" });
    expect(table.querySelector('[data-month="2026-07"] [data-tone]')).toHaveAttribute("data-tone", "down");
    expect(table.querySelector('[data-month="2026-07"] [data-net]')).toHaveClass("text-alarm");
    // Netto and Sparkvot in the boxes.
    expect(document.querySelector('[data-box="net"]')).toHaveClass("bg-alarm-soft");
  });

  it("each reading has its return since the one before; the first is the start", async () => {
    data = {
      ...base,
      holdings: [
        {
          id: 1,
          name: "Avanza",
          values: [
            { date: "2026-09-19", value: 21820300 },
            { date: "2026-09-22", value: 22167700 },
            { date: "2026-09-24", value: 21928100 },
          ],
          latest: { date: "2026-09-24", value: 21928100 },
        },
      ],
      portfolio: {
        since: "2026-09-19",
        startValue: 21820300,
        date: "2026-09-24",
        value: 21928100,
        deposited: 0,
        change: 107800,
        return: 107800,
        returnRate: 107800 / 21820300,
        depositedSinceValue: 0,
        points: [
          { date: "2026-09-19", value: 21820300, deposited: null, change: null, return: null },
          { date: "2026-09-22", value: 22167700, deposited: 0, change: 347400, return: 347400 },
          { date: "2026-09-24", value: 21928100, deposited: 0, change: -239600, return: -239600 },
        ],
      },
    };
    renderTab();
    const list = await screen.findByRole("table", { name: "Värden för Avanza" });
    const row = (d: string) => list.querySelector<HTMLElement>(`[data-reading="${d}"]`)!;
    expect(row("2026-09-22").querySelector("[data-return]")).toHaveTextContent(/^\+3\s474 kr$/);
    expect(row("2026-09-22").querySelector("[data-return]")).toHaveClass("text-positive-text");
    expect(row("2026-09-24").querySelector("[data-return]")).toHaveTextContent(/^−2\s396 kr$/);
    expect(row("2026-09-24").querySelector("[data-return]")).toHaveClass("text-alarm");
    expect(row("2026-09-19")).toHaveTextContent(/19\/9start/);
    expect([...list.querySelectorAll<HTMLElement>("[data-reading]")].map((r) => r.dataset.reading)).toEqual(["2026-09-24", "2026-09-22", "2026-09-19"]);
    // A click puts the reading in the box to be changed.
    await userEvent.click(row("2026-09-22"));
    expect(screen.getByLabelText("Värde för Avanza")).toHaveValue("221677");
    expect(screen.getByLabelText("Datum")).toHaveValue("2026-09-22");
  });
});

