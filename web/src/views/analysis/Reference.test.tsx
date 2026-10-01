import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceComparison, ReferenceComparisonResponse, ReferenceItem } from "../../api";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { clearPersistentState } from "../../usePersistentState";
import { Reference } from "./Reference";

/**
 * Jämfört med Konsumentverket. What the view must do: say what each figure
 * is made of, stay neutral about a difference, and say out loud what is not
 * in the comparison.
 */

const diff = (actual: number | null, ref: number) => ({ ore: actual === null ? null : actual - ref, pct: actual === null || ref === 0 ? null : Math.round(((actual - ref) / ref) * 1000) / 10 });
const item = (target: string, name: string, referenceOre: number, actual12Ore: number | null, actual3Ore: number | null, sources: string[], extra: Partial<ReferenceItem> = {}): ReferenceItem => ({
  target,
  name,
  scope: "individual",
  referenceOre,
  excluded: false,
  basis: "Jag 25–50 år",
  kpi: null,
  reference12Ore: referenceOre,
  reference3Ore: referenceOre,
  kpiAdjustment: null,
  actual12Ore,
  actual3Ore,
  diff12: diff(actual12Ore, referenceOre),
  diff3: diff(actual3Ore, referenceOre),
  sources,
  ...extra,
});

const COMPARISON: ReferenceComparison = {
  share: "mine",
  year: 2026,
  fallback: null,
  source: { title: "Konsumentverket: Hushållskostnader 2026", url: "https://example.org/kov.pdf" },
  persons: [
    { name: "Jag", ageGroup: "25–50 år", food: "Livsmedel, all mat lagas hemma", age: null },
    { name: "Mio", ageGroup: "25–50 år", food: "Livsmedel, all mat lagas hemma", age: null },
  ],
  excluded: [
    { key: "water_sewage", name: "Vatten och avlopp" },
    { key: "household_electricity", name: "Hushållsel" },
  ],
  months12: { from: "2025-09", to: "2026-08", counted: 12 },
  months3: { from: "2026-06", to: "2026-08", counted: 3 },
  items: [
    item("food", "Livsmedel", 273_000, 279_900, 287_900, ["Mat › Livsmedel"], { basis: "Jag all mat lagas hemma" }),
    item("clothing", "Kläder och skor", 82_000, 10_300, 36_200, ["Prylar & hem › Kläder"]),
    item("hygiene", "Personlig hygien", 59_000, 0, 0, []),
    item("home_equipment", "Hemutrustning", 51_500, 330_300, 298_300, ["Prylar & hem", "Prylar & hem › Elektronik"], { scope: "household", basis: "hushåll med 2 personer, din halva" }),
    item("water_sewage", "Vatten och avlopp", 0, 0, 0, [], { scope: "household", excluded: true }),
  ],
  kpi: { on: false, base: { kind: "year", year: 2026 }, adjusted: 0, unadjusted: [], reason: null },
  groceries: { targets: ["food", "consumables", "hygiene"], referenceOre: 347_000, reference12Ore: 347_000, reference3Ore: 347_000, actual12Ore: 279_900, actual3Ore: 287_900, diff12: diff(279_900, 347_000), diff3: diff(287_900, 347_000) },
  total: { referenceOre: 658_000, reference12Ore: 658_000, reference3Ore: 658_000, actual12Ore: 850_000, actual3Ore: 840_000, diff12: diff(850_000, 658_000), diff3: diff(840_000, 658_000) },
  notIncluded: { actual12Ore: 1_161_300, actual3Ore: 1_100_000 },
  unmapped: [],
  series: [
    { month: "2026-07", rolling12: { total: 830_000 }, rolling3: { total: 800_000 }, reference12: 658_000 },
    { month: "2026-08", rolling12: { total: 850_000 }, rolling3: { total: 840_000 }, reference12: 658_000 },
  ],
};

const READY = (c: ReferenceComparison = COMPARISON, due: { year: number; latest: number } | null = null): ReferenceComparisonResponse => ({
  status: "ready",
  through: "2026-08",
  share: c.share,
  comparison: c,
  due,
});
const plain = (t: string | null) => (t ?? "").replace(/\s/g, " ");

let fetchMock: ReturnType<typeof mockApi>;
const renderIt = (response: unknown = READY(), share: "mine" | "household" = "mine") => {
  fetchMock = mockApi({
    "GET /reference-budget/comparison": response,
    "GET /reference-budget/mapping": {
      categories: [
        { categoryId: 2, path: "Mat › Livsmedel", parentId: 1, target: "food", kind: "item" },
        { categoryId: 9, path: "Husdjur", parentId: null, target: null, kind: "unmapped" },
        { categoryId: 47, path: "Inkomst › Lön", parentId: 46, target: null, kind: "not_spending" },
      ],
      expenses: [{ recurringExpenseId: 16, name: "Hemförsäkring", target: "home_insurance" }],
      targets: [
        { key: "food", name: "Livsmedel (varje persons matvariant)" },
        { key: "leisure", name: "Fritid och lek" },
        { key: "home_insurance", name: "Hemförsäkring" },
        { key: "not_included", name: "Ingår ej i referensen" },
      ],
    },
    "PUT /reference-budget/mapping/categories": (_u: string) => ({ categories: [], expenses: [], targets: [] }),
  });
  return render(
    <TooltipProvider>
      <Reference from="2025-09-01" to="2026-09-21" period={{ preset: "12m", from: "", to: "" }} share={share} showPrivate={false} openTransactions={() => {}} />
      <Toaster />
    </TooltipProvider>,
  );
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-21T10:00:00") });
  // The order of the items is remembered in this browser.
  localStorage.removeItem("reference.order");
});
afterEach(() => {
  vi.useRealTimers();
  clearPersistentState();
});

describe("Jämfört med Konsumentverket", () => {
  it("asks for the last whole month, and your part", async () => {
    renderIt();
    await screen.findByText("Per post");
    expect(callsTo(fetchMock, "GET", "/reference-budget/comparison")[0][0]).toBe("/api/reference-budget/comparison?share=mine&through=2026-08");
    expect(screen.getByRole("button", { name: "Månaden efter" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Månaden före" }));
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/reference-budget/comparison").at(-1)![0]).toContain("through=2026-07"));
  });

  it("shows each item's reference, both averages and the difference, with what it is made of", async () => {
    renderIt();
    const table = (await screen.findByRole("table", { name: "Per post" })) as HTMLElement;
    const clothing = within(table).getByText("Kläder och skor").closest("tr")!;
    const text = plain(clothing.textContent);
    expect(text).toContain("Prylar & hem › Kläder · referens: Jag 25–50 år");
    expect(text).toContain("820 kr");
    expect(text).toContain("103 kr");
    expect(text).toContain("−87,4 %");
    // No category counted here: the view says why the actual is 0, and offers to link one.
    const hygiene = within(table).getByText("Personlig hygien").closest("tr")!;
    expect(plain(hygiene.textContent)).toContain("ingen kategori kopplad, faktiskt = 0");
    expect(within(hygiene).getByRole("button", { name: "Koppla kategori ›" })).toBeInTheDocument();
    expect(within(clothing).queryByRole("button", { name: "Koppla kategori ›" })).toBeNull();
    // An excluded item is not a row; it is named in the notes.
    expect(within(table).queryByText("Vatten och avlopp")).toBeNull();
    expect(screen.getByTestId("reference-notes")).toHaveTextContent(/Räknas inte för er: vatten och avlopp, hushållsel ·/);
  });

  it("colours a difference: orange over the reference, green under", async () => {
    renderIt();
    const table = (await screen.findByRole("table", { name: "Per post" })) as HTMLElement;
    const home = within(table).getByText("Hemutrustning").closest("tr")!;
    expect(home.querySelector("[data-tone]")).toHaveAttribute("data-tone", "over");
    expect(home.querySelector("span.inline-block[data-tone]")).toHaveClass("bg-caution-soft", "text-caution-text");
    const clothing = within(table).getByText("Kläder och skor").closest("tr")!;
    expect(clothing.querySelector("span.inline-block[data-tone]")).toHaveClass("bg-positive-soft", "text-positive-text");
    // The total's difference in kronor and per cent, as coloured text.
    expect(plain(within(table).getByText("Totalt, de poster som gäller er").closest("tr")!.textContent)).toMatch(/[+−]\d/);
  });

  it("puts food, consumables and hygiene together, and a total", async () => {
    renderIt();
    const table = (await screen.findByRole("table", { name: "Per post" })) as HTMLElement;
    expect(plain(within(table).getByText("Mat, förbrukningsvaror och hygien").closest("tr")!.textContent)).toContain("3 470 kr");
    expect(plain(within(table).getByText("Totalt, de poster som gäller er").closest("tr")!.textContent)).toContain("6 580 kr");
  });

  it("says what is outside the comparison, and that the reference is a national average", async () => {
    renderIt();
    // In large type, and again as the bar's "utanför".
    expect((await screen.findAllByText(/11 613 kr/)).length).toBe(2);
    // What the reference leaves out stands by the figure; that it is a national average under the cards.
    expect(screen.getByText(/Referensen täcker ungefär 40 %/)).toHaveTextContent("restaurang och café");
    expect(screen.getByText(/Siffrorna är riksgenomsnitt/)).toBeInTheDocument();
    expect(screen.getByText(/Din del: egna köp fullt/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Konsumentverket: Hushållskostnader 2026" })).toHaveAttribute("href", "https://example.org/kov.pdf");
  });

  it("warns in Hela hushållet that what Mio buys from her own accounts is missing", async () => {
    renderIt(READY({ ...COMPARISON, share: "household" }), "household");
    expect(await screen.findByText(/Det hon köper från sina egna konton finns inte i verktyget/)).toBeInTheDocument();
  });

  it("says which year it uses when this year's is not in yet", async () => {
    renderIt(READY({ ...COMPARISON, fallback: { wanted: 2027, direction: "earlier" } }));
    expect(await screen.findByText(/2027 är inte inlagt än, så 2026 används/)).toBeInTheDocument();
  });

  it("names the categories with no mapping, and lets a category be moved", async () => {
    renderIt(READY({ ...COMPARISON, unmapped: [{ path: "Husdjur", actual12Ore: 36_000 }, { path: "Utan kategori", actual12Ore: 10_000 }] }));
    expect(await screen.findByText(/Husdjur \(360 kr\)/)).toBeInTheDocument();
    // Uncategorised purchases can't be mapped: they need a category, and the view says where.
    expect(screen.getByText(/Ge dem en kategori under Att granska/)).toBeInTheDocument();
    expect(screen.queryByText(/Utan kategori \(100 kr\)/)).toBeNull();
    await userEvent.click(screen.getByText("Vilka kategorier räknas var"));
    const select = await screen.findByLabelText("Husdjur, post");
    // Income is not spending and is not offered.
    expect(screen.queryByLabelText("Inkomst › Lön, post")).toBeNull();
    expect(screen.getByText(/Hemförsäkring → Hemförsäkring/)).toBeInTheDocument();
    await userEvent.selectOptions(select, "leisure");
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/reference-budget/mapping/categories/9")).toEqual([["/api/reference-budget/mapping/categories/9", { target: "leisure" }]]));
  });

  it("says how to add next year's figures once they are due, and nothing before", async () => {
    renderIt(READY(COMPARISON, { year: 2027, latest: 2026 }));
    const box = await screen.findByRole("region", { name: "Referensvärden 2027" });
    expect(within(box).getByRole("heading")).toHaveTextContent("Nya referensvärden från Konsumentverket – lägg in 2027");
    expect(plain(box.textContent)).toContain("Kopiera server/reference-budget/2026.json till 2027.json");
    expect(plain(box.textContent)).toContain("Referensbudget 2027: inläst");
  });

  it("shows no such box when this year's figures are in", async () => {
    renderIt();
    await screen.findByText("Per post");
    expect(screen.queryByRole("region", { name: /Referensvärden/ })).toBeNull();
  });

  it("asks for the KPI-adjusted reference when ticked, and remembers it", async () => {
    renderIt();
    await screen.findByText("Per post");
    await userEvent.click(screen.getByRole("switch", { name: "KPI-justerad referens" }));
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/reference-budget/comparison").at(-1)![0]).toContain("&kpi=1"));
    // Kept for the session, like the other choices in Analys.
    expect(sessionStorage.getItem("reference.kpi")).toBe("true");
  });

  it("shows the adjusted reference, what moved it, and what could not be moved", async () => {
    const clothing = item("clothing", "Kläder och skor", 82_000, 10_300, 36_200, ["Prylar & hem › Kläder"], {
      kpi: "03",
      reference12Ore: 81_500,
      reference3Ore: 82_800,
      kpiAdjustment: { code: "03", name: "Kläder och skodon", changePct: 2, month: "2026-08", base: { from: "2025-09", to: "2026-08" } },
      diff12: diff(10_300, 81_500),
      diff3: diff(36_200, 82_800),
    });
    const adjusted = {
      ...COMPARISON,
      items: COMPARISON.items.map((i) => (i.target === "clothing" ? clothing : i)),
      kpi: { on: true, base: { kind: "year", year: 2026 } as const, adjusted: 1, unadjusted: ["Personlig hygien"], reason: null },
    };
    renderIt(READY(adjusted));
    const table = (await screen.findByRole("table", { name: "Per post" })) as HTMLElement;
    expect(within(table).getByRole("columnheader", { name: "Referens, KPI" })).toBeInTheDocument();
    const row = plain(within(table).getByText("Kläder och skor").closest("tr")!.textContent);
    expect(row).toContain("815 kr");
    // The three months' own reference, which their difference is against.
    expect(row).toContain("mot 828 kr");
    expect(row).toContain("KPI kläder och skodon +2,0 % mot snittet sep. 25–aug. 26");
    expect(screen.getByText(/Inte justerade \(KPI saknas\): Personlig hygien\./)).toBeInTheDocument();
    expect(screen.getByText(/mot gruppens snitt för 2026/)).toHaveTextContent("håller säsongerna utanför");
  });

  it("says so when there is not enough KPI to adjust with", async () => {
    const reason = "KPI från SCB saknas eller täcker färre än tolv månader, så referensen visas som den är publicerad.";
    renderIt(READY({ ...COMPARISON, kpi: { on: true, base: { kind: "year", year: 2026 }, adjusted: 0, unadjusted: [], reason } }));
    expect(await screen.findByTestId("reference-notes")).toHaveTextContent(reason);
  });

  it("says why there is nothing to compare, with the way to fix it", async () => {
    renderIt({ status: "no_household", message: "Hushållet är inte inställt: ange personerna under Inställningar › Referensbudget.", through: "2026-08", share: "mine" });
    expect(await screen.findByText("Jämförelsen går inte att visa än")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ställ in hushållet" })).toBeInTheDocument();
  });
});

describe("Konsumentverket, Design v2", () => {
  it("the hero is the total row's difference, orange when over", async () => {
    renderIt();
    const hero = await screen.findByTestId("reference-hero");
    const total = screen.getByText("Totalt, de poster som gäller er").closest("tr")!;
    // +29,2 % either way.
    expect(hero).toHaveTextContent("+29,2 %");
    expect(plain(total.textContent)).toContain("+29,2 %");
    expect(hero).toHaveAttribute("data-tone", "over");
    expect(hero).toHaveClass("text-caution-text");
    expect(document.querySelector('[data-box="actual12"]')).toHaveClass("bg-caution-soft");
  });

  it("green when under the reference", async () => {
    renderIt(READY({ ...COMPARISON, total: { ...COMPARISON.total, actual12Ore: 600_000, diff12: diff(600_000, 658_000), actual3Ore: 600_000, diff3: diff(600_000, 658_000) } }));
    const hero = await screen.findByTestId("reference-hero");
    expect(hero).toHaveAttribute("data-tone", "under");
    expect(hero).toHaveClass("text-positive-text");
    expect(screen.getByText(/under referensen, snitt 12 månader/)).toBeInTheDocument();
    expect(document.querySelector('[data-box="actual3"]')).toHaveClass("bg-positive-soft");
  });

  it("each row's bar: the average in its tone on the row's own scale, the mark at the reference", async () => {
    renderIt();
    const table = await screen.findByRole("table", { name: "Per post" });
    const bar = (target: string) => table.querySelector<HTMLElement>(`[data-item="${target}"]`)!;
    // Hemutrustning 3 303 kr against 515 kr: scale 3 303 × 1,15.
    const home = bar("home_equipment");
    expect(home.querySelector("[data-fill]")).toHaveAttribute("data-tone", "over");
    expect(home.querySelector("[data-fill]")).toHaveClass("bg-caution");
    expect(Number(home.querySelector<HTMLElement>("[data-fill]")!.dataset.fill)).toBeCloseTo(1 / 1.15, 10);
    expect(Number(home.querySelector<HTMLElement>("[data-mark]")!.dataset.mark)).toBeCloseTo(51_500 / (330_300 * 1.15), 10);
    // Kläder 103 kr against 820 kr: under, green, the mark at 1/1,15.
    const clothing = bar("clothing");
    expect(clothing.querySelector("[data-fill]")).toHaveClass("bg-positive");
    expect(Number(clothing.querySelector<HTMLElement>("[data-mark]")!.dataset.mark)).toBeCloseTo(1 / 1.15, 10);
  });

  it("the largest difference in kronor first, or Konsumentverket's order, remembered", async () => {
    renderIt();
    const table = await screen.findByRole("table", { name: "Per post" });
    const order = () => [...table.querySelectorAll<HTMLElement>("tbody tr[data-item]")].map((r) => r.dataset.item).filter((k) => k !== "groceries" && k !== "total");
    // +2 788, −717, −590, +69 kr.
    expect(order()).toEqual(["home_equipment", "clothing", "hygiene", "food"]);
    await userEvent.click(screen.getByRole("radio", { name: "Konsumentverkets ordning" }));
    expect(order()).toEqual(["food", "clothing", "hygiene", "home_equipment"]);
    expect(JSON.parse(localStorage.getItem("reference.order")!)).toBe("reference");
  });

  it("Koppla kategori only on an item with no category, and it opens the mapping for it", async () => {
    renderIt();
    const table = await screen.findByRole("table", { name: "Per post" });
    expect([...table.querySelectorAll<HTMLElement>("[data-map]")].map((b) => b.dataset.map)).toEqual(["hygiene"]);
    await userEvent.click(within(table).getByRole("button", { name: "Koppla kategori ›" }));
    expect(document.getElementById("reference-mapping")).toHaveAttribute("open");
    expect(await screen.findByTestId("mapping-focus")).toHaveTextContent("Koppla en kategori till Personlig hygien");
  });

  it("the coverage bar is what is compared of what is compared and what is outside", async () => {
    renderIt();
    const bar = await screen.findByRole("img", { name: /jämförs/ });
    expect(Number(bar.dataset.coverage)).toBeCloseTo(850_000 / (850_000 + 1_161_300), 10);
  });
});

