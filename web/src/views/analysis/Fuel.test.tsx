import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import type { FuelMonth } from "../../api";
import { TooltipProvider } from "../../components/ui/tooltip";
import { PageHeader } from "../../shell/PageHeader";
import { mockApi } from "../../../test/api";
import { AnalysisView } from "./AnalysisView";

// jsdom has no layout: the chart gets a fixed size so its bars are drawn.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 900, height: 240 }),
}));

const month = (m: Partial<FuelMonth> & { month: string }): FuelMonth => ({
  shifts: null,
  km: null,
  spent: 0,
  trips: 0,
  price: null,
  litres: null,
  receipts: 0,
  litresExact: false,
  priceLater: false,
  orePerKm: null,
  l100: null,
  perShift: null,
  ...m,
});
/** June under the table value, July on it exactly, August only a trip, September begun. */
const MONTHS = [
  month({ month: "2026-06", shifts: 15, km: 800, spent: 120_000, l100: 6.0, perShift: 8_000 }),
  month({ month: "2026-07", shifts: 14, km: 760, spent: 150_000, trips: 100_000, l100: 6.5, perShift: 10_000 }),
  month({ month: "2026-08", shifts: 5, km: 400, trips: 170_050 }),
  month({ month: "2026-09", shifts: 14, km: 760, spent: 130_000 }),
];
const SETTINGS = { kmPerShift: 40, otherKmPerMonth: 200, baseConsumption: 6.5, congestionPerShift: 0, useCalibrated: true, categoryId: null, fuelCategoryId: 9 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 26, 12));
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/analys?flik=bransle&period=3m");
  mockApi({ "/categories": [], "/fuel/history": { settings: SETTINGS, months: MONTHS } });
  // Less motion: the bars are drawn in full at once, with their labels (Recharts adds them after the bars have grown).
  vi.spyOn(window, "matchMedia").mockImplementation(
    (q: string) =>
      ({ matches: q.includes("prefers-reduced-motion"), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList,
  );
});
const renderPage = () =>
  render(
    <TooltipProvider>
      <PageHeader title="Analys" />
      <AnalysisView openTransactions={() => {}} />
    </TooltipProvider>,
  );
const figure = (id: string) => document.querySelector(`[data-figure="${id}"]`) as HTMLElement;

describe("Analys › Bränsle, Design v2", () => {
  it("the key figures are the table's: the fuel bought, per shift and the trips its columns summed", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Bränsle per månad" });
    const sum = (attr: string) => [...table.querySelectorAll<HTMLElement>(`[data-${attr}]`)].reduce((s, c) => s + Number(c.getAttribute(`data-${attr}`)), 0);
    expect(sum("spent")).toBe(400_000);
    // 4 000 kr over the three months with a fill-up.
    expect(figure("spent")).toHaveTextContent(/^Tankat under perioden4\s000 kr1\s333 kr\/mån · 3 månader med tankning$/);
    // (80 + 100) ÷ 2 over June and July, with their shifts and km.
    expect(figure("per-shift")).toHaveTextContent(/^Per pass90 kr2 månader med pass · 29 pass · 1\s560 km$/);
    expect(sum("trips")).toBe(270_050);
    expect(figure("trips")).toHaveTextContent(/^Resor, räknas inte2\s701 krtankningar märkta resa · juli och augusti$/);
    expect(figure("trips")).toHaveClass("border-dashed", "bg-card-inset");
  });

  it("the average l/100 km against the table value, with the gauge's fill and mark", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Bränsle per månad" });
    // (6,0 + 6,5) ÷ 2 = 6,25 → 6,3; 0,2 under.
    expect(figure("l100")).toHaveTextContent(/6,3−0,2 mot tabellvärdet 6,5/);
    expect(figure("l100").querySelector("[data-tone]")).toHaveClass("text-positive-text");
    expect(Number(figure("l100").querySelector<HTMLElement>("[data-fill]")!.dataset.fill)).toBeCloseTo((6.25 / 6.5) * 0.75, 10);
    expect(figure("l100").querySelector<HTMLElement>("[data-mark]")!.style.left).toBe("calc(75% - 1px)");
  });

  it("the consumption per month toned against the table value: on it exactly grey, none a grey dash", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Bränsle per månad" });
    const box = (m: string) => document.querySelector<HTMLElement>(`[data-consumption="${m}"]`)!;
    expect([box("2026-06").dataset.tone, box("2026-07").dataset.tone, box("2026-08").dataset.tone]).toEqual(["under", "same", "none"]);
    expect(box("2026-07")).toHaveClass("bg-segment", "text-ink-2");
    expect(box("2026-08")).toHaveTextContent("–");
    // The table's pill says the same.
    const table = screen.getByRole("table", { name: "Bränsle per månad" });
    expect(table.querySelector('[data-month="2026-07"] [data-tone]')).toHaveAttribute("data-tone", "same");
  });

  it("the bars: a month without fuel a grey line, kronor per shift over the others; the table newest first", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Bränsle per månad" });
    expect(document.querySelector('[data-bar="2026-08"]')).toHaveAttribute("data-empty");
    expect(document.querySelector('[data-bar="2026-06"]')).toHaveAttribute("data-value", "120000");
    expect(document.querySelector('[data-per-shift="2026-06"]')!.textContent).toMatch(/^80\skr$/);
    expect(document.querySelector('[data-per-shift="2026-09"]')).toBeNull();
    expect([...table.querySelectorAll<HTMLElement>("[data-month]")].map((r) => r.dataset.month)).toEqual(["2026-09", "2026-08", "2026-07", "2026-06"]);
    expect(within(table).getAllByRole("row")[1]).toHaveClass("bg-row-current", "font-semibold");
    expect(screen.getByRole("button", { name: "Kalibrering i Pendling & bränsle ›" })).toBeInTheDocument();
  });
});
