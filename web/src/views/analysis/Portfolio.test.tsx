import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Instrument, InstrumentDetail, PortfolioValue } from "../../api";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { Portfolio } from "./Portfolio";

/**
 * Innehav.
 *
 * The numbers are a made-up portfolio as of 18 September 2026, round enough
 * that what the table says can be checked by hand. What is tested
 * hardest is the two things that must not happen: a missing price counted as
 * zero, and a movement dressed up as a verdict.
 */

const instrument = (id: number, name: string, over: Partial<Instrument> = {}): Instrument => ({
  id,
  name,
  isin: null,
  currency: "USD",
  kind: "stock",
  zone: "bet",
  tickerYahoo: name.slice(0, 4).toUpperCase(),
  tickerAvanza: null,
  createdAt: "2026-09-18T10:00:00Z",
  deletedAt: null,
  ...over,
});

const INSTRUMENTS: Instrument[] = [
  instrument(1, "Exempelfond Global Index", { currency: "EUR", kind: "etf", zone: "base", tickerYahoo: "EXFG.DE", isin: "IE00EXEMPEL1" }),
  instrument(2, "Exempelbolaget A", { tickerYahoo: "EXA" }),
  instrument(3, "Exempelbolaget B", { tickerYahoo: "EXB" }),
  instrument(4, "Exempelbolaget C", { tickerYahoo: "EXC" }),
];

const holding = (id: number, name: string, quantity: number, priceE4: number, valueOre: number, zone: "base" | "bet", currency: "EUR" | "USD") => ({
  instrumentId: id,
  name,
  isin: null,
  currency,
  kind: (zone === "base" ? "etf" : "stock") as "etf" | "stock",
  zone,
  account: "isk" as const,
  quantityE4: quantity * 10000,
  priceE4,
  priceDate: "2026-09-18",
  priceSource: "yahoo",
  rateE6: currency === "EUR" ? 11050000 : 9950000,
  rateDate: "2026-09-18",
  rateSource: "riksbank",
  valueOre,
  missing: null as null | "price" | "rate",
  stale: false,
});

const BASE: PortfolioValue = {
  on: "2026-09-20",
  holdings: [
    holding(1, "Exempelfond Global Index", 50, 1504000, 8309600, "base", "EUR"),
    holding(2, "Exempelbolaget A", 12, 2305000, 2752170, "bet", "USD"),
    holding(3, "Exempelbolaget B", 5, 1202500, 598244, "bet", "USD"),
    holding(4, "Exempelbolaget C", 30, 251000, 749235, "bet", "USD"),
  ],
  instruments: [],
  accounts: [{ account: "isk", securitiesOre: 12409249, cashOre: 1000000, cashDate: "2026-09-18", totalOre: 13409249 }],
  zones: {
    base: { zone: "base", valueOre: 8309600, share: 0.6696, targetShare: 0.8 },
    bet: { zone: "bet", valueOre: 4099649, share: 0.3304, targetShare: 0.2 },
  },
  policy: {
    betShare: 0.3304,
    state: "over",
    trimOre: 2022249,
    toBaseOre: 3989347,
    roomOre: null,
    text: "Bet-zonen är 33 % av portföljen — över 25 %. Sälj för 20 222 kr så är den på 20 %, eller lägg 39 893 kr i basen så är den på 25 %.",
  },
  totalOre: 12409249,
  investedOre: 9858225,
  priceDate: "2026-09-18",
  missing: [],
  stale: [],
  reconciliation: {
    on: "2026-09-20",
    securitiesOre: 12409249,
    cashOre: 1000000,
    cashDate: "2026-09-18",
    computedOre: 13409249,
    enteredOre: 13400000,
    enteredDate: "2026-09-19",
    differenceOre: -9249,
    text: "Skillnad −92 kr — avrundning, avgifter och att Avanza räknar med sin egen växelkurs.",
  },
};

const DETAIL: InstrumentDetail = {
  instrument: INSTRUMENTS[2],
  quantityE4: 50000,
  valueOre: 598244,
  investedOre: 751225,
  investedUnknown: false,
  priceE4: 1202500,
  priceDate: "2026-09-18",
  priceSource: "yahoo",
  trades: [
    { id: 9, account: "isk", side: "opening", date: "2026-09-18", quantityE4: 50000, priceE4: 1510000, feeOre: 0, fxRateE6: null, amountOre: 751225, transactionId: null, note: null },
  ],
  history: [
    { date: "2026-09-17", priceE4: 1190000, source: "yahoo" },
    { date: "2026-09-18", priceE4: 1202500, source: "yahoo" },
  ],
};

let data: PortfolioValue;
let fetchMock: ReturnType<typeof mockApi>;

beforeEach(() => {
  data = BASE;
  fetchMock = mockApi({
    "GET /savings/portfolio": () => data,
    "GET /savings/instruments/3": () => DETAIL,
    "GET /savings/instruments": () => INSTRUMENTS,
    "GET /savings/transfers": [{ id: 77, date: "2026-09-15", amountOre: 400000, text: "Swish Avanza", linked: false }],
    "POST /savings/prices/sync": { at: "2026-09-20T10:00:00Z", ok: true, prices: [{ instrumentId: 1, name: "EXFG", ticker: "EXFG.DE", ok: true }], rates: [] },
    "POST /savings/trades": { id: 12 },
    "POST /savings/instruments": { id: 5 },
    "PUT /savings/cash": { ok: true },
    "POST /savings/opening": { instruments: [], trades: [] },
    "DELETE /savings/trades/9": { ok: true },
  });
});

const renderSection = () =>
  render(
    <TooltipProvider>
      <Portfolio />
      <Toaster />
    </TooltipProvider>,
  );

describe("Innehav", () => {
  it("visar innehaven med kursens datum, basen först", async () => {
    renderSection();
    // The sources are named because there is more than one of them: a rate
    // that came from Yahoo must not be presented as the Riksbank's fixing.
    expect(await screen.findByText(/kurser 18\/9 \(Yahoo\), växelkurs från Riksbanken · oberoende av perioden/)).toBeInTheDocument();

    const names = screen.getAllByRole("button", { name: /Exempel/ }).map((b) => b.textContent);
    // The base first, then the bet zone by size.
    expect(names).toEqual(["Exempelfond Global Index", "Exempelbolaget A", "Exempelbolaget C", "Exempelbolaget B"]);
    const row = screen.getByText("Exempelbolaget A").closest("tr")!;
    expect(within(row).getByText(/230,5 USD/)).toBeInTheDocument();
    expect(within(row).getByText("22,2 %")).toBeInTheDocument();
  });

  it("säger var zonerna står och vad policyn kräver: en stapel mot målet och varningen i en orange ruta", async () => {
    renderSection();
    const note = await screen.findByRole("note", { name: "Bet-zonen" });
    expect(note).toHaveTextContent(/Bet-zonen är 33 % av portföljen — över 25 %/);
    expect(note).toHaveClass("bg-caution-soft");
    const bet = document.querySelector('[data-segment="bet"]')!;
    expect(bet).toHaveTextContent(/^Bet-zonen 33,0 % · /);
    expect(document.querySelector("[data-mark]")).toHaveTextContent("mål 80/20");
  });

  it("ställer beräknat mot inmatat, med likviderna som egen post", async () => {
    renderSection();
    expect(await screen.findByText(/varav 10 000 kr likvider/)).toBeInTheDocument();
    expect(screen.getByText(/Skillnad −92 kr — avrundning/)).toBeInTheDocument();
  });

  it("räknar aldrig ett innehav utan kurs som noll", async () => {
    data = {
      ...BASE,
      holdings: [BASE.holdings[0], { ...BASE.holdings[3], priceE4: null, priceDate: null, valueOre: null, missing: "price" }],
      missing: [{ ...BASE.holdings[3], priceE4: null, priceDate: null, valueOre: null, missing: "price" }],
      totalOre: 8309600,
    };
    renderSection();
    expect(await screen.findByText(/Exempelbolaget C saknar kurs och räknas inte med i summan/)).toBeInTheDocument();
    const row = screen.getByText("Exempelbolaget C").closest("tr")!;
    expect(within(row).getByText("kurs saknas")).toBeInTheDocument();
    // No value, and no share invented for it either.
    expect(within(row).getAllByText("–").length).toBeGreaterThan(0);
  });

  it("märker en gammal kurs på raden och säger det över tabellen", async () => {
    const old = { ...BASE.holdings[3], priceDate: "2026-09-10", stale: true };
    data = { ...BASE, holdings: [BASE.holdings[0], old], stale: [old] };
    renderSection();
    expect(await screen.findByText(/Exempelbolaget C värderas med en kurs äldre än tre bankdagar/)).toBeInTheDocument();
    const row = screen.getByText("Exempelbolaget C").closest("tr")!;
    expect(within(row).getByText(/10\/9 · gammal/)).toHaveClass("text-caution-text");
    const fresh = screen.getByText("Exempelfond Global Index").closest("tr")!;
    expect(within(fresh).queryByText(/gammal/)).toBeNull();
  });

  it("hämtar kurser på begäran och säger hur det gick", async () => {
    renderSection();
    await screen.findByTestId("portfolio-total");
    await userEvent.click(screen.getByRole("button", { name: /Hämta kurser/ }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/savings/prices/sync")).toHaveLength(1));
    expect(await screen.findByText("Kurserna är hämtade (1 instrument).")).toBeInTheDocument();
  });

  it("registrerar en affär i de enheter den står i hos Avanza", async () => {
    renderSection();
    await screen.findByTestId("portfolio-total");
    await userEvent.click(screen.getByRole("button", { name: "Registrera affär" }));
    const dialog = within(await screen.findByRole("dialog"));

    await userEvent.selectOptions(dialog.getByLabelText("Instrument"), "1");
    await userEvent.type(dialog.getByLabelText("Antal"), "0,75");
    await userEvent.type(dialog.getByLabelText("Kurs"), "150,40");
    await userEvent.type(dialog.getByLabelText("Courtage"), "25");
    await userEvent.click(dialog.getByRole("button", { name: "Spara affär" }));

    const [[, body]] = callsTo(fetchMock, "POST", "/savings/trades");
    // 0,75 shares in ten-thousandths, 150,40 likewise, courtage in öre.
    expect(body).toMatchObject({ instrumentId: 1, account: "isk", side: "buy", quantityE4: 7500, priceE4: 1504000, feeOre: 2500, fxRateE6: null });
  });

  it("tar växelkursen man faktiskt betalade när den skrivs in", async () => {
    renderSection();
    await screen.findByTestId("portfolio-total");
    await userEvent.click(screen.getByRole("button", { name: "Registrera affär" }));
    const dialog = within(await screen.findByRole("dialog"));

    await userEvent.selectOptions(dialog.getByLabelText("Instrument"), "2");
    await userEvent.type(dialog.getByLabelText("Antal"), "3");
    await userEvent.type(dialog.getByLabelText("Kurs"), "230,50");
    await userEvent.type(dialog.getByLabelText("Växelkurs"), "9,50");
    await userEvent.click(dialog.getByRole("button", { name: "Spara affär" }));

    expect(callsTo(fetchMock, "POST", "/savings/trades")[0][1]).toMatchObject({ fxRateE6: 9500000 });
  });

  it("kopplar affären till överföringen som betalade den", async () => {
    renderSection();
    await screen.findByTestId("portfolio-total");
    await userEvent.click(screen.getByRole("button", { name: "Registrera affär" }));
    const dialog = within(await screen.findByRole("dialog"));

    await userEvent.selectOptions(dialog.getByLabelText("Instrument"), "1");
    await userEvent.type(dialog.getByLabelText("Antal"), "1");
    await userEvent.type(dialog.getByLabelText("Kurs"), "150,40");
    await userEvent.selectOptions(dialog.getByLabelText("Överföring"), "77");
    await userEvent.click(dialog.getByRole("button", { name: "Spara affär" }));

    expect(callsTo(fetchMock, "POST", "/savings/trades")[0][1]).toMatchObject({ transactionId: 77 });
  });

  it("lägger till ett instrument med ticker och zon", async () => {
    renderSection();
    await screen.findByTestId("portfolio-total");
    await userEvent.click(screen.getByRole("button", { name: /^Instrument$/ }));
    const dialog = within(await screen.findByRole("dialog"));

    await userEvent.type(dialog.getByLabelText("Namn"), "Novo Nordisk");
    await userEvent.type(dialog.getByLabelText("Ticker (Yahoo)"), "NVO");
    await userEvent.selectOptions(dialog.getByLabelText("Zon"), "bet");
    await userEvent.click(dialog.getByRole("button", { name: "Spara" }));

    expect(callsTo(fetchMock, "POST", "/savings/instruments")[0][1]).toMatchObject({ name: "Novo Nordisk", tickerYahoo: "NVO", zone: "bet", currency: "USD" });
  });

  it("för in likvider som en egen post", async () => {
    renderSection();
    await screen.findByTestId("portfolio-total");
    await userEvent.click(screen.getByRole("button", { name: /Likvider/ }));
    const dialog = within(await screen.findByRole("dialog"));

    const amount = dialog.getByLabelText("Belopp");
    await userEvent.clear(amount);
    await userEvent.type(amount, "10000,00");
    await userEvent.click(dialog.getByRole("button", { name: "Spara" }));

    expect(callsTo(fetchMock, "PUT", "/savings/cash")[0][1]).toMatchObject({ account: "isk", amountOre: 1000000 });
  });

  it("visar ett instrument för sig: affärer, insatt och kurs — utan dom", async () => {
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Exempelbolaget B" }));
    const dialog = within(await screen.findByRole("dialog"));

    expect(await dialog.findByText("Bet-zonen · USD · EXB")).toBeInTheDocument();
    expect(dialog.getByText("5 982 kr")).toBeInTheDocument();
    // What was put in: as the stat, and again as the trade that put it in.
    expect(dialog.getAllByText("7 512 kr")).toHaveLength(2);
    expect(dialog.getByText("köp minus sälj, i kronor")).toBeInTheDocument();
    // What it cost and what it is worth stand side by side; nothing says
    // 'down 20 %', and nothing is red.
    expect(dialog.queryByText(/%/)).toBeNull();
    expect(dialog.getByText(/Startinnehav 5 × 151 USD/)).toBeInTheDocument();
  });

  it("tar bort en affär ur instrumentets lista", async () => {
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Exempelbolaget B" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(await dialog.findByLabelText("Ta bort affären 18/9"));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/savings/trades/9")).toHaveLength(1));
    expect(await screen.findByText("Affären är borttagen.")).toBeInTheDocument();
  });

  it("pekar på vägen in när det inte finns något innehav", async () => {
    data = { ...BASE, holdings: [], totalOre: 0, priceDate: null };
    renderSection();
    expect(await screen.findByText(/Inga innehav ännu/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lägg in startinnehav" })).toBeInTheDocument();
  });

  it("skriver av hela portföljen på en gång, med likviderna", async () => {
    data = { ...BASE, holdings: [], totalOre: 0, priceDate: null };
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Lägg in startinnehav" }));
    const dialog = within(await screen.findByRole("dialog"));

    await userEvent.type(dialog.getByLabelText("Namn rad 1"), "Exempelfond Global Index");
    await userEvent.type(dialog.getByLabelText("Ticker rad 1"), "EXFG.DE");
    await userEvent.selectOptions(dialog.getByLabelText("Valuta rad 1"), "EUR");
    await userEvent.selectOptions(dialog.getByLabelText("Zon rad 1"), "base");
    await userEvent.type(dialog.getByLabelText("Antal rad 1"), "50");
    await userEvent.type(dialog.getByLabelText("Snittinköp rad 1"), "100,00");

    await userEvent.click(dialog.getByRole("button", { name: /Rad till/ }));
    await userEvent.type(dialog.getByLabelText("Namn rad 2"), "Exempelbolaget A");
    await userEvent.type(dialog.getByLabelText("Ticker rad 2"), "EXA");
    await userEvent.type(dialog.getByLabelText("Antal rad 2"), "12");
    await userEvent.type(dialog.getByLabelText("Snittinköp rad 2"), "200,00");
    await userEvent.type(dialog.getByLabelText("Likvider"), "10000,00");

    await userEvent.click(dialog.getByRole("button", { name: "Lägg in 2 innehav" }));
    const [[, body]] = callsTo(fetchMock, "POST", "/savings/opening");
    expect(body).toMatchObject({
      account: "isk",
      cashOre: 1000000,
      rows: [
        { name: "Exempelfond Global Index", tickerYahoo: "EXFG.DE", currency: "EUR", zone: "base", kind: "etf", quantityE4: 500000, priceE4: 1000000 },
        { name: "Exempelbolaget A", tickerYahoo: "EXA", currency: "USD", zone: "bet", kind: "stock", quantityE4: 120000, priceE4: 2000000 },
      ],
    });
    expect(await screen.findByText("2 innehav är inlagda. Tryck Hämta kurser för kurserna.")).toBeInTheDocument();
  });

  it("fördelningsstapeln blir hela kontot, och målmarkören står där basen skulle sluta på 80 %", async () => {
    renderSection();
    const total = await screen.findByTestId("portfolio-total");
    const parts = [...document.querySelectorAll<HTMLElement>("[data-segment]")];
    const sum = parts.reduce((s, p) => s + Number(p.dataset.ore), 0);
    const securities = BASE.totalOre;
    const cash = BASE.accounts.reduce((s, a) => s + (a.cashOre ?? 0), 0);
    expect(sum).toBe(securities + cash);
    expect(total.textContent!.replace(/\s/g, "")).toBe(`${Math.round((securities + cash) / 100)}kr`);
    expect(Number(document.querySelector<HTMLElement>("[data-mark]")!.dataset.mark)).toBeCloseTo(0.8 * (securities / (securities + cash)), 10);
  });

  it("varnar i en orange ruta bara när bet-zonen är över gränsen", async () => {
    data = { ...BASE, policy: { ...BASE.policy, state: "within", text: "Bet-zonen är 20 % av portföljen, inom 15–25 %." } };
    renderSection();
    expect(await screen.findByTestId("policy")).toHaveTextContent("inom 15–25 %");
    expect(screen.queryByRole("note", { name: "Bet-zonen" })).toBeNull();
  });
});

