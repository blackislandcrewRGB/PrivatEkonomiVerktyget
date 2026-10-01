import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommuteDeduction } from "../../api";
import { callsTo, mockApi } from "../../../test/api";
import { Deduction } from "./Deduction";

const DATA: CommuteDeduction = {
  settings: { ratePerMil: 2500, thresholds: { "2025": 1100000, "2026": 1500000 }, marginalTax: 0.32 },
  oneWayKm: 20,
  conditions: { minOneWayKm: 5, minTimeSavedHours: 2 },
  years: [
    {
      year: "2026",
      shifts: 172,
      milPerShift: 4,
      gross: 1720000,
      threshold: 1500000,
      thresholdYear: "2026",
      deductible: 220000,
      taxEffect: 70400,
      shiftsToThreshold: 150,
      months: [{ month: "2026-09", shifts: 14, days: ["2026-09-02"] }],
    },
    { year: "2025", shifts: 12, milPerShift: 4, gross: 120000, threshold: 1100000, thresholdYear: "2025", deductible: 0, taxEffect: 0, shiftsToThreshold: 110, months: [{ month: "2025-12", shifts: 12, days: [] }] },
  ],
  declared: [],
  backtest: { year: "2025", declared: null, computed: null, shifts: 0, months: 0, diff: null },
  forecast: null,
};

let fetchMock: ReturnType<typeof mockApi>;
beforeEach(() => {
  fetchMock = mockApi({ "GET /fuel/deduction": DATA, "PUT /fuel/deduction/settings": DATA.settings });
});

describe("Pendling › Reseavdrag", () => {
  it("the deductible amount, the tax it saves, the sum behind it, the conditions and the shifts as the basis", async () => {
    render(<Deduction />);
    expect(await screen.findByText("2 200 kr")).toBeInTheDocument();
    expect(screen.getByText("704 kr")).toBeInTheDocument();
    expect(screen.getByText(/172 pass × 4 mil × 25 kr\/mil = 17\s200\skr/)).toBeInTheDocument();
    expect(screen.getByText(/tröskel 15\s000\skr/)).toBeInTheDocument();
    // Past the threshold: grey up to it, green after, the marker between.
    const bar = document.querySelector("[data-threshold]")!;
    expect(bar).toHaveAttribute("data-threshold", "over");
    expect((bar.querySelector("[data-part=grey]") as HTMLElement).style.width).toMatch(/^87\.2/);
    expect((bar.querySelector("[data-part=green]") as HTMLElement).style.width).toMatch(/^12\.7/);
    expect(bar.querySelector("[data-part=marker]")).toBeInTheDocument();
    expect(screen.getByText(/minst 5 km enkel väg \(du har 20 km\) och minst 2 timmars tidsvinst/)).toBeInTheDocument();
    // The basis folds out in the card, as it was.
    expect(screen.queryByRole("table", { name: "Pass 2026" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Underlag per månad" }));
    expect(screen.getByRole("table", { name: "Pass 2026" })).toHaveTextContent("september14 pass2/9");
    // 2025: under the threshold, all grey.
    await userEvent.click(screen.getByRole("radio", { name: "2025" }));
    expect(document.querySelector("[data-threshold]")).toHaveAttribute("data-threshold", "under");
    expect(document.querySelector("[data-part=green]")).toBeNull();
    expect(screen.getByText(/9\s800\skr kvar till tröskeln · avdrag först efter 110 pass, 98 kvar/)).toBeInTheDocument();
  });

  it("rate, marginal tax and the thresholds are edited here", async () => {
    render(<Deduction />);
    await userEvent.click(await screen.findByRole("button", { name: "Ändra" }));
    const tax = screen.getByLabelText("Marginalskatt");
    await userEvent.clear(tax);
    await userEvent.type(tax, "33,5");
    const t = screen.getByLabelText("Tröskel 2026");
    await userEvent.clear(t);
    await userEvent.type(t, "16000");
    await userEvent.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "PUT", "/fuel/deduction/settings")).toEqual([
        ["/api/fuel/deduction/settings", { ratePerMil: 2500, marginalTax: 0.335, thresholds: { "2025": 1100000, "2026": 1600000 } }],
      ]),
    );
  });
});

describe("Pendling › Reseavdrag against the tax return", () => {
  const withReturns = (over: Partial<CommuteDeduction>) => mockApi({ "GET /fuel/deduction": { ...DATA, ...over } });

  it("the likely deduction next spring and what it is worth", async () => {
    withReturns({ forecast: { year: "2026", declareYear: "2027", shifts: 229, perMonth: 19, monthsEstimated: 3, gross: 2_290_000, deductible: 790_000, taxEffect: 252_800 } });
    render(<Deduction />);
    expect(await screen.findByTestId("deduction-forecast")).toHaveTextContent(
      /Troligt avdrag i deklarationen mars 2027: ~7\s900\skr, värt ~2\s500\skr i skatt229 pass: 172 ifyllda \+ 3 månader à 19 pass/,
    );
  });

  it("the years declared, and last year's backtest: both there, only the return, only the shifts", async () => {
    withReturns({
      declared: [
        { year: "2025", amount: 65_000 },
        { year: "2024", amount: 2_000_000 },
      ],
      backtest: { year: "2025", declared: 65_000, computed: 60_000, shifts: 116, months: 12, diff: -5_000 },
    });
    const { unmount } = render(<Deduction />);
    expect(await screen.findByTestId("deduction-declared")).toHaveTextContent(/Deklarerat 2025: 650\skrDeklarerat 2024: 20\s000\skr/);
    expect(screen.getByTestId("deduction-backtest")).toHaveTextContent(/2025: verktyget räknade 600\skr, deklarerat 650\skr, differens −50\skr \(116 pass, 12 månader\)/);
    unmount();

    withReturns({ declared: [{ year: "2025", amount: 65_000 }], backtest: { year: "2025", declared: 65_000, computed: null, shifts: 0, months: 0, diff: null } });
    const second = render(<Deduction />);
    expect(await screen.findByTestId("deduction-backtest")).toHaveTextContent("passen för 2025 saknas i Pendling");
    second.unmount();

    withReturns({ backtest: { year: "2025", declared: null, computed: 20_000, shifts: 112, months: 4, diff: null } });
    render(<Deduction />);
    expect(await screen.findByTestId("deduction-backtest")).toHaveTextContent(/2025: verktyget räknar 200\skr \(112 pass, 4 månader\); deklarationen för 2025 är inte inläst/);
  });
});
