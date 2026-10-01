import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { clearPersistentState } from "../../usePersistentState";
import { Prices, fillMarks } from "./Prices";

// jsdom has no layout: the charts get a fixed size so their marks are drawn.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 900, height: 240 }),
}));

/**
 * Analys › Priser.
 *
 * What the tests hold on to is that the view says what a figure means: whose
 * months are being compared, that my line is spending and theirs is prices,
 * and where every number came from and when.
 */

/** Swedish formatting uses non-breaking spaces and a real minus sign. */
const plain = (text: string) => text.replace(/\s/g, " ").replace(/−/g, "-");

const MONTHS = [
  { month: "2025-09", mineOre: 602_600, mineIndex: 10_000, kpiIndex: 10_000 },
  { month: "2025-10", mineOre: 500_700, mineIndex: 8_310, kpiIndex: 10_039 },
  { month: "2026-07", mineOre: null, mineIndex: null, kpiIndex: 9_418 },
  { month: "2026-08", mineOre: 522_900, mineIndex: 8_677, kpiIndex: 9_411 },
];

const FILLS = [
  // One off a receipt — 58,20 l for 1 064,48 kr is 18,29 kr/l after the
  // discount — and one that only has a price entered by hand.
  { id: 1, date: "2026-09-10", description: "CIRCLE K EXEMPELSTAD", week: "2026-09-07", mineOre: 1_829, source: "receipt" as const, priceDate: "2026-09-10", listOre: 1_849, discountOre: 20, litres: 58.2, avgOre: 1_825, diffOre: 4 },
  { id: 2, date: "2026-04-21", description: "OKQ8 EXEMPELSTAD", week: "2026-04-20", mineOre: 1_784, source: "entered" as const, priceDate: "2026-04-21", listOre: null, discountOre: null, litres: null, avgOre: 1_872, diffOre: -88 },
];

const base = () => ({
  food: {
    base: { month: "2025-09", mineOre: 602_600, kpi: 13_236 },
    months: MONTHS,
    through: "2026-08",
    change: { mine: -1_323, kpi: -589 },
    subgroups: [
      { key: "kpi_dairy", name: "Mjölk, ost och ägg", months: MONTHS.map((m) => ({ month: m.month, index: 9_000 })), changePctE2: -1_232 },
      { key: "kpi_meat", name: "Kött", months: MONTHS.map((m) => ({ month: m.month, index: 10_010 })), changePctE2: 11 },
    ],
    source: { name: "SCB, KPI efter COICOP (2020=100)", fetchedAt: "2026-09-21T06:10:00.000Z", latest: "2026-08-01" },
    missing: null as string | null,
  },
  fuel: {
    fills: FILLS,
    weeks: [
      { week: "2026-09-07", ore: 1_825 },
      { week: "2026-09-14", ore: 1_935 },
    ],
    average: { diffOre: 23, count: 16, skipped: 1, listDiffOre: 48, listCount: 12, discountOre: 20, receipts: 12 },
    monthly: { shifts: 14, month: "2026-09", litres: 70.4, ore: 4_364 },
    source: { name: "Weekly Oil Bulletin, Europeiska kommissionen", fetchedAt: "2026-09-21T06:10:00.000Z", latest: "2026-09-14" },
    missing: null as string | null,
  },
  series: [],
  settings: { baseMonth: null },
});

let data: ReturnType<typeof base>;
let fetchMock: ReturnType<typeof mockApi>;

beforeEach(() => {
  clearPersistentState();
  data = base();
  fetchMock = mockApi({
    "GET /analysis/prices": () => data,
    "POST /analysis/prices/sync": { sources: [{ source: "scb", ok: true, added: 0, revised: 0, skipped: "inget nytt publicerat sedan 2026-08-01" }] },
    "GET /categories": [
      { id: 1, name: "Mat", parentId: null, systemKey: null, color: "#2E7D32" },
      { id: 2, name: "Livsmedel", parentId: 1, systemKey: "groceries", color: null },
      { id: 3, name: "Bil", parentId: null, systemKey: null, color: "#D55E00" },
      { id: 4, name: "Drivmedel", parentId: 3, systemKey: null, color: null },
    ],
  });
});

const renderTab = () =>
  render(
    <TooltipProvider>
      <Prices from="2025-09-01" to="2026-09-21" period={{ preset: "12m", from: "", to: "" }} share="mine" showPrivate={false} openTransactions={vi.fn()} />
      <Toaster />
    </TooltipProvider>,
  );

describe("Analys › Priser: maten", () => {
  it("puts my change and theirs side by side, and says which months", async () => {
    renderTab();
    const section = (await screen.findByText("Mat mot konsumentprisindex")).closest("section")!;
    expect(plain(section.textContent!)).toContain("-13,2 %");
    expect(plain(section.textContent!)).toContain("-5,9 %");
    // The months are named, because a percentage without them is a claim
    // about nothing in particular.
    expect(plain(section.textContent!)).toContain("september 2025 → augusti 2026");
  });

  it("says that the two lines answer different questions", async () => {
    renderTab();
    const section = (await screen.findByText("Mat mot konsumentprisindex")).closest("section")!;
    expect(section.textContent).toMatch(/vad du handlade för/);
    expect(section.textContent).toMatch(/vad maten kostade/);
    // And that the food is the household's, not my half.
    expect(section.textContent).toMatch(/hela hushållet/);
  });

  it("names the source and when it was fetched", async () => {
    renderTab();
    const section = (await screen.findByText("Mat mot konsumentprisindex")).closest("section")!;
    expect(section.textContent).toMatch(/Källa: SCB/);
    expect(section.textContent).toMatch(/hämtat 21 september 2026/);
    expect(section.textContent).toMatch(/senaste augusti 2026/);
  });

  it("shows the subgroups without a line of mine, and says why", async () => {
    renderTab();
    const section = (await screen.findByText("Varugrupper hos SCB")).closest("section")!;
    expect(within(section).getByText("Mjölk, ost och ägg")).toBeInTheDocument();
    expect(plain(section.textContent!)).toContain("-12,3 %");
    expect(section.textContent).toMatch(/inte varor på ett kvitto/);
  });

  it("says what is missing instead of drawing a line from nothing", async () => {
    data = { ...data, food: { ...data.food, missing: "Inga matinköp finns registrerade för 2025-09, så min egen linje kan inte börja där." } };
    renderTab();
    expect(await screen.findByText(/Inga matinköp finns registrerade/)).toBeInTheDocument();
  });
});

describe("Analys › Priser: dieseln", () => {
  it("shows the average deviation and what it is worth in a month", async () => {
    renderTab();
    const section = (await screen.findByText("Diesel mot rikssnittet")).closest("section")!;
    expect(plain(section.textContent!)).toContain("+23 öre/l");
    expect(plain(section.textContent!)).toContain("+44 kr/mån");
    expect(plain(section.textContent!)).toContain("14 pass ≈ 70,4 liter");
    // The skipped fill-ups are said out loud rather than quietly dropped.
    expect(plain(section.textContent!)).toContain("16 tankningar, 1 utan pris den dagen");
  });

  it("lists every fill-up against its own week", async () => {
    renderTab();
    const section = (await screen.findByText("Diesel mot rikssnittet")).closest("section")!;
    const row = within(section).getByText("CIRCLE K EXEMPELSTAD").closest("tr")!;
    // Litres, what the card was charged, the pump's price and the week's
    // average — the four figures the comparison rests on.
    expect(plain(row.textContent!)).toContain("58,20 l");
    expect(plain(row.textContent!)).toContain("18,29 kr/l");
    expect(plain(row.textContent!)).toContain("18,49 kr/l");
    expect(plain(row.textContent!)).toContain("18,25 kr/l");
    expect(plain(row.textContent!)).toContain("+4 öre/l");
    // A cheaper week reads as a saving, not as a warning.
    const cheaper = within(section).getByText("OKQ8 EXEMPELSTAD").closest("tr")!;
    expect(plain(cheaper.textContent!)).toContain("-88 öre/l");
  });

  it("says what 'my price' actually is, behind Så läser du diagrammet", async () => {
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Så läser du diagrammet ›" }));
    const how = await screen.findByRole("dialog");
    expect(how.textContent).toMatch(/vad kortet faktiskt drogs/);
    expect(how.textContent).toMatch(/pumpens listpris och inte vad du betalade/);
    expect(how.textContent).toMatch(/Tankningar märkta resa ingår inte/);
  });

  it("says when there is no average to compare against", async () => {
    data = { ...data, fuel: { ...data.fuel, missing: "Rikssnittet är inte hämtat ännu." } };
    renderTab();
    expect(await screen.findByText("Rikssnittet är inte hämtat ännu.")).toBeInTheDocument();
  });
});

describe("Hämta nu", () => {
  it("runs the fetch and repeats what the source said", async () => {
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: /Hämta nu/ }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/analysis/prices/sync")).toHaveLength(1));
    expect(await screen.findByText(/inget nytt publicerat sedan 2026-08-01/)).toBeInTheDocument();
  });
});

describe("betalat pris mot pumppris", () => {
  it("keeps what I pay apart from what the station asks", async () => {
    renderTab();
    const section = (await screen.findByText("Diesel mot rikssnittet")).closest("section")!;
    expect(plain(section.textContent!)).toContain("+23 öre/l");
    expect(plain(section.textContent!)).toContain("+48 öre/l");
    expect(plain(section.textContent!)).toContain("du får 20 öre/l i rabatt, 12 kvitton");
    // And says plainly which of the two figures is which.
    await userEvent.click(within(section).getByRole("button", { name: "Så läser du diagrammet ›" }));
    const how = await screen.findByRole("dialog");
    expect(how.textContent).toMatch(/vad kortet faktiskt drogs/);
    expect(how.textContent).toMatch(/skillnaden mellan de två talen är din rabatt/);
  });

  it("draws both prices of a receipt, with the discount between them", () => {
    const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
    const { paid, pump, discounts } = fillMarks(FILLS, t);
    // The receipt: a dot at what was paid, a ring at the pump's price, and
    // the 20 öre between them drawn as a stroke.
    expect(paid.map((p) => [p.id, p.ore])).toEqual([[1, 1_829]]);
    expect(pump.map((p) => [p.id, p.ore])).toEqual([
      [1, 1_849],
      [2, 1_784],
    ]);
    expect(discounts).toEqual([{ t: t("2026-09-10"), from: 1_829, to: 1_849 }]);
    // The entered price is a pump price: a ring and nothing else — never a
    // dot that would pass for what was paid.
    expect(paid.find((p) => p.id === 2)).toBeUndefined();
  });

  it("says in the legend which mark is which", async () => {
    renderTab();
    const section = (await screen.findByText("Diesel mot rikssnittet")).closest("section")!;
    for (const label of ["Du betalade, under rikssnittet", "över rikssnittet", "Pumppris före rabatt", "Rikssnitt per vecka"]) {
      expect(within(section).getAllByText(label).length).toBeGreaterThan(0);
    }
    await userEvent.click(within(section).getByRole("button", { name: "Så läser du diagrammet ›" }));
    expect((await screen.findByRole("dialog")).textContent).toMatch(/strecket mellan dem är rabatten/);
  });

  it("marks a fill-up whose price is only an entered one", async () => {
    renderTab();
    const section = (await screen.findByText("Diesel mot rikssnittet")).closest("section")!;
    const estimated = within(section).getByText("OKQ8 EXEMPELSTAD").closest("tr")!;
    expect(within(estimated).getByTitle("Inlagt literpris, inte vad du betalade")).toBeInTheDocument();
    // No receipt, so no litres and no pump price to show.
    expect(plain(estimated.textContent!)).toContain("–");
  });
});

describe("Design v2", () => {
  it("each group's pill and line in its tone: down green, up orange, within ±0,2 % grey", async () => {
    data = {
      ...data,
      food: {
        ...data.food,
        subgroups: [
          { key: "a", name: "Kött", months: data.food.subgroups[0].months, changePctE2: 11 },
          { key: "b", name: "Kaffe", months: data.food.subgroups[0].months, changePctE2: 21 },
          { key: "c", name: "Te", months: data.food.subgroups[0].months, changePctE2: -705 },
        ],
      },
    };
    renderTab();
    const section = (await screen.findByText("Varugrupper hos SCB")).closest("section")!;
    const tone = (k: string) => section.querySelector(`[data-group="${k}"] [data-tone]`)!;
    expect([tone("a"), tone("b"), tone("c")].map((t) => t.getAttribute("data-tone"))).toEqual(["flat", "up", "down"]);
    expect(tone("c")).toHaveClass("bg-positive-soft", "text-positive-text");
    expect(tone("b")).toHaveClass("bg-caution-soft", "text-caution-text");
  });

  it("a receipt's dot is red over the week's average and matches the table's pill; one without a receipt is only a ring", async () => {
    renderTab();
    const section = (await screen.findByText("Diesel mot rikssnittet")).closest("section")!;
    const dot = section.querySelector<SVGElement>('[data-dot="1"]')!;
    expect(dot.dataset.tone).toBe("over");
    expect(dot).toHaveAttribute("fill", "var(--color-alarm)");
    expect(section.querySelector('[data-ring="1"]')).not.toBeNull();
    // The entered price: a ring, never a dot that would pass for what was paid.
    expect(section.querySelector('[data-ring="2"]')).not.toBeNull();
    expect(section.querySelector('[data-dot="2"]')).toBeNull();
    // The table says the same as the dot.
    const pill = (id: number) => section.querySelector(`[data-fill="${id}"] [data-tone]`)!;
    expect(pill(1).getAttribute("data-tone")).toBe(dot.dataset.tone);
    expect(pill(1)).toHaveClass("bg-caution-soft");
    expect(pill(2).getAttribute("data-tone")).toBe("under");
    expect(pill(2)).toHaveClass("bg-positive-soft");
  });

  it("shows the eight latest fill-ups, newest first, and all of them on request", async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...FILLS[0], id: 100 + i, date: `2026-0${(i % 9) + 1}-1${i % 10}`, diffOre: i - 5 }));
    data = { ...data, fuel: { ...data.fuel, fills: many } };
    renderTab();
    const section = (await screen.findByText("Diesel mot rikssnittet")).closest("section")!;
    const rows = () => [...section.querySelectorAll<HTMLElement>("[data-fill]")].map((r) => r.dataset.fill);
    expect(rows()).toHaveLength(8);
    const dates = [...section.querySelectorAll<HTMLElement>("[data-fill]")].map((r) => many.find((f) => String(f.id) === r.dataset.fill)!.date);
    expect(dates).toEqual([...dates].sort().reverse());
    await userEvent.click(within(section).getByRole("button", { name: "Visa alla 11 tankningar ›" }));
    expect(rows()).toHaveLength(11);
  });
});

