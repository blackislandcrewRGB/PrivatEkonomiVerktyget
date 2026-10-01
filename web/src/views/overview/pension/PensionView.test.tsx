import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { Toaster } from "../../../components/Toast";
import { callsTo, mockApi } from "../../../../test/api";
import { Pension } from "./PensionView";

/** Swedish formatting uses a non-breaking space in a thousand. */
const plain = (text: string) => text.replace(/\s/g, " ");

const PENSION = {
  entries: [
    {
      id: 1,
      kind: "income_pension",
      provider: "Pensionsmyndigheten",
      name: "Inkomstpension",
      amountOre: 31_500_000,
      valueDate: "2025-11-28",
      placeable: false,
      status: "active",
      monthlyPremiumOre: null,
      premiumDate: null,
      payoutFromAge: null,
      note: "Intjänad pensionsrätt.",
      funds: [],
    },
    {
      id: 2,
      kind: "premium_pension",
      provider: "Pensionsmyndigheten",
      name: "Premiepension",
      amountOre: 9_800_000,
      valueDate: "2026-09-17",
      placeable: true,
      status: "active",
      monthlyPremiumOre: null,
      premiumDate: null,
      payoutFromAge: 66,
      note: null,
      funds: [
        { id: 1, entryId: 2, fundName: "Exempelfond USA Index", amountOre: 9_800_000, unitsE4: 800_000, navOre: 122_500, valueDate: "2026-09-17", feePctE4: 1200, region: "usa" },
      ],
    },
    {
      id: 3,
      kind: "occupational",
      provider: "Exempelbolaget Pension",
      name: "Avtalspension Fond",
      amountOre: 8_250_000,
      valueDate: "2026-08-21",
      placeable: true,
      status: "active",
      monthlyPremiumOre: 90_000,
      premiumDate: "2026-07-22",
      payoutFromAge: 65,
      note: "Inbetalning pågår sedan 2023-05-15. Uttag från 65 år (2054).",
      funds: [
        { id: 2, entryId: 3, fundName: "Exempelfond Global Index", amountOre: 6_600_000, unitsE4: 1_100_000, navOre: 60_000, valueDate: "2026-08-20", feePctE4: null, region: "global" },
        { id: 3, entryId: 3, fundName: "Exempelfond Sverige Index", amountOre: 1_650_000, unitsE4: 250_000, navOre: 66_000, valueDate: "2026-08-20", feePctE4: null, region: "sweden" },
      ],
    },
  ],
  totalOre: 49_550_000,
  placeableOre: 18_050_000,
  fixedOre: 31_500_000,
  monthlyPremiumOre: 90_000,
  regions: [
    { region: "usa", amountOre: 9_800_000, share: 0.5429 },
    { region: "global", amountOre: 6_600_000, share: 0.3657 },
    { region: "sweden", amountOre: 1_650_000, share: 0.0914 },
  ],
  oldestValueDate: "2025-11-28",
  oldestMonths: 9,
  stale: [],
  notes: ["USA-fonden i premiepensionen är en avvikelse från policyns marknadsvikt."],
  inflow: {
    grossOre: 3_000_000,
    payslips: 9,
    from: "2026-01-25",
    to: "2026-09-25",
    baseAmount: { year: 2026, amountOre: 8_340_000, source: "regeringsbeslut 6/11 2025" },
    forYear: 2026,
    capOre: 62_550_000,
    capped: false,
    pensionableOre: 2_790_000,
    incomePensionOre: 446_400,
    premiumPensionOre: 69_750,
    safLoOre: 135_000,
    totalOre: 651_150,
    safLoLatest: { amountOre: 90_000, date: "2026-07-22" },
    premiumFunds: ["Exempelfond USA Index"],
  },
  statements: [
    {
      statement: { id: 1, year: 2026, pensionableIncomeOre: 29_800_000, incomePensionRightOre: 4_768_000, premiumPensionRightOre: 745_000, source: "orange_envelope" as const, enteredAt: "2027-04-02T10:00:00.000Z" },
      computed: { year: 2026, payslips: 12, grossOre: 32_000_000, pensionableIncomeOre: 29_760_000, incomePensionRightOre: 4_761_600, premiumPensionRightOre: 744_000, capped: false, baseAmount: { year: 2026, amountOre: 8_340_000, source: "regeringsbeslut 6/11 2025" } },
      diff: { pensionableIncomeOre: 40_000, incomePensionRightOre: 6_400, premiumPensionRightOre: 1_000 },
    },
    {
      statement: { id: 2, year: 2025, pensionableIncomeOre: 30_000_000, incomePensionRightOre: 4_800_000, premiumPensionRightOre: 750_000, source: "orange_envelope" as const, enteredAt: "2026-04-02T10:00:00.000Z" },
      computed: null,
      diff: null,
    },
  ],
  forecasts: {
    latest: [
      { id: 1, madeOn: "2026-03-14", retirementAge: 65, monthlyPensionOre: 1_620_000, assumptions: "avkastning 3,5 % före avgifter, löneutveckling 2 %", note: null, createdAt: "2026-03-14T10:00:00.000Z", monthsOld: 6 },
      { id: 2, madeOn: "2026-03-14", retirementAge: 67, monthlyPensionOre: 1_910_000, assumptions: "avkastning 3,5 % före avgifter, löneutveckling 2 %", note: "med SAF-LO från 65", createdAt: "2026-03-14T10:00:00.000Z", monthsOld: 6 },
    ],
    stale: null as { madeOn: string; monthsOld: number } | null,
  },
};

let fetchMock: ReturnType<typeof mockApi>;

const renderPension = (pension: unknown = PENSION) => {
  fetchMock = mockApi({
    "GET /networth/pension": pension,
    "POST /networth/pension/statements": { id: 3 },
    "POST /networth/pension/forecasts": { id: 3 },
    "PUT /networth/pension": { id: 3 },
    "POST /networth/pension": { id: 4 },
  });
  return render(
    <TooltipProvider>
      <Pension />
      <Toaster />
    </TooltipProvider>,
  );
};

/** A card by its heading. */
const card = (name: string) => screen.findByRole("region", { name });

describe("Pension", () => {
  it("shows the total split by whether the funds are chosen, with what is in each part", async () => {
    renderPension();
    const section = await card("Låst till 65+");
    expect(plain(within(section).getByTestId("pension-total").textContent ?? "")).toBe("495 500 kr");
    const text = plain(section.textContent ?? "");
    expect(text).toContain("räknas aldrig in i nettoförmögenheten eller uthålligheten");
    expect(text).toContain("Placerbart 180 500 kr · premiepension och avtalspension, du väljer fonder");
    expect(text).toContain("Ej placerbart 315 000 kr · inkomstpension");
    // The two parts are the whole.
    const parts = [...within(section).getByTestId("pension-split").querySelectorAll("[data-part]")].map((p) => p.getAttribute("data-part"));
    expect(parts).toEqual(["placeable", "fixed"]);
    expect(PENSION.placeableOre + PENSION.fixedOre).toBe(PENSION.totalOre);
  });

  it("says what the salary sets aside, part by part, and claims nothing beyond that", async () => {
    renderPension();
    const section = await card("Det avsätts till din pension");
    const text = plain(section.textContent ?? "");
    expect(plain(within(section).getByTestId("inflow-total").textContent ?? "")).toBe("~6 512 kr/mån");
    expect(text).toContain("Ingen antagen avkastning, bara det som sätts av.");
    expect(text).not.toContain("Växer med");
    // Each part with its rule and when it is credited.
    const row = (key: string) => plain(section.querySelector(`[data-inflow="${key}"]`)?.textContent ?? "");
    expect(row("income")).toBe("Inkomstpension16 % av pensionsgrundande inkomst · krediteras årsvis, i december året efter4 464 kr/mån");
    expect(row("premium")).toContain("2,5 % av pensionsgrundande inkomst · krediteras årsvis, i december året efter");
    expect(row("saflo")).toContain("4,5 % av bruttolönen · betalas in månadsvis");
    // The premium written down from the insurer stays, beside the worked-out one.
    expect(row("saflo")).toContain("senast registrerade premie 900 kr (22/7)");
    expect(row("premium")).toContain("nya avsättningar går till samma fond som i dag (Exempelfond USA Index) så länge fondvalet inte ändras");
    // Where the figures come from.
    expect(text).toContain("Räknat på snittet av 9 lönespecar (25/1–25/9): bruttolön 30 000 kr/mån, pensionsgrundande inkomst 27 900 kr/mån");
    expect(text).toContain("Taket är 7,5 inkomstbasbelopp = 625 500 kr/år, med inkomstbasbeloppet 83 400 kr för 2026 (regeringsbeslut 6/11 2025).");
  });

  it("draws the month's parts in one bar that adds up to the total", async () => {
    renderPension();
    const section = await card("Det avsätts till din pension");
    const parts = [...within(section).getByTestId("inflow-bar").querySelectorAll("[data-part]")].map((p) => p.getAttribute("data-part"));
    expect(parts).toEqual(["income", "premium", "saflo"]);
    const f = PENSION.inflow;
    expect(f.incomePensionOre + f.premiumPensionOre + f.safLoOre).toBe(f.totalOre);
  });

  it("puts each årsbesked beside the tool's figure for the year, with the income against the ceiling", async () => {
    renderPension();
    const section = await card("Årsbesked");
    const year = (y: number) => section.querySelector(`[data-year="${y}"]`) as HTMLElement;
    const y2026 = plain(year(2026).textContent ?? "");
    expect(y2026).toContain("beräknat på 12 av 12 lönespecar");
    expect(y2026).toContain("298 000 krberäknat 297 600 kr (+400 kr)");
    expect(y2026).toContain("47 680 krberäknat 47 616 kr (+64 kr)");
    // A year without payslips stands alone, no difference claimed.
    const y2025 = plain(year(2025).textContent ?? "");
    expect(y2025).toContain("inga lönespecar för 2025 att jämföra med");
    expect(y2025).not.toContain("beräknat");
    // 298 000 of the ceiling 625 500 (7,5 × 83 400).
    expect(within(year(2026)).getByRole("img", { name: /^Pensionsgrundande inkomst 298\s000\skr av taket 625\s500\skr$/ })).toBeInTheDocument();
    expect(parseFloat((year(2026).querySelector("[data-bar]") as HTMLElement).style.width)).toBeCloseTo((29_800_000 / 62_550_000) * 100, 6);
  });

  it("takes an årsbesked in by hand", async () => {
    renderPension();
    const section = await card("Årsbesked");
    await userEvent.click(within(section).getByRole("button", { name: "Lägg in årsbesked" }));
    // The envelope's year is not the income year, and the form says so.
    expect(within(section).getByText(/Årsbesked 2026 redovisar pensionsrätterna för 2024/)).toBeInTheDocument();
    await userEvent.type(within(section).getByLabelText("Inkomstår"), "2024");
    await userEvent.type(within(section).getByLabelText("Pensionsgrundande inkomst"), "280 000");
    await userEvent.type(within(section).getByLabelText("Inkomstpension"), "44 800");
    await userEvent.type(within(section).getByLabelText("Premiepension"), "7 000");
    await userEvent.click(within(section).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/networth/pension/statements")).toHaveLength(1));
    expect(callsTo(fetchMock, "POST", "/networth/pension/statements")[0][1]).toEqual({
      year: 2024,
      pensionableIncomeOre: 28_000_000,
      incomePensionRightOre: 4_480_000,
      premiumPensionRightOre: 700_000,
    });
  });

  it("shows minPension's forecast per retirement age in a green box, with its date and assumptions", async () => {
    renderPension();
    const section = await card("Prognos från minPension");
    const boxes = [...section.querySelectorAll("[data-forecast]")].map((b) => plain(b.textContent ?? ""));
    expect(boxes).toEqual([
      "Uttag vid 65 årTa bort16 200 kr/mån före skattprognos 14/3 2026 (6 månader sedan) · avkastning 3,5 % före avgifter, löneutveckling 2 %",
      "Uttag vid 67 årTa bort19 100 kr/mån före skattprognos 14/3 2026 (6 månader sedan) · avkastning 3,5 % före avgifter, löneutveckling 2 % · med SAF-LO från 65",
    ]);
    expect(plain(section.textContent ?? "")).toContain("minPensions siffror och antaganden, avskrivna. Verktyget räknar ingen egen prognos.");
  });

  it("says so when there is no forecast, with the way to put one in", async () => {
    renderPension({ ...PENSION, forecasts: { latest: [], stale: null } });
    const section = await card("Prognos från minPension");
    expect(within(section).getByTestId("forecast-empty")).toHaveTextContent("Ingen prognos inlagd.");
    await userEvent.click(within(within(section).getByTestId("forecast-empty")).getByRole("button", { name: "Lägg in prognos" }));
    expect(within(section).getByLabelText("Uttagsålder")).toBeInTheDocument();
  });

  it("takes a forecast in by hand, assumptions and all", async () => {
    renderPension();
    const section = await card("Prognos från minPension");
    await userEvent.click(within(section).getByRole("button", { name: "Lägg in prognos" }));
    const date = within(section).getByLabelText("Prognosens datum");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-09-21");
    await userEvent.type(within(section).getByLabelText("Uttagsålder"), "66");
    await userEvent.type(within(section).getByLabelText("Pension per månad"), "19 900");
    await userEvent.type(within(section).getByLabelText("Antaganden"), "minPensions standard");
    await userEvent.click(within(section).getAllByRole("button", { name: "Spara" }).at(-1)!);
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/networth/pension/forecasts")).toHaveLength(1));
    expect(callsTo(fetchMock, "POST", "/networth/pension/forecasts")[0][1]).toEqual({
      madeOn: "2026-09-21",
      retirementAge: 66,
      monthlyPensionOre: 1_990_000,
      assumptions: "minPensions standard",
      note: null,
    });
  });

  it("shows the region mix as a donut that adds up to the placeable, and the tilt in a box of its own", async () => {
    renderPension();
    const section = await card("Placerbart kapital per region");
    const text = plain(section.textContent ?? "");
    expect(text).toContain("180 500kr placerbart");
    expect(text).toContain("USA 54,3 %98 000 kr");
    expect(text).toContain("Global 36,6 %66 000 kr");
    const regions = [...within(section).getByTestId("region-donut").querySelectorAll("[data-region]")].map((c) => c.getAttribute("data-region"));
    expect(regions).toEqual(["usa", "global", "sweden"]);
    expect(PENSION.regions.reduce((s, r) => s + r.amountOre, 0)).toBe(PENSION.placeableOre);
    expect(within(section).getByRole("note")).toHaveTextContent("USA-fonden i premiepensionen är en avvikelse från policyns marknadsvikt.");
  });

  it("has no box when there is no tilt", async () => {
    renderPension({ ...PENSION, notes: [] });
    const section = await card("Placerbart kapital per region");
    expect(within(section).queryByRole("note")).toBeNull();
  });

  it("says how old the oldest figure is, and that nothing is fetched", async () => {
    renderPension();
    const section = await card("Låst till 65+");
    const text = plain(section.textContent ?? "");
    expect(text).toContain("Äldsta värdet är från 28/11 — 9 månader gammalt");
    expect(text).toContain("minpension.se");
  });

  it("lists each entry with its provider's badge, blue when the funds are chosen", async () => {
    renderPension();
    const section = await card("Värden från minpension.se");
    const rows = [...section.querySelectorAll("[data-entry]")];
    expect(rows.map((r) => within(r as HTMLElement).getByTestId("provider-badge").textContent)).toEqual(["PM", "PM", "EP"]);
    expect(within(rows[0] as HTMLElement).getByTestId("provider-badge")).toHaveClass("bg-card-inset");
    expect(within(rows[1] as HTMLElement).getByTestId("provider-badge")).toHaveClass("bg-accent-soft");
    const lf = plain(rows[2].textContent ?? "");
    expect(lf).toContain("Exempelbolaget Pension – Avtalspension Fond");
    expect(lf).toContain("placerbar · värde från 21/8 · uttag från 65 år");
    expect(lf).toContain("Exempelfond Global Index · 66 000 kr · 110 andelar à 600,00 kr");
    expect(lf).toContain("82 500 kr");
  });

  it("says so when no pension figure is written down yet, with a way to add one", async () => {
    renderPension({ ...PENSION, entries: [] });
    expect(await screen.findByText("Inga pensionsvärden inlagda än")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lägg till pensionspost" })).toBeInTheDocument();
  });

  it("writes a new value down from minpension.se, the funds given whole", async () => {
    renderPension();
    await userEvent.click(await screen.findByRole("button", { name: "Uppdatera Exempelbolaget Pension – Avtalspension Fond" }));
    const dialog = await screen.findByRole("dialog");
    expect(plain(dialog.textContent ?? "")).toContain("Förra värdet: 82 500 kr den 21/8 2026.");
    const date = within(dialog).getByLabelText("Värdedatum");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-09-21");
    // Last time's units stand as a hint only: they are typed again.
    expect(within(dialog).getByLabelText("Fond 1, andelar")).toHaveValue("");
    expect(within(dialog).getByLabelText("Fond 1, andelar")).toHaveAttribute("placeholder", "110");
    // One fund by units × price, the other by units and value.
    await userEvent.type(within(dialog).getByLabelText("Fond 1, andelar"), "160");
    await userEvent.type(within(dialog).getByLabelText("Fond 1, kurs"), "600");
    await userEvent.type(within(dialog).getByLabelText("Fond 2, andelar"), "33");
    await userEvent.type(within(dialog).getByLabelText("Fond 2, värde"), "23 000");
    // The value left empty is the funds' sum.
    expect(within(dialog).getByText("Fondernas summa används.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/networth/pension/3")).toHaveLength(1));
    expect(callsTo(fetchMock, "PUT", "/networth/pension/3")[0][1]).toEqual({
      provider: "Exempelbolaget Pension",
      name: "Avtalspension Fond",
      amountOre: 11_900_000,
      valueDate: "2026-09-21",
      status: "active",
      monthlyPremiumOre: 90_000,
      premiumDate: "2026-07-22",
      note: "Inbetalning pågår sedan 2023-05-15. Uttag från 65 år (2054).",
      placeable: true,
      payoutFromAge: 65,
      funds: [
        { fundName: "Exempelfond Global Index", amountOre: 9_600_000, unitsE4: 1_600_000, navOre: 60_000, valueDate: "2026-09-21", feePctE4: null, region: "global" },
        { fundName: "Exempelfond Sverige Index", amountOre: 2_300_000, unitsE4: 330_000, navOre: 69_697, valueDate: "2026-09-21", feePctE4: null, region: "sweden" },
      ],
    });
  });

  it("adds a pension that isn't there yet, and asks what kind it is", async () => {
    renderPension();
    await userEvent.click(await screen.findByRole("button", { name: "Lägg till pensionspost" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Slag"), "private");
    await userEvent.type(within(dialog).getByLabelText("Förvaltare"), "Avanza");
    await userEvent.type(within(dialog).getByLabelText("Namn"), "IPS");
    await userEvent.type(within(dialog).getByLabelText("Värde"), "12 500");
    const date = within(dialog).getByLabelText("Värdedatum");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-09-20");
    await userEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/networth/pension")).toHaveLength(1));
    expect(callsTo(fetchMock, "POST", "/networth/pension")[0][1]).toMatchObject({ kind: "private", provider: "Avanza", name: "IPS", amountOre: 1_250_000, valueDate: "2026-09-20", funds: [] });
  });

  it("won't save a value that isn't a number", async () => {
    renderPension();
    await userEvent.click(await screen.findByRole("button", { name: "Uppdatera Pensionsmyndigheten – Inkomstpension" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Värde"), "mycket");
    await userEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
    expect(await within(dialog).findByText("Fyll i värdet i kronor.")).toBeInTheDocument();
    expect(callsTo(fetchMock, "PUT", "/networth/pension")).toHaveLength(0);
  });
});

