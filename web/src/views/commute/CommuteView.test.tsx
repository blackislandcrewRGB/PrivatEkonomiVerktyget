import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FuelOverview } from "../../api";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { CommuteView } from "./CommuteView";

const month = (m: string, o: Partial<FuelOverview["months"][number]> = {}) => ({
  month: m,
  shifts: null,
  km: null,
  spent: 0,
  trips: 0,
  price: { id: 1, date: "2026-09-01", price: 1950 },
  litres: null,
  receipts: 0,
  litresExact: false,
  priceLater: false,
  orePerKm: null,
  l100: null,
  perShift: null,
  ...o,
});

const DATA: FuelOverview = {
  today: "2026-09-19",
  settings: { kmPerShift: 40, otherKmPerMonth: 200, baseConsumption: 6.5, congestionPerShift: 0, useCalibrated: true, categoryId: null, fuelCategoryId: 9 },
  latestPrice: { id: 1, date: "2026-09-01", price: 1950, ageDays: 18 },
  prices: [{ id: 1, date: "2026-09-01", price: 1950 }],
  current: {
    month: "2026-09",
    shifts: 14,
    km: 760,
    consumption: 6.44,
    consumptionSource: "calibrated",
    price: { date: "2026-09-01", price: 1950, source: "own" as const, why: "Ditt eget pris, angivet 1 sep. Du tankade 5 sep." },
    expectedFuel: 160000,
    expectedCongestion: 0,
    spent: 117500,
    remaining: 42500,
    perShift: 8800,
  },
  missing: null,
  next: null,
  purchases: [
    { id: 5, date: "2026-09-05", description: "CIRCLE K EXEMPELSTAD", amount: 117500, trip: false },
    { id: 6, date: "2026-09-12", description: "CIRCLE K EXEMPELVIK", amount: 90000, trip: true },
  ],
  months: [month("2026-10"), month("2026-09", { shifts: 14, km: 760, spent: 117500 }), month("2026-08", { shifts: 15, km: 800, spent: 168000, l100: 6.5 }), month("2026-07", { shifts: 15, km: 800, spent: 281500, l100: 9.2, priceLater: true, price: { id: 3, date: "2026-09-19", price: 2258 } })],
  calibration: { l100: 6.44, months: ["2026-06", "2026-07", "2026-08"], min: 6.0, max: 7.0, exactMonths: 0 },
  readings: [
    { id: 2, date: "2026-08-10", km: 152400 },
    { id: 1, date: "2025-08-01", km: 138000 },
  ],
  odometer: {
    from: { id: 1, date: "2025-08-01", km: 138000 },
    to: { id: 2, date: "2026-08-10", km: 152400 },
    actualKm: 14400,
    modelKm: 16500,
    missing: [],
    deviation: 0.146,
    suggestedOtherKm: 120,
  },
};

const ROUTES = {
  "GET /fuel/shift-days": { days: ["2026-10-01"] },
  "GET /fuel/fills": { fills: [], missing: [] },
  "GET /fuel/deduction": { settings: { ratePerMil: 2500, thresholds: { "2026": 1500000 }, marginalTax: 0.32 }, oneWayKm: 20, conditions: { minOneWayKm: 5, minTimeSavedHours: 2 }, years: [] },
  "PUT /fuel/shifts": {},
  "PUT /fuel/shift-days": { days: ["2026-10-01", "2026-10-02"], shifts: 2 },
  "PUT /fuel/settings": {},
};

let fetchMock: ReturnType<typeof mockApi>;
beforeEach(() => {
  fetchMock = mockApi({
    "GET /fuel/shift-days": { days: ["2026-10-01"] },
    "GET /fuel/fills": { fills: [], missing: [] },
    "GET /fuel": DATA,
    "GET /fuel/deduction": { settings: { ratePerMil: 2500, thresholds: { "2026": 1500000 }, marginalTax: 0.32 }, oneWayKm: 20, conditions: { minOneWayKm: 5, minTimeSavedHours: 2 }, years: [] },
    "PUT /fuel/shifts": {},
    "PUT /fuel/shift-days": { days: ["2026-10-01", "2026-10-02"], shifts: 2 },
    "PUT /fuel/settings": {},
  });
});

describe("Pendling & bränsle", () => {
  it("shows what is left to buy this month, kr per shift, the price's age, and leaves out trips", async () => {
    render(<CommuteView />);
    expect((await screen.findByText(/^ca/, { selector: "[data-figure=remaining]" })).textContent).toMatch(/^ca 425\skr$/);
    expect(screen.getByText("14 pass · 760 km")).toBeInTheDocument();
    expect(screen.getByText(/^88\skr per pass$/)).toBeInTheDocument();
    expect(screen.getByText(/beräknat för månaden/).textContent).toMatch(/beräknat för månaden 1\s600\skr/);
    expect(document.querySelector("[data-price]")!.textContent).toMatch(/Diesel 19,50 kr\/l, angivet 1\/9 \(för 18 dagar sedan\)/);
    // The month's fill-ups are behind the gauge, trips struck through.
    await userEvent.click(screen.getByRole("button", { name: /Visa månadens tankningar/ }));
    const bought = await screen.findByRole("list", { name: "Tankningar i månaden" });
    expect(within(bought).getByText(/CIRCLE K EXEMPELVIK \(resa\)/)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Förbrukning: så räknas den" }));
    expect((await screen.findByText(/Kalibrerat:/)).textContent).toContain("6,4 l/100 km (juni–aug, 6,0–7,0), tabellvärde 6,5");
  });

  it("the gauge is under what was reckoned, over it in orange; the bars are the table's months and amounts", async () => {
    const view = render(<CommuteView />);
    const gauge = await screen.findByRole("button", { name: /Visa månadens tankningar/ });
    expect(gauge).toHaveAttribute("data-gauge", "under");
    expect(gauge).toHaveTextContent(/kvar 425/);
    const bars = [...document.querySelectorAll("[data-bar-month]")];
    const rows = [...document.querySelectorAll("tbody tr[data-month]")];
    expect(bars.map((b) => b.getAttribute("data-bar-month"))).toEqual(rows.map((r) => r.getAttribute("data-month")));
    for (const [i, b] of bars.entries()) {
      const cells = rows[i].querySelectorAll("td");
      const money = (t: string | null) => (t ? Number(t.replace(/\D/g, "")) : 0);
      expect(Math.round(Number(b.getAttribute("data-estimate") || 0) / 100)).toBe(money(cells[4].textContent));
      expect(Math.round(Number(b.getAttribute("data-spent")) / 100)).toBe(money(cells[5].textContent!.replace("+ resa", "")));
    }
    view.unmount();

    fetchMock = mockApi({ ...ROUTES, "GET /fuel": { ...DATA, current: { ...DATA.current!, spent: DATA.current!.expectedFuel + 20_000, remaining: 0 } } });
    render(<CommuteView />);
    expect(await screen.findByRole("button", { name: /Visa månadens tankningar/ })).toHaveAttribute("data-gauge", "over");
    expect(screen.getByText(/^200\skr över beräknat$/)).toHaveClass("text-caution-text");
  });

  it("marks a month whose litres come off receipts", async () => {
    fetchMock = mockApi({
      ...ROUTES,
      "GET /fuel": {
        ...DATA,
        months: [month("2026-08", { shifts: 15, km: 800, spent: 168000, l100: 6.5, receipts: 2, litresExact: true })],
        calibration: { l100: 5.43, months: ["2026-06", "2026-07", "2026-08"], min: 4.2, max: 7.6, exactMonths: 3 },
      },
    });
    render(<CommuteView />);
    const august = (await screen.findByRole("textbox", { name: /Pass aug 2026/ })).closest("tr")!;
    // Read, not reckoned: the row says so where the consumption stands.
    expect(within(august).getByTitle("Liter från kvitto, inte uträknade ur beloppet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Förbrukning: så räknas den" }));
    expect((await screen.findByText(/Kalibrerat:/)).textContent).toContain("Liter från kvitto i alla månaderna");
  });

  it("says when the forecast stands on the national average, and why", async () => {
    // A fortnight without a fill-up: my own entered price has had no reason
    // to be updated, so the week's national average takes over — and the line
    // says so instead of quietly changing the amount.
    fetchMock = mockApi({
      ...ROUTES,
      "GET /fuel": {
        ...DATA,
        current: {
          ...DATA.current!,
          price: { date: "2026-09-14", price: 2235, source: "national" as const, why: "Rikssnittet för veckan från 14 sep: ingen egen tankning på 14 dagar, så ditt pris från 18 aug har ingen tankning bakom sig." },
        },
      },
    });
    render(<CommuteView />);
    await screen.findByText(/beräknat för månaden/);
    const price = document.querySelector("[data-price]")!.textContent!;
    expect(price).toMatch(/Diesel 22,35 kr\/l · Rikssnittet för veckan från 14 sep/);
    expect(price).toMatch(/ingen egen tankning på 14 dagar/);
    // And the entered price's own line is not shown at the same time: one
    // price is used, and it is the one named.
    expect(screen.queryByText(/angivet 1\/9/)).not.toBeInTheDocument();
  });

  it("shows each month's price, and marks a later price as uncertain", async () => {
    render(<CommuteView />);
    const july = (await screen.findByRole("textbox", { name: /Pass juli 2026/ })).closest("tr")!;
    expect(july).toHaveTextContent("22,58(från 19/9)");
    // Uncertain in orange rather than with a question mark.
    const l = july.querySelector("[data-l100]")!;
    expect(l).toHaveTextContent(/^9,2$/);
    expect(l).toHaveClass("text-caution-text");
  });

  it("saves a month's shifts, and marking days sets them", async () => {
    render(<CommuteView />);
    // The months ahead are folded under this month.
    await userEvent.click(await screen.findByRole("button", { name: /Kommande månader/ }));
    const oct = await screen.findByRole("textbox", { name: /Pass okt 2026/ });
    await userEvent.type(oct, "12{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/fuel/shifts/2026-10")).toEqual([["/api/fuel/shifts/2026-10", { shifts: 12 }]]));

    await userEvent.click(screen.getByRole("button", { name: /Välj datum för okt 2026/ }));
    const days = await screen.findByRole("group", { name: /Arbetsdagar okt 2026/ });
    expect(within(days).getByRole("button", { name: "2026-10-01" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(days).getByRole("button", { name: "2026-10-02" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/fuel/shift-days/2026-10-02")).toEqual([["/api/fuel/shift-days/2026-10-02", { on: true }]]));
  });

  it("compares with the odometer and can use the suggested other driving", async () => {
    render(
      <>
        <CommuteView />
        <Toaster />
      </>,
    );
    expect(await screen.findByText(/14 400 km enligt mätaren, 16 500 km enligt passen/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Använd" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/fuel/settings")).toEqual([["/api/fuel/settings", { otherKmPerMonth: 120 }]]));
  });
});
