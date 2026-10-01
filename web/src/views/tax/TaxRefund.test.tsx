import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaxRefund, TaxYearRules } from "../../api";
import { callsTo, mockApi } from "../../../test/api";
import { TaxRefundPopover, TaxRefundTable } from "./TaxRefundBreakdown";
import { TaxRules } from "../settings/sections/TaxRules";
import { AheadCard } from "../overview/situation/AheadCard";

/** The hand-worked case for 2026 as the server gives it. */
const CASE: TaxRefund = {
  incomeYear: 2026,
  payDate: "2027-06-10",
  basis: "return",
  input: {
    salary: { value: 360_000, from: "rad 1.1 i deklarationen" },
    commuteDeduction: { value: 14_000, from: "rad 2.1 i deklarationen" },
    iskStandardIncome: { value: 0, from: "rad 7.1 i deklarationen" },
    capitalIncome: { value: 250, from: "rad 7.2 i deklarationen" },
    capitalExpenses: { value: 0, from: "rad 8.1 i deklarationen" },
  },
  finalTax: {
    ffi: 346_000,
    basicDeduction: 29_400,
    bfi: 316_600,
    municipalTax: 96_816,
    burialFee: 924,
    churchFee: 0,
    stateTax: 0,
    pensionFee: 25_200,
    pensionFeeReduction: 25_200,
    publicService: 1_184,
    workIncome: 346_000,
    jobTaxCredit: 35_666,
    earnedIncomeReduction: 1_500,
    capitalSurplus: 250,
    capitalTax: 75,
    capitalDeficitReduction: 0,
    total: 61_833,
    ki: 0.3058,
  },
  missing: null,
  preliminary: { payslips: 68_000, payslipMonths: 12, forecast: 0, forecastMonths: 0, estimated: 0, estimatedMonths: 0, bank: 75, total: 68_075 },
  refund: 6_242,
  paid: null,
  estimated: true,
};
const rowText = (label: string) => screen.getByText(label).closest("tr")!.textContent;

describe("the refund's arithmetic", () => {
  it("every step with where the figures come from, down to the refund and its day", () => {
    render(<TaxRefundTable r={CASE} />);
    expect(rowText("= Fastställd förvärvsinkomst")).toMatch(/346\s000 kr/);
    expect(rowText("− Grundavdrag")).toMatch(/29\s400 kr/);
    expect(rowText("Kommunal skatt 30,58 %")).toMatch(/96\s816 kr/);
    expect(rowText("− Jobbskatteavdrag")).toMatch(/arbetsinkomst 346\s000 kr35\s666 kr/);
    expect(rowText("= Slutlig skatt")).toMatch(/61\s833 kr/);
    expect(rowText("= Preliminärskatt")).toMatch(/68\s075 kr/);
    expect(screen.queryByText("Kyrkoavgift")).toBeNull();
    expect(document.querySelector('[data-figure="refund"]')).toHaveTextContent(/Återbäring 6\s242 kr · 10\/6 2027/);
    expect(screen.getByText("uppskattning")).toBeInTheDocument();
  });

  it("kvarskatt when negative; only the final tax for a year without payslips; the rates missing said", () => {
    const { unmount } = render(<TaxRefundTable r={{ ...CASE, refund: -1_200, finalTax: { ...CASE.finalTax!, churchFee: 2_311 } }} />);
    expect(document.querySelector('[data-figure="refund"]')).toHaveTextContent(/Kvarskatt 1\s200 kr/);
    expect(rowText("Kyrkoavgift")).toMatch(/2\s311 kr/);
    unmount();
    const second = render(<TaxRefundTable r={{ ...CASE, incomeYear: 2024, preliminary: null, refund: null }} />);
    expect(screen.getByText(/Preliminärskatten för 2024 finns inte i verktyget/)).toBeInTheDocument();
    second.unmount();
    render(<TaxRefundTable r={{ ...CASE, finalTax: null, refund: null, missing: "Skattesatserna för 2026 saknas: fyll i dem under Inställningar › Lön." }} />);
    expect(screen.getByText(/Skattesatserna för 2026 saknas/)).toBeInTheDocument();
  });

  it("opens in a popover, fetched when opened", async () => {
    const fetchMock = mockApi({ "GET /tax/refund/2026": CASE });
    render(<TaxRefundPopover year={2026}>Visa uträkning</TaxRefundPopover>);
    expect(callsTo(fetchMock, "GET", "/tax/refund")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Visa uträkning" }));
    expect(await screen.findByTestId("tax-refund-breakdown")).toHaveTextContent(/Återbäring 6\s242 kr/);
  });
});

describe("Inställningar › Lön › Slutlig skatt per inkomstår", () => {
  const YEAR: TaxYearRules = {
    year: 2026,
    pbbOre: 5_920_000,
    ibbOre: 8_340_000,
    stateThresholdOre: 64_300_000,
    publicServiceIbb: 1.42,
    jobTaxCredit: { lowRate: 0.3874, midBase: 1.813, midRate: 0.251, top: 3.027, taper: null },
    source: "SKV 433 2026",
    municipalPct: null,
    regionPct: null,
    burialPct: null,
    churchPct: null,
    ratesSource: "fylls i",
  };

  it("says the rates are missing, and saves the four rates with their source", async () => {
    const fetchMock = mockApi({ "GET /tax/rules": { years: [YEAR] }, "PUT /tax/rules": { years: [{ ...YEAR, municipalPct: 18.25, regionPct: 12.33, burialPct: 0.292, churchPct: 0.73 }] } });
    render(<TaxRules />);
    const row = (await screen.findByText("satserna saknas")).closest("li")!;
    expect(row).toHaveTextContent("jobbskatteavdrag 0,3874 / 1,813 + 0,251 / 3,027 PBB");
    await userEvent.click(within(row).getByRole("button", { name: "Ändra skattereglerna för 2026" }));
    const form = screen.getByTestId("tax-rules-form");
    await userEvent.type(within(form).getByLabelText("Kommunalskatt (%)"), "18,25");
    await userEvent.type(within(form).getByLabelText("Regionskatt (%)"), "12,33");
    await userEvent.type(within(form).getByLabelText("Begravningsavgift (%)"), "0,292");
    await userEvent.type(within(form).getByLabelText("Kyrkoavgift (%)"), "0,73");
    await userEvent.clear(within(form).getByLabelText("Källa för satserna"));
    await userEvent.type(within(form).getByLabelText("Källa för satserna"), "Skattesatser kommuner 2026");
    await userEvent.click(within(form).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/tax/rules/2026")).toHaveLength(1));
    expect(callsTo(fetchMock, "PUT", "/tax/rules/2026")[0][1]).toMatchObject({ municipalPct: 18.25, regionPct: 12.33, burialPct: 0.292, churchPct: 0.73, ratesSource: "Skattesatser kommuner 2026", pbbOre: 5_920_000 });
    expect(await screen.findByText(/kommun 18,25 % \+ region 12,33 % · begravning 0,292 % · kyrka 0,73 %/)).toBeInTheDocument();
  });
});

describe("Framåt › a refund further off than the cycle", () => {
  it("is a line of its own with the arithmetic behind it", async () => {
    mockApi({ "GET /tax/refund/2026": CASE });
    render(
      <AheadCard
        start={100_000_00}
        ahead={{ from: "2026-09-26", to: "2026-10-22", startOre: 100_000_00, items: [], endOre: 100_000_00, salaries: [], later: [{ incomeYear: 2026, payDate: "2027-06-10", amount: 624_200 }] }}
      />,
    );
    const line = screen.getByTestId("ahead-later");
    expect(line).toHaveTextContent(/Skatteåterbäring för 2026 \(uppskattad\): \+6\s242 kr omkring 10\/6 2027 – utanför perioden/);
    await userEvent.click(within(line).getByRole("button", { name: "Visa uträkning" }));
    expect(await screen.findByTestId("tax-refund-breakdown")).toBeInTheDocument();
  });
});
