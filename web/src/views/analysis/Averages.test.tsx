import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../../components/ui/tooltip";
import { PageHeader } from "../../shell/PageHeader";
import { mockApi } from "../../../test/api";
import { AnalysisView } from "./AnalysisView";

/** Twelve whole months and 55 whole weeks; the Mastercard missing two months. */
const DATA = {
  from: "2025-09-01",
  to: "2026-09-26",
  weeks: { count: 55, from: "2025-09-01", to: "2026-09-20" },
  months: { count: 12, list: ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"] },
  total: { total: 25_325_560, perWeek: 450_560, perMonth: 2_010_750 },
  bySource: [
    { accountId: 1, name: "Swedbank Privatkonto", kind: "bank", total: 3_881_200, perWeek: 69_300, perMonth: 309_900, incompleteMonths: [] },
    { accountId: 2, name: "Swedbank e-sparkonto", kind: "bank", total: 9_160_100, perWeek: 158_700, perMonth: 727_600, incompleteMonths: [] },
    { accountId: 3, name: "Swedbank Mastercard Guld", kind: "credit_card", total: 7_290_000, perWeek: 132_500, perMonth: 584_700, incompleteMonths: ["2025-09", "2026-09"] },
    { accountId: 4, name: "Bank Norwegian", kind: "credit_card", total: 4_994_260, perWeek: 90_100, perMonth: 388_600, incompleteMonths: [] },
  ],
  byCategory: [
    { key: "1", categoryId: 1, parentKey: null, name: "Mat", color: "#117733", total: 5_097_500, perWeek: 90_900, perMonth: 393_200 },
    { key: "11", categoryId: 11, parentKey: "1", name: "Livsmedel", color: "#3d8f55", total: 3_800_000, perWeek: 70_000, perMonth: 300_000 },
    { key: "12", categoryId: 12, parentKey: "1", name: "Restaurang & café", color: "#7fb38e", total: 1_297_500, perWeek: 20_900, perMonth: 93_200 },
    { key: "2", categoryId: 2, parentKey: null, name: "Boende", color: "#56B4E9", total: 5_205_100, perWeek: 87_900, perMonth: 403_000 },
    { key: "3", categoryId: 3, parentKey: null, name: "Bank & avgifter", color: "#CC3311", total: 79_300, perWeek: 1_400, perMonth: 6_600 },
  ],
  incomplete: [{ source: "mastercard", months: ["2025-09", "2026-09"] }],
};

let fetchMock: ReturnType<typeof mockApi>;
const setup = (data: object = DATA) => {
  fetchMock = mockApi({ "/categories": [], "/analysis/averages": data });
  return fetchMock;
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 26, 12));
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/analys?flik=snitt");
  setup();
});

const renderPage = () =>
  render(
    <TooltipProvider>
      <PageHeader title="Analys" />
      <AnalysisView openTransactions={() => {}} />
    </TooltipProvider>,
  );

describe("Analys › Snitt", () => {
  it("warns of months only partly imported in an orange row, with Importera › to the imports", async () => {
    renderPage();
    const note = await screen.findByRole("note", { name: "Ofullständig import" });
    expect(note).toHaveClass("bg-caution-soft");
    expect(note).toHaveTextContent("Perioden innehåller månader med ofullständig import: Mastercard sep 25, sep 26. Snitten kan bli för låga.");
    await userEvent.click(within(note).getByRole("button", { name: "Importera ›" }));
    expect(window.location.pathname).toBe("/importer");
  });

  it("has no warning when every month is whole", async () => {
    setup({ ...DATA, incomplete: [], bySource: DATA.bySource.map((s) => ({ ...s, incompleteMonths: [] })) });
    renderPage();
    await screen.findByText("Per källa");
    expect(screen.queryByRole("note", { name: "Ofullständig import" })).not.toBeInTheDocument();
  });

  it("has three key figures instead of the sentence, the Totalt row's numbers with what they are built on", async () => {
    renderPage();
    const figures = await screen.findByLabelText("Nyckeltal");
    const fig = (id: string) => figures.querySelector(`[data-figure=${id}]`)!;
    expect(fig("per-month")).toHaveTextContent(/^Snitt per månad20\s108 kr12 hela månader · sep 25 – aug 26$/);
    expect(fig("per-week")).toHaveTextContent(/^Snitt per vecka4\s506 kr55 hela veckor mån–sön · 1 sep 2025 – 20 sep 2026$/);
    expect(fig("sum")).toHaveTextContent(/^Summa i perioden253\s256 krpåbörjade veckor och månader räknas bara här$/);
    expect(screen.queryByText(/bygger på/)).not.toBeInTheDocument();
    // The same numbers as the Totalt row, rounded the same way (20 107,50 kr → 20 108).
    const totalRow = within(screen.getByRole("table", { name: "Per källa" })).getByText("Totalt").closest("tr")!;
    const cells = within(totalRow).getAllByRole("cell").map((c) => c.textContent);
    // Past the name and the empty bar column.
    expect(cells.slice(2)).toEqual([fig("sum"), fig("per-week"), fig("per-month")].map((f) => f.querySelector("p:nth-child(2)")!.textContent));
  });

  it("says so when there is no whole month or week", async () => {
    setup({ ...DATA, weeks: { count: 0, from: null, to: null }, months: { count: 0, list: [] }, total: { total: 120_000, perWeek: null, perMonth: null } });
    renderPage();
    const figures = await screen.findByLabelText("Nyckeltal");
    expect(figures.querySelector("[data-figure=per-month]")).toHaveTextContent("–ingen hel månad i perioden");
    expect(figures.querySelector("[data-figure=per-week]")).toHaveTextContent("–ingen hel vecka i perioden");
  });

  it("Per källa: each account in its wallet colour, its share of the sum as a bar, the month in bold, Totalt under a black line", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Per källa" });
    const row = (id: number) => table.querySelector(`[data-source="${id}"]`)!;
    expect(row(1).querySelector("[data-colour]")).toHaveClass("bg-wallet-private");
    expect(row(2).querySelector("[data-colour]")).toHaveClass("bg-wallet-savings");
    expect(row(3).querySelector("[data-colour]")).toHaveClass("bg-wallet-gold");
    expect(row(4).querySelector("[data-colour]")).toHaveClass("bg-wallet-norwegian");
    // Only the Mastercard is incomplete.
    expect(within(row(3) as HTMLElement).getByText("ofullständig")).toHaveClass("bg-caution-soft", "rounded-full");
    expect(within(row(4) as HTMLElement).queryByText("ofullständig")).not.toBeInTheDocument();
    // 72 900 of 253 255,60 kr: 28,8 %, in the account's colour.
    expect(within(row(3) as HTMLElement).getByRole("img")).toHaveAccessibleName("28,8 % av summan");
    expect(row(3).querySelector("[data-share]")).toHaveClass("bg-wallet-gold");
    const cells = within(row(3) as HTMLElement).getAllByRole("cell");
    expect(cells[2]).toHaveClass("text-ink-2");
    expect(cells[3]).toHaveClass("text-ink-2");
    expect(cells[4]).toHaveClass("font-semibold");
    expect(within(table).getByText("Totalt").closest("tr")).toHaveClass("border-t", "border-ink");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Källa", "Andel av summan", "Summa", "Per vecka", "Per månad"]);
  });

  it("Per källa's share bars add up to 100 % of the sum", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Per källa" });
    const shares = [...table.querySelectorAll<HTMLElement>("[data-share]")].map((b) => Number(b.dataset.share));
    expect(shares).toHaveLength(4);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    // The widths are the shares.
    expect(table.querySelector<HTMLElement>('[data-source="2"] [data-share]')!.style.width).toBe(`${(9_160_100 / 25_325_560) * 100}%`);
  });

  it("Per kategori: largest first by the average per month, or A–Ö, remembered in this browser", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Per kategori" });
    const order = () => [...table.querySelectorAll<HTMLElement>("tbody tr")].map((r) => r.dataset.category);
    // Boende 4 030 kr, Mat 3 932 kr, Bank & avgifter 66 kr.
    expect(order()).toEqual(["2", "1", "3"]);
    expect(screen.getByRole("radio", { name: "Störst först" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "A–Ö" }));
    expect(order()).toEqual(["3", "2", "1"]);
    expect(JSON.parse(localStorage.getItem("analysis.averages.order")!)).toBe("az");
    // Back to the page: still A–Ö.
    cleanup();
    renderPage();
    const again = await screen.findByRole("table", { name: "Per kategori" });
    expect([...again.querySelectorAll<HTMLElement>("tbody tr")].map((r) => r.dataset.category)).toEqual(["3", "2", "1"]);
  });

  it("Per kategori's bars: a main category against the largest, a subcategory against its main category", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Per kategori" });
    const bar = (key: string) => Number(table.querySelector<HTMLElement>(`[data-category="${key}"] [data-bar]`)!.dataset.bar);
    expect(bar("2")).toBe(1);
    expect(bar("1")).toBeCloseTo(393_200 / 403_000, 10);
    expect(bar("3")).toBeCloseTo(6_600 / 403_000, 10);
    // Folded in until Mat is clicked; then its subcategories under it, largest first, indented.
    expect(table.querySelector('[data-category="11"]')).toBeNull();
    const mat = within(table).getByRole("button", { name: "Mat" });
    expect(mat).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(mat);
    expect(mat).toHaveAttribute("aria-expanded", "true");
    expect([...table.querySelectorAll<HTMLElement>("tbody tr")].map((r) => r.dataset.category)).toEqual(["2", "1", "11", "12", "3"]);
    expect(bar("11")).toBeCloseTo(300_000 / 393_200, 10);
    expect(bar("12")).toBeCloseTo(93_200 / 393_200, 10);
    expect(table.querySelector('[data-category="11"] td')).toHaveClass("pl-12");
    // Categories without subcategories have no chevron.
    expect(within(table.querySelector<HTMLElement>('[data-category="3"]')!).queryByRole("button")).toBeNull();
    await userEvent.click(mat);
    expect(table.querySelector('[data-category="11"]')).toBeNull();
  });

  it("Per vecka is left out on a narrow card, and the note on Din del is under the cards", async () => {
    renderPage();
    for (const name of ["Per källa", "Per kategori"]) {
      const table = await screen.findByRole("table", { name });
      expect(within(table).getByRole("columnheader", { name: "Per vecka" })).toHaveClass("hidden", "@[36rem]:table-cell");
    }
    const note = screen.getByTestId("share-note");
    expect(note).toHaveTextContent("Din del: egna köp fullt, delade till hälften, Mios köp inte alls.");
    const categories = screen.getByRole("table", { name: "Per kategori" });
    expect(categories.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
