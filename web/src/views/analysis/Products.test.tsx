import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GrocerySummary, Product, ProductGroup, ProductHistory } from "../../api";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { Products } from "./Products";

// jsdom has no layout: the month chart gets a fixed size so its bars are drawn.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 600, height: 220 }),
}));

const GROUPS: ProductGroup[] = [
  { id: 1, name: "Mejeri & ägg", color: "#56B4E9", position: 0 },
  { id: 9, name: "Dryck", color: "#44AA99", position: 8 },
];

const product = (p: Partial<Product> & { id: number; name: string }): Product => ({
  groupId: null,
  groupName: null,
  groupColor: null,
  aliases: [p.name.toLocaleLowerCase("sv")],
  times: 1,
  totalOre: 1000,
  lastPurchase: "2026-09-15",
  createdAt: "2026-09-20T09:00:00Z",
  updatedAt: "2026-09-20T09:00:00Z",
  ...p,
});

const ROWS: Product[] = [
  product({ id: 3, name: "Sneb Superior", times: 8, totalOre: 14480 }),
  product({ id: 1, name: "Havredryck Barista", groupId: 9, groupName: "Dryck", groupColor: "#44AA99", times: 11, totalOre: 29659 }),
  product({ id: 2, name: "HAVREDRYCK NATURELL", groupId: 9, groupName: "Dryck", groupColor: "#44AA99", times: 2, totalOre: 2980 }),
];

const SUMMARY: GrocerySummary = {
  coverage: { purchases: 84, withReceipt: 52, spentOre: 1909947, receiptOre: 1442100 },
  groups: [
    { id: 1, name: "Mejeri & ägg", color: "#56B4E9", totalOre: 320300, times: 109 },
    { id: 9, name: "Dryck", color: "#44AA99", totalOre: 168000, times: 59 },
    { id: null, name: "Utan hylla", color: null, totalOre: 84000, times: 39 },
  ],
  months: [
    { month: "2026-06", totalOre: 0, receipts: 0, groups: {} },
    { month: "2026-07", totalOre: 0, receipts: 0, groups: {} },
    { month: "2026-08", totalOre: 400000, receipts: 30, groups: { "1": 250000, "9": 150000 } },
    { month: "2026-09", totalOre: 172300, receipts: 22, groups: { "1": 70300, "9": 18000, none: 84000 } },
  ],
  extras: { discountOre: -71500, depositOre: 7900, bagOre: 8300, bags: null },
  stores: [{ store: "lidl", receipts: 38, totalOre: 1114900 }],
};

const HISTORY: ProductHistory = {
  rows: [
    { receiptId: 1, date: "2026-09-01", store: "lidl", name: "A-fil 3%", quantityMilli: null, unit: null, unitPriceOre: null, totalOre: 1415 },
    { receiptId: 2, date: "2026-09-11", store: "ica", name: "A-fil 3%", quantityMilli: 2000, unit: "st", unitPriceOre: 1415, totalOre: 2830 },
  ],
  everyDays: 10,
  perMonthOre: 4245,
  cheapestStore: "lidl",
};

let rows: Product[];
let fetchMock: ReturnType<typeof mockApi>;

beforeEach(() => {
  rows = ROWS;
  window.history.replaceState(null, "", "/analys?flik=matvaror");
  fetchMock = mockApi({
    "GET /products/groups": () => GROUPS,
    "GET /products/summary": () => SUMMARY,
    "GET /products/1/history": () => HISTORY,
    "GET /products": () => rows,
    "PUT /products": { ok: true },
    "POST /products/merge": { ok: true },
    "POST /products/detach": { ok: true },
    "POST /products/suggest": { placed: 0 },
  });
});

const renderTab = () =>
  render(
    <TooltipProvider>
      <Products from="2026-06-01" to="2026-09-20" period={{ preset: "custom", from: "2026-06-01", to: "2026-09-20" }} share="mine" showPrivate={false} openTransactions={vi.fn()} />
      <Toaster />
    </TooltipProvider>,
  );

describe("Matvaror", () => {
  it("lists the groceries for the period, the ones without a shelf first", async () => {
    renderTab();
    expect(await screen.findByText("Sneb Superior")).toBeInTheDocument();
    // The period from the tab goes to the server; the list isn't all time.
    expect(callsTo(fetchMock, "GET", "/products")[0][0]).toContain("from=2026-06-01&to=2026-09-20");
    const names = screen.getAllByRole("button", { name: /Sneb|Havredryck/ }).map((b) => b.textContent);
    expect(names[0]).toBe("Sneb Superior");
    expect(screen.getByText(/En vara väntar på en hylla/)).toBeInTheDocument();
  });

  it("finds a grocery by a name a shop printed, not only by its own", async () => {
    renderTab();
    await screen.findByText("Sneb Superior");
    await userEvent.type(screen.getByLabelText("Sök vara"), "naturell");
    expect(screen.getByTestId("products-count")).toHaveTextContent("1 av 1 visas");
    expect(screen.queryByText("Sneb Superior")).not.toBeInTheDocument();
  });

  it("moves a grocery to a shelf as soon as one is picked", async () => {
    renderTab();
    await screen.findByText("Sneb Superior");
    await userEvent.selectOptions(screen.getByLabelText("Hylla för Sneb Superior"), "1");
    const [[url, body]] = callsTo(fetchMock, "PUT", "/products/3");
    expect(url).toBe("/api/products/3");
    expect(body).toEqual({ groupId: 1 });
  });

  it("puts two names together, asking which one the grocery is called", async () => {
    renderTab();
    await screen.findByText("Sneb Superior");
    await userEvent.click(screen.getByLabelText("Välj Havredryck Barista"));
    await userEvent.click(screen.getByLabelText("Välj HAVREDRYCK NATURELL"));
    await userEvent.click(screen.getByRole("button", { name: "Slå ihop 2 varor" }));

    const dialog = within(await screen.findByRole("dialog"));
    // The first one chosen is suggested, and both are shown with what they
    // cost (formatKr writes a narrow no-break space before 'kr').
    expect(dialog.getByText(/11 ggr/)).toBeInTheDocument();
    expect(dialog.getByText(/297\skr/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Slå ihop" }));
    const [[, body]] = callsTo(fetchMock, "POST", "/products/merge");
    expect(body).toEqual({ keepId: 1, mergeIds: [2] });
    expect(await screen.findByText("Varorna är en nu.")).toBeInTheDocument();
  });

  it("won't offer to merge a single grocery", async () => {
    renderTab();
    await screen.findByText("Sneb Superior");
    await userEvent.click(screen.getByLabelText("Välj Sneb Superior"));
    expect(screen.getByRole("button", { name: "Slå ihop 1 vara" })).toBeDisabled();
  });

  it("opens a grocery to rename it and to let one of its names leave", async () => {
    rows = [product({ id: 1, name: "Havredryck", groupId: 9, groupName: "Dryck", aliases: ["havredryck barista", "havredryck naturell"] })];
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Havredryck" }));
    const dialog = within(await screen.findByRole("dialog"));

    const name = dialog.getByLabelText("Varans namn");
    await userEvent.clear(name);
    await userEvent.type(name, "Havredryck Barista");
    await userEvent.tab();
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/products/1")[0][1]).toEqual({ name: "Havredryck Barista" }));

    await userEvent.click(dialog.getByLabelText("Lossa havredryck naturell"));
    expect(callsTo(fetchMock, "POST", "/products/detach")[0][1]).toEqual({ nameKey: "havredryck naturell" });
  });

  it("says so plainly when the rules can't place the ones that are left", async () => {
    renderTab();
    await screen.findByText("Sneb Superior");
    await userEvent.click(screen.getByRole("button", { name: /Föreslå hyllor/ }));
    expect(await screen.findByText("Reglerna känner inte igen någon av dem.")).toBeInTheDocument();
  });

  it("says how much of the food the numbers are built on, before the numbers", async () => {
    renderTab();
    expect(await screen.findByText(/52 av 84 matköp/)).toBeInTheDocument();
    expect(screen.getByText(/14 421/)).toBeInTheDocument();
    expect(screen.getByText(/19 099/)).toBeInTheDocument();
    // Each shelf with its share of what the receipts came to (3 203 of 5 723).
    expect(screen.getByText("56 %")).toBeInTheDocument();
    // Discounts are money back, and are written as such.
    expect(screen.getByText(/\+715\skr/)).toBeInTheDocument();
  });

  it("shows how often a grocery is bought and what it has cost each time", async () => {
    rows = [product({ id: 1, name: "A-fil 3%", groupId: 1, groupName: "Mejeri & ägg", times: 2, totalOre: 4245 })];
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "A-fil 3%" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText(/var 10:e dag/)).toBeInTheDocument();
    expect(dialog.getByText(/42\skr i månaden/)).toBeInTheDocument();
    expect(dialog.getByText(/billigast på Lidl/)).toBeInTheDocument();
    // The purchases themselves, newest first, with what the receipt said.
    expect(dialog.getByText("2 st à 14,15")).toBeInTheDocument();
  });

  it("points at the paste box when there are no receipts at all", async () => {
    rows = [];
    renderTab();
    expect(await screen.findByText(/Klistra in ett kvitto i ett matköp/)).toBeInTheDocument();
  });
});

describe("Matvaror, Design v2", () => {
  it("the coverage bar is the kronor with a receipt of the kronor spent on food", async () => {
    renderTab();
    const bar = await screen.findByRole("img", { name: /av kronorna på mat har kvitto/ });
    expect(Number(bar.querySelector<HTMLElement>("[data-covered]")!.dataset.covered)).toBeCloseTo(1442100 / 1909947, 10);
    expect(bar).toHaveAccessibleName("76 % av kronorna på mat har kvitto");
    // The stores as chips.
    expect(within(screen.getByRole("list", { name: "Butiker" })).getByText(/Lidl 38 kvitton · 11\s149 kr/)).toBeInTheDocument();
  });

  it("each shelf's bar against the largest shelf", async () => {
    renderTab();
    await screen.findByText("Per hylla");
    const bar = (key: string) => Number(document.querySelector<HTMLElement>(`[data-shelf="${key}"] [data-bar]`)!.dataset.bar);
    expect(bar("1")).toBe(1);
    expect(bar("9")).toBeCloseTo(168000 / 320300, 10);
    expect(bar("none")).toBeCloseTo(84000 / 320300, 10);
  });

  it("the month chart has only the months with a receipt, and says which are left out", async () => {
    renderTab();
    await screen.findByText("Per månad, de månader som har kvitton");
    const months = new Set([...document.querySelectorAll<SVGElement>('[data-part="months"] [data-bar]')].map((b) => b.dataset.bar!.split(":")[0]));
    expect([...months]).toEqual(["2026-08", "2026-09"]);
    expect(document.querySelector('[data-part="months"] [data-missing]')).toHaveTextContent(/^juni 26 – juli 26 saknar kvitton och visas inte/);
  });

  it("the shelf chips count the groceries, Utan hylla orange while any wait", async () => {
    renderTab();
    await screen.findByText("Sneb Superior");
    const chips = within(screen.getByRole("group", { name: "Hylla" }));
    expect(chips.getAllByRole("button").map((b) => b.textContent)).toEqual(["Alla · 3", "Utan hylla · 1", "Dryck · 2"]);
    expect(chips.getByRole("button", { name: "Utan hylla · 1" })).toHaveClass("bg-caution-soft", "text-caution-text");
    await userEvent.click(chips.getByRole("button", { name: "Dryck · 2" }));
    expect(window.location.search).toBe("?flik=matvaror&hylla=9");
    expect(screen.getByTestId("products-count")).toHaveTextContent("2 av 2 visas");
    // Visa dem in the orange row sets the filter.
    await userEvent.click(screen.getByRole("button", { name: "Visa dem" }));
    expect(window.location.search).toBe("?flik=matvaror&hylla=utan");
    expect(screen.getByTestId("products-count")).toHaveTextContent("1 av 1 visas");
  });

  it("by totalt the groceries without a shelf come first; the order stands in the address", async () => {
    rows = [...ROWS, product({ id: 4, name: "Arla Mellanmjölk", groupId: 1, groupName: "Mejeri & ägg", times: 20, totalOre: 50000, lastPurchase: "2026-09-19" })];
    renderTab();
    await screen.findByText("Sneb Superior");
    const order = () => [...document.querySelectorAll<HTMLElement>("[data-product]")].map((r) => Number(r.dataset.product));
    // Sneb (144,80 kr, no shelf) before Arla (500 kr).
    expect(order()).toEqual([3, 4, 1, 2]);
    await userEvent.click(screen.getByRole("button", { name: /Sortering: totalt/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Namn, A–Ö/ }));
    expect(window.location.search).toBe("?flik=matvaror&sortering=a-o");
    expect(order()).toEqual([4, 1, 2, 3]);
    await userEvent.click(screen.getByRole("button", { name: /Sortering: A–Ö/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Gånger/ }));
    expect(order()).toEqual([4, 1, 3, 2]);
  });

  it("reads the filter and the order from the address", async () => {
    window.history.replaceState(null, "", "/analys?flik=matvaror&hylla=9&sortering=senast");
    renderTab();
    await screen.findByText("Havredryck Barista");
    expect(screen.getByRole("button", { name: /Sortering: senast/ })).toBeInTheDocument();
    expect(screen.queryByText("Sneb Superior")).not.toBeInTheDocument();
  });

  it("shows fifty rows at a time, and starts over when the filter changes", async () => {
    rows = Array.from({ length: 120 }, (_, i) => product({ id: 100 + i, name: `Vara ${String(i).padStart(3, "0")}`, groupId: 9, groupName: "Dryck", totalOre: 100_000 - i }));
    renderTab();
    await screen.findByText("Vara 000");
    const shown = () => document.querySelectorAll("[data-product]").length;
    expect(shown()).toBe(50);
    expect(screen.getByTestId("products-count")).toHaveTextContent("50 av 120 visas");
    await userEvent.click(screen.getByRole("button", { name: "Visa 50 till ›" }));
    expect(shown()).toBe(100);
    await userEvent.click(screen.getByRole("button", { name: "Visa 20 till ›" }));
    expect(shown()).toBe(120);
    expect(screen.queryByRole("button", { name: /till ›/ })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("group", { name: "Hylla" })).getByRole("button", { name: "Dryck · 120" }));
    expect(shown()).toBe(50);
  });
});

