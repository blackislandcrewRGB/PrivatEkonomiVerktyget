import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import { PageHeader } from "../../shell/PageHeader";
import { mockApi } from "../../../test/api";
import { AnalysisView } from "./AnalysisView";

// jsdom has no layout: the chart gets a fixed size so its bars are drawn.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 900, height: 300 }),
}));

const month = (m: string, groceries: number, restaurants: number, takeaway: number) => {
  const all = groceries + restaurants + takeaway;
  return { month: m, groceries, restaurants, takeaway, outShare: all ? (restaurants + takeaway) / all : null };
};
const totalOf = (months: ReturnType<typeof month>[]) => {
  const t = month("", ...(["groceries", "restaurants", "takeaway"] as const).map((k) => months.reduce((s, m) => s + m[k], 0)) as [number, number, number]);
  return { groceries: t.groceries, restaurants: t.restaurants, takeaway: t.takeaway, outShare: t.outShare };
};

/** 3 mån on 26 September: July and August whole, September begun. 7 500 + 1 500 + 1 000 kr: 25 % eaten out. */
const MONTHS = [month("2026-07", 300_000, 60_000, 40_000), month("2026-08", 300_000, 60_000, 40_000), month("2026-09", 150_000, 30_000, 20_000)];
const NOW = { months: MONTHS, total: totalOf(MONTHS) };
/** Last year: 20 % eaten out, less on restaurants, as much on takeaway. */
const THEN_MONTHS = [month("2025-07", 320_000, 40_000, 40_000), month("2025-08", 320_000, 40_000, 40_000), month("2025-09", 160_000, 20_000, 20_000)];
const THEN = { months: THEN_MONTHS, total: totalOf(THEN_MONTHS) };
const EMPTY = { months: THEN_MONTHS.map((m) => month(m.month, 0, 0, 0)), total: month("", 0, 0, 0) };

const setup = (now: object = NOW, then: object = THEN) =>
  mockApi({ "/categories": [], "/analysis/food": (url: string) => (url.includes("from=2025-") ? then : now) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 26, 12));
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/analys?flik=mat&period=3m");
  setup();
});

const renderPage = () =>
  render(
    <TooltipProvider>
      <PageHeader title="Analys" />
      <AnalysisView openTransactions={() => {}} />
    </TooltipProvider>,
  );
const card = (id: string) => document.querySelector(`[data-card="${id}"]`) as HTMLElement;

describe("Analys › Mat, Design v2", () => {
  it("the ring: livsmedel, restaurang & café and hämtmat as their shares of all the food, the share eaten out in the middle", async () => {
    renderPage();
    const ring = await screen.findByRole("img", { name: "25 % ute och hämtmat av maten" });
    const parts = Object.fromEntries([...ring.querySelectorAll<SVGElement>("[data-segment]")].map((s) => [s.dataset.segment, Number(s.dataset.part)]));
    expect(parts).toEqual({ groceries: 0.75, restaurants: 0.15, takeaway: 0.1 });
    expect(ring).toHaveTextContent("25 %ute + hämtmat");
  });

  it("the change in percentage points against last year: orange up, with the food in the period and per whole month", async () => {
    renderPage();
    await screen.findByRole("img", { name: /ute och hämtmat/ });
    const pill = card("share").querySelector("[data-change]")!;
    expect(pill).toHaveAttribute("data-change", "up");
    expect(pill).toHaveClass("bg-caution-soft", "text-caution-text");
    expect(pill).toHaveTextContent("↗ +5,0 p.e. mot förra året (20 %)");
    // 10 000 kr in the period; July and August 4 000 kr each (September is begun).
    expect(card("share")).toHaveTextContent(/10\s000 kr på mat i perioden · 4\s000 kr\/mån/);
  });

  it("green and down when less is eaten out, grey within ±0,5 p.e., and no pill without last year's food", async () => {
    setup(THEN, NOW);
    const { unmount } = renderPage();
    await screen.findByRole("img", { name: /ute och hämtmat/ });
    const down = card("share").querySelector("[data-change]")!;
    expect(down).toHaveAttribute("data-change", "down");
    expect(down).toHaveClass("bg-positive-soft", "text-positive-text");
    expect(down).toHaveTextContent("↘ −5,0 p.e. mot förra året (25 %)");
    unmount();

    // 25,4 % against 25 %: 0,4 p.e., grey.
    const close = [month("2025-07", 298_000, 62_000, 40_000), month("2025-08", 300_000, 60_000, 40_000), month("2025-09", 150_000, 30_000, 20_000)];
    const nearly = { months: close, total: { ...totalOf(close), outShare: 0.254 } };
    setup(nearly, NOW);
    const second = renderPage();
    await screen.findByRole("img", { name: /ute och hämtmat/ });
    expect(card("share").querySelector("[data-change]")).toHaveAttribute("data-change", "flat");
    expect(card("share").querySelector("[data-change]")).toHaveClass("bg-segment", "text-ink-2");
    second.unmount();

    setup(NOW, EMPTY);
    renderPage();
    await screen.findByRole("img", { name: /ute och hämtmat/ });
    expect(card("share").querySelector("[data-change]")).toBeNull();
  });

  it("a card each with its sum, per whole month and the change in percent against last year", async () => {
    renderPage();
    await screen.findByRole("img", { name: /ute och hämtmat/ });
    // Livsmedel 7 500 against 8 000 kr: −6 %, green.
    expect(card("groceries")).toHaveTextContent(/^Livsmedel7\s500 kr3\s000 kr\/mån−6 %förra året 8\s000 kr$/);
    expect(card("groceries").querySelector("[data-change]")).toHaveAttribute("data-change", "down");
    // Restaurang & café 1 500 against 1 000 kr: +50 %, orange.
    expect(card("restaurants")).toHaveTextContent(/^Restaurang & café1\s500 kr600 kr\/mån\+50 %förra året 1\s000 kr$/);
    expect(card("restaurants").querySelector("[data-change]")).toHaveClass("bg-caution-soft");
    // Hämtmat as much as last year: 0 %, grey.
    expect(card("takeaway").querySelector("[data-change]")).toHaveAttribute("data-change", "flat");
    expect(card("takeaway").querySelector("[data-change]")).toHaveTextContent(/^0 %$/);
  });

  it("says 'ingen jämförelse' when last year had none of it", async () => {
    setup(NOW, EMPTY);
    renderPage();
    await screen.findByRole("img", { name: /ute och hämtmat/ });
    for (const k of ["groceries", "restaurants", "takeaway"]) {
      expect(card(k).querySelector("[data-change]")).toBeNull();
      expect(card(k)).toHaveTextContent(/ingen jämförelse$/);
    }
  });

  it("the bars are the table's amounts, and the pill over each bar is the table's share in the same tone", async () => {
    // A share on each side of the tones' limits: 19,9 %, 20 %, 30 %, 40 %, 40,1 %.
    const edges = [month("2026-05", 80_100, 19_900, 0), month("2026-06", 80_000, 10_000, 10_000), month("2026-07", 70_000, 30_000, 0), month("2026-08", 60_000, 0, 40_000), month("2026-09", 59_900, 20_100, 20_000)];
    setup({ months: edges, total: totalOf(edges) }, EMPTY);
    window.history.replaceState(null, "", "/analys?flik=mat&period=anpassat&fran=2026-05-01&till=2026-09-26");
    renderPage();
    const table = await screen.findByRole("table", { name: "Mat per månad" });
    const bars = card("bars");
    for (const m of edges) {
      const row = table.querySelector<HTMLElement>(`[data-month="${m.month}"]`)!;
      const cells = within(row).getAllByRole("cell");
      // Livsmedel, Restaurang & café and Hämtmat after the month and Fördelning.
      (["groceries", "restaurants", "takeaway"] as const).forEach((k, i) => {
        const drawn = Number(bars.querySelector<SVGElement>(`[data-bar="${m.month}:${k}"]`)!.dataset.value);
        expect(drawn).toBe(m[k]);
        expect(cells[2 + i].textContent!.replace(/\s/g, "")).toBe(m[k] ? `${m[k] / 100}kr` : "–");
      });
      const pill = bars.querySelector<SVGElement>(`[data-share-pill="${m.month}"]`)!;
      const cellPill = row.querySelector<HTMLElement>("[data-tone]")!;
      expect(pill.dataset.tone).toBe(cellPill.dataset.tone);
      expect(pill.textContent).toBe(cellPill.textContent);
    }
    expect(edges.map((m) => table.querySelector(`[data-month="${m.month}"] [data-tone]`)!.getAttribute("data-tone"))).toEqual(["low", "normal", "high", "high", "very-high"]);
    expect(table.querySelector('[data-month="2026-09"] [data-tone]')).toHaveClass("bg-heat-high", "text-caution-text");
    // This month is light blue and bold.
    expect(table.querySelector('[data-month="2026-09"]')).toHaveClass("bg-row-current", "font-semibold");
  });

  it("Fördelning: each month's bar against the largest month, in three parts", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Mat per månad" });
    const spread = (m: string) => Number(table.querySelector<HTMLElement>(`[data-month="${m}"] [data-spread]`)!.dataset.spread);
    expect([spread("2026-07"), spread("2026-08"), spread("2026-09")]).toEqual([1, 1, 0.5]);
    const parts = [...table.querySelectorAll<HTMLElement>('[data-month="2026-07"] [data-part]')].map((p) => [p.dataset.part, p.style.width]);
    expect(parts).toEqual([["groceries", "75%"], ["restaurants", "15%"], ["takeaway", "10%"]]);
    expect(within(table).getByRole("columnheader", { name: "Fördelning" })).toHaveClass("hidden", "@[36rem]:table-cell");
  });
});

