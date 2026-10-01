import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaxReturn } from "../../api";
import { callsTo, mockApi } from "../../../test/api";
import { TaxReturnsSection } from "./sections/TaxReturns";
import { taxReturnsSummary } from "./summaries";

const ret = (incomeYear: number, source: "pdf" | "manual", salary: number | null, submittedAt: string | null = `${incomeYear + 1}-03-21`): TaxReturn => ({
  incomeYear,
  submittedAt,
  source,
  boxes: { employmentIncome: salary, commuteDeduction: 2_015_000, iskStandardIncome: null, capitalIncome: 8_800, capitalExpenses: null },
  updatedAt: "2026-09-26T05:00:00Z",
});

const renderSection = () =>
  render(
    <ul>
      <TaxReturnsSection open onToggle={() => {}} match={() => true} />
    </ul>,
  );

describe("Inställningar › Deklaration", () => {
  it("sums up the years there are and when the latest was sent", () => {
    expect(taxReturnsSummary([]).summary).toBe("Inga deklarationer inlästa");
    expect(taxReturnsSummary([ret(2024, "pdf", 1), ret(2023, "pdf", 1), ret(2022, "manual", 1)]).summary).toBe("3 inkomstår, 2022–2024 · 2024 skickad 21/3 2025");
    expect(taxReturnsSummary([ret(2024, "pdf", 1), ret(2021, "pdf", 1)]).summary).toBe("2 inkomstår, 2021 och 2024 · 2024 skickad 21/3 2025");
  });

  it("lists a line per year with the five boxes and where it came from", async () => {
    mockApi({ "GET /tax-returns": [ret(2024, "pdf", 31_240_000), ret(2023, "manual", null, null)] });
    renderSection();
    const row = (await screen.findByText("2024")).closest("tr")!;
    expect(row).toHaveTextContent(/21\/3 2025.*312\s400.*20\s150.*–.*88.*–.*kvittens/);
    const manual = screen.getByText("2023").closest("tr")!;
    expect(manual).toHaveTextContent("för hand");
    expect(within(manual).getAllByText("–").length).toBe(4);
  });

  it("adds a year by hand in kronor (empty boxes stay empty) and refuses what isn't an amount", async () => {
    const fetchMock = mockApi({ "GET /tax-returns": [ret(2024, "pdf", 31_240_000)], "PUT /tax-returns": {} });
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: /Lägg till inkomstår/ }));
    const form = screen.getByTestId("tax-return-form");
    const year = within(form).getByLabelText("Inkomstår");
    await userEvent.clear(year);
    await userEvent.type(year, "2025");
    await userEvent.type(within(form).getByLabelText("Skickad"), "2026-04-02");
    await userEvent.type(within(form).getByLabelText(/^1\.1/), "abc");
    await userEvent.click(within(form).getByRole("button", { name: "Spara" }));
    expect(within(form).getByText("Skriv 1.1 i kronor.")).toBeInTheDocument();
    await userEvent.clear(within(form).getByLabelText(/^1\.1/));
    await userEvent.type(within(form).getByLabelText(/^1\.1/), "371 250");
    await userEvent.type(within(form).getByLabelText(/^2\.1/), "9 425");
    await userEvent.click(within(form).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/tax-returns/2025")).toHaveLength(1));
    expect(callsTo(fetchMock, "PUT", "/tax-returns/2025")[0][1]).toEqual({
      submittedAt: "2026-04-02",
      boxes: { employmentIncome: 37_125_000, commuteDeduction: 942_500, iskStandardIncome: null, capitalIncome: null, capitalExpenses: null },
    });
  });

  it("changes a year and deletes one only after a second click", async () => {
    const fetchMock = mockApi({ "GET /tax-returns": [ret(2024, "pdf", 31_240_000)], "PUT /tax-returns": {}, "DELETE /tax-returns": { ok: true } });
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Ändra 2024" }));
    const form = screen.getByTestId("tax-return-form");
    expect(within(form).getByLabelText("Inkomstår")).toBeDisabled();
    expect(within(form).getByLabelText(/^1\.1/)).toHaveValue("312400");
    await userEvent.click(within(form).getByRole("button", { name: "Ta bort året" }));
    expect(callsTo(fetchMock, "DELETE", "/tax-returns")).toHaveLength(0);
    await userEvent.click(within(form).getByRole("button", { name: "Ja, ta bort 2024" }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/tax-returns/2024")).toHaveLength(1));
  });
});
