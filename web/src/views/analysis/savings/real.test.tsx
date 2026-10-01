import { cloneElement, type ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { callsTo, mockApi } from "../../../../test/api";
import { describe, expect, it, vi } from "vitest";
import type { RealSavings } from "../../../api";
import { BufferCard } from "./BufferCard";
import { RealCard, signedPct } from "./RealCard";
import { RealTable } from "./RealTable";

// jsdom has no layout: the chart gets a fixed size so its lines are drawn.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 800, height: 180 }),
}));

const kr = (n: number) => n * 100;
const plain = (s: string | null | undefined) => (s ?? "").replace(/\s/g, " ");

const DATA: RealSavings = {
  kpiMonth: "2026-08",
  points: [
    { date: "2025-10-01", valueOre: kr(90_000), grossOre: kr(100_000), debtOre: -kr(10_000), source: "entered", keepOre: kr(90_000) },
    { date: "2026-01-01", valueOre: kr(100_000), grossOre: kr(100_000), debtOre: 0, source: "entered", keepOre: kr(95_500) },
    { date: "2026-09-28", valueOre: kr(120_000), grossOre: kr(120_000), debtOre: 0, source: "today", keepOre: kr(110_000) },
  ],
  totals: {
    since: "2025-10-01",
    until: "2026-09-28",
    startOre: kr(90_000),
    endOre: kr(120_000),
    netOre: kr(15_000),
    deposited: kr(17_000),
    withdrawn: kr(2_000),
    netTodayOre: kr(106_000),
    nominalGainOre: kr(15_000),
    realGainOre: kr(14_000),
    inflationOre: kr(1_000),
    nominal: 0.155,
    inflation: 0.012,
    real: 0.1413,
    iskTaxOre: kr(400),
    realGainAfterTaxOre: kr(13_600),
    creditInterestOre: kr(362),
  },
  periods: [
    { from: "2025-10-01", to: "2026-01-01", startOre: kr(90_000), netOre: kr(5_000), endOre: kr(100_000), nominal: 0.0526, inflation: 0.004, real: 0.0484, ongoing: false },
    { from: "2026-01-01", to: "2026-09-28", startOre: kr(100_000), netOre: kr(10_000), endOre: kr(120_000), nominal: 0.095, inflation: 0.008, real: -0.0004, ongoing: true },
  ],
  years: [
    { year: 2025, nominal: 0.0526, inflation: 0.004, real: 0.0484, iskTaxOre: kr(1_302), iskTaxEstimated: false },
    { year: 2026, nominal: 0.095, inflation: 0.008, real: -0.0004, iskTaxOre: 0, iskTaxEstimated: true },
  ],
  buffer: {
    accountId: 2,
    name: "Swedbank e-sparkonto",
    balanceOre: kr(17_981),
    inflation12: { from: "2025-08", to: "2026-08", change: 0.0031 },
    years: [
      { year: 2024, averageOre: kr(20_000), interestOre: kr(50), rate: 0.0025, inflation: 0.012, real: -0.0094, lostOre: kr(190) },
      { year: 2025, averageOre: kr(3_983), interestOre: 1875, rate: 0.0047, inflation: 0.003, real: 0.0017, lostOre: -700 },
    ],
  },
  avanza: {
    coverage: { from: "2025-01-01", to: "2025-12-31" },
    statements: [
      { id: 1, account: "credit", periodFrom: "2025-01-01", periodTo: "2025-12-31", openingOre: -kr(10_000), closingOre: 0, movements: 12, depositedOre: kr(10_000), withdrawnOre: 0 },
      { id: 2, account: "isk", periodFrom: "2025-01-01", periodTo: "2025-12-31", openingOre: 0, closingOre: kr(1_000), movements: 40, depositedOre: 0, withdrawnOre: 0 },
    ],
  },
};

describe("Sparandet efter inflation", () => {
  it("the real gain in large type, the rates under it, and today's value split into put in, inflation and real gain", () => {
    render(<RealCard data={DATA} onStatements={() => {}} />);
    const hero = document.querySelector<HTMLElement>("[data-figure=real-gain]")!;
    expect(plain(hero.textContent)).toBe("+14 000 kr");
    expect(hero).toHaveAttribute("data-tone", "up");
    expect(plain(document.querySelector("[data-figure=rates]")!.textContent)).toBe("real avkastning +14,1 % · nominellt +15,5 % · inflation +1,2 %");
    expect(screen.getByText(/sedan 1 okt 2025/)).toBeInTheDocument();
    expect(screen.getByText(/augusti 2026/)).toBeInTheDocument();
    // Put in is the start and the net: 105 000 kr, then the 1 000 kr inflation took and the 14 000 kr real gain – 120 000 kr in all.
    expect(plain(document.querySelector("[data-legend=in]")!.textContent)).toBe("Insatt 105 000 kr");
    expect(plain(document.querySelector("[data-legend=inflation]")!.textContent)).toBe("Inflationen 1 000 kr");
    expect(plain(document.querySelector("[data-legend=real]")!.textContent)).toBe("Real vinst 14 000 kr");
    expect(document.querySelector<HTMLElement>("[data-segment=real]")!.style.width).toBe(`${(14_000 / 120_000) * 100}%`);
    // The ISK tax for the span taken off at the end.
    expect(plain(document.querySelector("[data-figure=after-tax]")!.textContent)).toBe("+13 600 kr");
  });

  it("a real loss in red, marked past the value, and one value is nothing to measure yet", () => {
    const loss: RealSavings = { ...DATA, totals: { ...DATA.totals!, endOre: kr(104_000), realGainOre: -kr(2_000), nominalGainOre: -kr(1_000), real: -0.02 } };
    const { rerender } = render(<RealCard data={loss} onStatements={() => {}} />);
    expect(document.querySelector("[data-figure=real-gain]")).toHaveAttribute("data-tone", "down");
    expect(plain(document.querySelector("[data-legend=real]")!.textContent)).toBe("Real förlust 2 000 kr");
    expect(document.querySelector("[data-segment=loss]")).not.toBeNull();
    expect(document.querySelector("[data-segment=real]")).toBeNull();
    rerender(<RealCard data={{ ...DATA, totals: null }} onStatements={() => {}} />);
    expect(screen.getByText(/Det behövs två värden/)).toBeInTheDocument();
  });

  it("per quarter, newest first under each year, the year with its ISK tax and the real return as a toned pill", () => {
    render(<RealTable data={DATA} />);
    const table = screen.getByRole("table", { name: "Avkastning per kvartal" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("data-period") ?? `år ${r.getAttribute("data-year")}`)).toEqual(["2026-01-01", "år 2026", "2025-10-01", "år 2025"]);
    // The period ending 1 January is 2025's.
    expect(plain(rows[2].textContent)).toContain("1/10–1/1");
    expect(plain(rows[0].textContent)).toContain("1/1–i dag");
    expect(plain(rows[3].textContent)).toContain("ISK-skatt 1 302 kr");
    expect(plain(rows[1].textContent)).toContain("ISK-skatt 0 kr (beräknad)");
    // −0,04 % is 0,0 % to a decimal: grey, not red.
    expect(rows[0].querySelector("[data-tone]")).toHaveAttribute("data-tone", "zero");
    expect(rows[2].querySelector("[data-tone]")).toHaveAttribute("data-tone", "up");
  });

  it("the buffer: the interest it takes to keep up, and per year what prices took beyond the interest", () => {
    render(<BufferCard buffer={DATA.buffer!} kpiMonth="2026-08" />);
    expect(plain(document.querySelector("[data-box=needed]")!.textContent)).toContain("0,3 %");
    const y2025 = document.querySelector<HTMLElement>("[data-year='2025']")!;
    expect(plain(y2025.textContent)).toContain("19 kr · 0,5 %");
    expect(within(y2025).getByText("+7 kr")).toHaveAttribute("data-tone", "kept");
    const y2024 = document.querySelector<HTMLElement>("[data-year='2024']")!;
    expect(within(y2024).getByText("−190 kr")).toHaveAttribute("data-tone", "lost");
    // Newest first.
    expect([...document.querySelectorAll("[data-year]")].map((r) => r.getAttribute("data-year"))).toEqual(["2025", "2024"]);
  });

  it("percentages with one decimal and their sign", () => {
    expect([0.161, -0.029, 0.0004, null].map(signedPct)).toEqual(["+16,1 %", "−2,9 %", "0,0 %", "–"]);
  });

  it("net of the credit: the credit's interest beside the gain, the statements read in, and more read from PDFs", async () => {
    const fetchMock = mockApi({ "POST /savings/avanza-statements": [DATA.avanza!.statements[1]] });
    const reloaded: number[] = [];
    render(<RealCard data={DATA} onStatements={() => reloaded.push(1)} />);
    expect(screen.getByText(/värdepapper och likvider, minus krediten/)).toBeInTheDocument();
    expect(plain(document.querySelector("[data-figure=credit-interest]")!.textContent)).toBe("362 kr");
    expect(plain(document.querySelector("[data-part=statements]")!.textContent)).toContain("Kontobesked från Avanza: ISK 2025 · kredit 2025.");
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], "Kontobesked.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Kontobesked från Avanza"), pdf);
    await waitFor(() => expect(reloaded).toEqual([1]));
    expect(callsTo(fetchMock, "POST", "/savings/avanza-statements")).toHaveLength(1);
  });

  it("without statements the card says what reading them in does", () => {
    render(<RealCard data={{ ...DATA, avanza: null }} onStatements={() => {}} />);
    expect(screen.queryByText(/minus krediten/)).toBeNull();
    expect(screen.getByText(/Läs in Avanzas kontobesked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Läs in kontobesked/ })).toBeEnabled();
  });
});
