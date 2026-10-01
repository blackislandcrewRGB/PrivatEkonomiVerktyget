import { describe, expect, it } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "../../components/ui/tooltip";
import type { AnnualIncome as Data } from "../../api";
import { mockApi } from "../../../test/api";
import { AnnualIncome } from "./AnnualIncome";
import { approx, pct, shortKr } from "./annual";

const render = (ui: ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

const CURRENT = {
  year: 2026,
  paid: 22_500_000,
  paidMonths: 9,
  forecast: 2_600_000,
  forecastMonths: 1,
  estimated: 5_000_000,
  remainingMonths: 2,
  average: 2_500_000,
  deviation: 200_000,
  expected: 30_100_000,
  low: 29_700_000,
  high: 30_500_000,
};
const year = (y: number, amount: number | null, source: Data["years"][number]["source"], change: Data["years"][number]["change"] = null) => ({
  year: y,
  amount,
  source,
  declared: source === "declared" ? amount : null,
  payslips: null,
  change,
  kpi: null,
});

describe("Lön › Årsinkomst", () => {
  it("says where the year lands, with the span and the months left", async () => {
    mockApi({
      "GET /salary/annual": {
        current: CURRENT,
        years: [year(2023, 25_000_000, "declared"), year(2024, 30_000_000, "declared", { nominal: 0.2, real: 0.1537 }), year(2025, null, null), year(2026, CURRENT.expected, "forecast")],
      },
    });
    render(<AnnualIncome />);
    expect(await screen.findByText(/^~301\s000\skr$/)).toBeInTheDocument();
    expect(screen.getByTestId("annual-span")).toHaveTextContent(/mellan 297\s000\skr och 305\s000\skr · 2 månader kvar à 25\s000\skr ± 2\s000\skr/);
    expect(screen.getByTestId("annual-change")).toHaveTextContent("2025 saknas: läs in deklarationskvittensen i Importer");
    const bar = document.querySelector('[data-year="2024"]')!;
    expect(bar).toHaveTextContent("300k");
    expect(bar.querySelector("[data-change]")).toHaveTextContent("+20 %");
    expect(bar.querySelector("[data-real]")).toHaveTextContent("+15 % realt");
    expect(document.querySelector('[data-year="2025"]')).toHaveTextContent("saknas");
    // This year in two parts: paid and the forecast.
    const now = document.querySelector('[data-year="2026"]')!;
    expect(now.querySelector('[data-part="paid"]')).not.toBeNull();
    expect(now.querySelector('[data-part="forecast"]')).not.toBeNull();
  });

  it("gives the change from last year when there is one, and the specs beside the declared figure", async () => {
    mockApi({
      "GET /salary/annual": {
        current: CURRENT,
        years: [
          { ...year(2025, 30_000_000, "declared", null), payslips: 29_957_700 },
          year(2026, CURRENT.expected, "forecast", { nominal: -0.0126, real: -0.0301 }),
        ],
      },
    });
    render(<AnnualIncome />);
    expect(await screen.findByTestId("annual-change")).toHaveTextContent("mot 2025: −1,3 % nominellt · −3,0 % realt");
    expect(screen.getByTestId("annual-diffs")).toHaveTextContent(/2025: specarna 299\s577\skr · deklarerat 300\s000\skr \(\+423\skr\)/);
  });

  it("formats as the card says it", () => {
    expect(approx(30_100_000)).toMatch(/^301\s000\skr$/);
    expect(pct(0.2)).toBe("+20,0 %");
    expect(pct(-0.0003, 0)).toBe("±0 %");
    expect(shortKr(879_100)).toBe("8,8k");
    expect(shortKr(30_000_000)).toBe("300k");
  });
});
