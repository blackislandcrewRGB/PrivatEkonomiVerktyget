import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IskOverview } from "../../../api";
import { callsTo, mockApi } from "../../../../test/api";
import { IskTaxBox } from "./IskTax";
import { IskRules } from "../../settings/sections/IskRules";

const OVERVIEW: IskOverview = {
  current: {
    year: 2026,
    rule: { year: 2026, rateBp: 355, allowanceOre: 30_000_000, source: "statslåneräntan 30/11 2025 (2,55 %) + 1" },
    quarters: [
      { date: "2026-01-01", valueOre: 38_000_000, source: "entered" },
      { date: "2026-04-01", valueOre: 40_000_000, source: "first" },
      { date: "2026-07-01", valueOre: 42_000_000, source: "computed" },
      { date: "2026-10-01", valueOre: 44_000_000, source: "today" },
    ],
    deposits: { ore: 4_000_000, count: 2, through: "2026-09-20" },
    capitalBaseOre: 42_000_000,
    taxableBaseOre: 12_000_000,
    standardIncomeOre: 426_000,
    taxOre: 127_800,
    estimated: true,
    missing: ["2026-04-01"],
  },
  today: { valueOre: 44_000_000, allowanceOre: 30_000_000, share: 1.47 },
  declared: [{ year: 2024, standardIncomeOre: 480_000, rateBp: 362, allowanceOre: 0, capitalBaseOre: 13_259_669, taxOre: 144_000 }],
  compared: null,
};

describe("Balansräkningen › ISK-skatt", () => {
  it("this year's tax as an estimate, what is missing, the arithmetic in a popover and the declared base", async () => {
    mockApi({ "GET /tax/isk": OVERVIEW });
    render(<IskTaxBox />);
    const box = await screen.findByTestId("isk-tax");
    expect(within(box).getByText("uppskattning")).toBeInTheDocument();
    expect(box.querySelector('[data-figure="isk-tax"]')).toHaveTextContent(/^~1\s278\skr$/);
    expect(box).toHaveTextContent(/underlag 420\s000\skr · fribelopp 300\s000\skr · 3,55 % × 30 % · dras via slutskatten 2027/);
    expect(box).toHaveTextContent("ISK-värdet 1/4 saknas: skriv av det från Avanza");
    expect(screen.getByTestId("isk-declared")).toHaveTextContent(/2024 enligt deklarationen: underlag 132\s597\skr \(4\s800\skr på rad 7.1 ÷ 3,62 %\) · skatt 1\s440\skr/);
    await userEvent.click(within(box).getByRole("button", { name: "Visa uträkning" }));
    const pop = await screen.findByLabelText("Uträkning av ISK-skatten 2026");
    expect(pop).toHaveTextContent(/Värde 1\/1380\s000\skrinmatat/);
    expect(pop).toHaveTextContent(/Värde 1\/4400\s000\skrsaknas – första kända värdet/);
    expect(pop).toHaveTextContent(/Insättningar t.o.m. 20\/940\s000\skr2 st/);
    expect(pop).toHaveTextContent(/= schablonintäkt att beskatta4\s260\skr/);
    expect(pop).toHaveTextContent(/× 30 % = skatt1\s278\skr/);
  });

  it("says the rate is missing when the base is over the allowance and the year's rate isn't in", async () => {
    mockApi({ "GET /tax/isk": { ...OVERVIEW, current: { ...OVERVIEW.current, rule: { ...OVERVIEW.current.rule, rateBp: null }, standardIncomeOre: null, taxOre: null } } });
    render(<IskTaxBox />);
    expect((await screen.findByTestId("isk-tax")).querySelector('[data-figure="isk-tax"]')).toHaveTextContent("räntan saknas");
  });
});

describe("Inställningar › Deklaration › ISK", () => {
  it("fills in a year's rate with its source, and the quarter values in kronor", async () => {
    const settings = {
      rules: [
        { year: 2025, rateBp: 296, allowanceOre: 15_000_000, source: "statslåneräntan 30/11 2024 (1,96 %) + 1" },
        { year: 2026, rateBp: null, allowanceOre: 30_000_000, source: "fribelopp 300 000 kr" },
      ],
      quarters: [{ date: "2026-01-01", valueOre: 38_000_000 }],
    };
    const fetchMock = mockApi({ "GET /tax/isk/settings": settings, "PUT /tax/isk": settings });
    render(<IskRules year={2026} />);
    const row = (await screen.findByText("räntan saknas")).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Ändra ISK-regeln för 2026" }));
    const form = screen.getByTestId("isk-rule-form");
    await userEvent.type(within(form).getByLabelText("Schablonränta"), "3,55");
    await userEvent.clear(within(form).getByLabelText("Källa"));
    await userEvent.type(within(form).getByLabelText("Källa"), "statslåneräntan 30/11 2025 (2,55 %) + 1");
    await userEvent.click(within(form).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/tax/isk/rules")).toHaveLength(1));
    expect(callsTo(fetchMock, "PUT", "/tax/isk/rules")[0][1]).toEqual({ year: 2026, rateBp: 355, allowanceOre: 30_000_000, source: "statslåneräntan 30/11 2025 (2,55 %) + 1" });

    expect(screen.getByLabelText("ISK-värde 1/1 2026")).toHaveValue("380000");
    await userEvent.type(screen.getByLabelText("ISK-värde 1/4 2026"), "400 000");
    await userEvent.click(screen.getByRole("button", { name: "Spara värdena" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/tax/isk/quarters")).toHaveLength(1));
    expect(callsTo(fetchMock, "PUT", "/tax/isk/quarters")[0]).toEqual(["/api/tax/isk/quarters/2026-04-01", { valueOre: 40_000_000 }]);
  });
});
