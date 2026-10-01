import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import { PageHeader } from "../../shell/PageHeader";
import { mockApi } from "../../../test/api";
import { AnalysisView } from "./AnalysisView";

// jsdom has no layout: the chart gets a fixed size so its bars and pills are drawn.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 900, height: 300 }),
}));

const m = (month: string, fixed: number, variable: number, income: number) => ({ month, fixed, variable, income, net: income - fixed - variable, fixedShareOfIncome: income > 0 ? fixed / income : null });
const sum = (months: ReturnType<typeof m>[]) => {
  const [fixed, variable, income] = (["fixed", "variable", "income"] as const).map((k) => months.reduce((s, x) => s + x[k], 0));
  return { fixed, variable, income, net: income - fixed - variable, fixedShareOfIncome: fixed / income };
};
/** 3 mån on 26 September: July went back, September is begun. */
const MONTHS = [m("2026-06", 700_000, 800_000, 2_500_000), m("2026-07", 685_200, 2_523_500, 2_459_100), m("2026-08", 1_100_000, 900_000, 2_600_000), m("2026-09", 150_000, 100_000, 2_700_000)];
const DATA = { months: MONTHS, total: sum(MONTHS) };

const setup = (data: object = DATA) => mockApi({ "/categories": [], "/analysis/fixed-variable": data });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 26, 12));
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/analys?flik=fasta&period=3m");
  setup();
});
const renderPage = () =>
  render(
    <TooltipProvider>
      <PageHeader title="Analys" />
      <AnalysisView openTransactions={() => {}} />
    </TooltipProvider>,
  );

describe("Analys › Fasta mot rörliga, Design v2", () => {
  it("the income bar's parts add up to the income, each with kronor and its share", async () => {
    renderPage();
    const bar = await screen.findByRole("img", { name: /^Fasta/ });
    const parts = [...bar.querySelectorAll<HTMLElement>("[data-segment]")];
    expect(parts.map((p) => p.dataset.segment)).toEqual(["fixed", "variable", "net"]);
    expect(parts.reduce((s, p) => s + Number(p.dataset.ore), 0)).toBe(DATA.total.income);
    expect(parts.reduce((s, p) => s + Number(p.dataset.width), 0)).toBeCloseTo(1, 10);
    expect(bar).not.toHaveAttribute("data-over");
    expect(screen.getByTestId("income")).toHaveTextContent(/102\s591 kr/);
    expect(screen.queryByTestId("over")).not.toBeInTheDocument();
  });

  it("more out than in: no net, a red edge and by how much", async () => {
    const back = [m("2026-08", 1_000_000, 2_000_000, 2_500_000)];
    setup({ months: back, total: sum(back) });
    renderPage();
    const bar = await screen.findByRole("img", { name: /mer ut än in/ });
    expect(bar).toHaveAttribute("data-over", "true");
    expect(bar).toHaveClass("ring-alarm");
    expect([...bar.querySelectorAll<HTMLElement>("[data-segment]")].map((p) => p.dataset.segment)).toEqual(["fixed", "variable"]);
    expect(screen.getByTestId("over")).toHaveTextContent(/^5\s000 kr mer ut än in$/);
  });

  it("the boxes: per whole month, with the range and the months above nothing", async () => {
    renderPage();
    await screen.findByTestId("income");
    const box = (id: string) => document.querySelector(`[data-box="${id}"]`)!;
    // June 7 000, July 6 852, August 11 000: 8 284 kr; September is begun.
    expect(box("fixed")).toHaveTextContent(/Fasta per månad8\s284 krsnitt · 6\s852–11\s000/);
    expect(box("net")).toHaveTextContent(/2 av 3 månader positiva/);
    expect(box("share")).toHaveTextContent(/lägst 27,9 % \(juli\) · högst 42,3 % \(aug\)/);
  });

  it("the net over each bar: green up, red down", async () => {
    renderPage();
    await screen.findByTestId("income");
    const pill = (month: string) => document.querySelector<SVGElement>(`[data-net-pill="${month}"]`)!;
    expect(pill("2026-06").dataset.tone).toBe("positive");
    expect(pill("2026-06").textContent).toBe("+10k");
    expect(pill("2026-07").dataset.tone).toBe("negative");
    expect(pill("2026-07").textContent).toBe("−7k");
    expect(pill("2026-07").querySelector("rect")).toHaveAttribute("fill", "var(--color-alarm-soft)");
    // The income as a stroke over each month.
    expect(document.querySelectorAll("[data-income]")).toHaveLength(4);
  });

  it("the table: the net green or red, the fixed share toned, a month that went back red in its spread", async () => {
    renderPage();
    await screen.findByTestId("income");
    const row = (month: string) => document.querySelector(`[data-month="${month}"]`)!;
    expect(row("2026-07").querySelector("[data-net]")).toHaveClass("text-alarm");
    expect(row("2026-06").querySelector("[data-net]")).toHaveClass("text-positive-text");
    expect(row("2026-07").querySelector('[data-part="net"]')).toHaveClass("bg-alarm");
    expect(row("2026-06").querySelector('[data-part="net"]')).not.toHaveClass("bg-alarm");
    // 28 %, 27,9 %, 42,3 % and 5,6 %.
    expect(MONTHS.map((x) => row(x.month).querySelector("[data-tone]")!.getAttribute("data-tone"))).toEqual(["normal", "normal", "high", "low"]);
    expect(row("2026-09")).toHaveClass("bg-row-current", "font-semibold");
  });
});
