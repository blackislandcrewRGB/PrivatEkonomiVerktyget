import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Item, ItemDetail } from "../../api";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { PageHeader } from "../../shell/PageHeader";
import { clearPersistentState } from "../../usePersistentState";
import { callsTo, mockApi } from "../../../test/api";
import { ItemsView } from "./ItemsView";
import { costPerDayOre, daysUntil } from "./ItemPanel";
import { monthsOfYear, monthsSoFar, shortSum, sumsByCategory } from "./ItemsCalendar";
import { sortItems } from "./filters";

const item = (id: number, name: string, extra: Partial<Item> = {}): Item => ({
  id,
  name,
  category: "Elektronik",
  purchaseDate: "2026-08-31",
  priceOre: 449000,
  merchant: "Amazon",
  purchaseUrl: null,
  note: null,
  owner: "me",
  status: "owned",
  warrantyMonths: 24,
  returnDeadline: null,
  soldPriceOre: null,
  soldDate: null,
  createdAt: "2026-09-01T09:00:00Z",
  updatedAt: "2026-09-01T09:00:00Z",
  deletedAt: null,
  warrantyEndsOn: "2028-08-31",
  cover: null,
  attachmentCount: 0,
  transactionIds: [3],
  icon: null,
  merchantName: extra.merchant === undefined ? "Amazon" : extra.merchant,
  ...extra,
});

const RING = item(7, "Ovalring Gen 4");
const LAMP = item(8, "Skrivbordslampa", { category: "Inredning & verktyg", purchaseDate: "2025-11-20", priceOre: 129900, warrantyMonths: null, warrantyEndsOn: null, status: "broken" });

const detail = (i: Item): ItemDetail => ({
  ...i,
  attachments: [],
  transactions: [
    { id: 3, bookingDate: "2026-08-31", transactionDate: "2026-08-31", descriptionClean: "AMAZON EU", label: null, amount: -449000, accountId: 1, categoryId: 2, deletedAt: null, icon: null },
  ],
  categoryOptions: ["Elektronik", "Frakt", "Inredning & verktyg", "Kläder"],
});

let items: Item[];
let fetchMock: ReturnType<typeof mockApi>;

function renderView() {
  return render(
    <TooltipProvider>
      <PageHeader title="Prylar" />
      <ItemsView />
      <Toaster />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  // Today is 20 September 2026.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 20, 12));
  sessionStorage.clear();
  // The filters and the layout are remembered for the session, in memory as
  // well as in storage; each test starts from nothing.
  clearPersistentState();
  items = [RING, LAMP];
  fetchMock = mockApi({
    "/settings": { partnerSwishNumbers: [], partnerName: "Mio" },
    "GET /items/7": detail(RING),
    "GET /items/8": detail(LAMP),
    "GET /items": (url: string) => {
      const q = new URL(`http://x${url}`).searchParams;
      const has = (k: string, v: string | null) => !q.get(k) || v === q.get(k);
      const shown = items.filter(
        (i) =>
          (!q.get("year") || i.purchaseDate.startsWith(q.get("year")!)) &&
          (!q.get("month") || i.purchaseDate.startsWith(q.get("month")!)) &&
          has("status", i.status) &&
          has("category", i.category) &&
          has("merchant", i.merchantName) &&
          has("owner", i.owner),
      );
      return {
        items: shown,
        totals: { count: shown.length, priceOre: shown.reduce((s, i) => s + i.priceOre, 0), soldOre: 0 },
        years: ["2026", "2025"],
        categories: ["Elektronik", "Inredning & verktyg"],
        merchants: [...new Set(items.map((i) => i.merchantName).filter((m): m is string => !!m))].map((name) => ({ name, count: items.filter((i) => i.merchantName === name).length })),
        categoryOptions: ["Elektronik", "Frakt", "Inredning & verktyg", "Kläder"],
      };
    },
    "PATCH /items/7": (_: string, init: { json?: unknown }) => ({ ...RING, ...(init.json as object) }),
    "POST /items/7/attachments": { id: 1, itemId: 7, kind: "image", filePath: "7/abc.webp", thumbnailPath: "7/abc-thumb.webp", url: "/api/attachments/7/abc.webp", thumbnailUrl: "/api/attachments/7/abc-thumb.webp" },
  });
});
afterEach(() => vi.useRealTimers());

describe("what a pryl costs per day", () => {
  it("counts the day of the purchase, and stops the day it was sold", () => {
    expect(daysUntil("2026-09-20", "2026-08-31")).toBe(20);
    // 4 490 kr over 21 days of owning it.
    expect(costPerDayOre(RING, "2026-09-20")).toEqual({ ore: Math.round(449000 / 21), days: 21 });
    // Sold: what it really cost is the price minus what it went for, over the days it was owned.
    const sold = { priceOre: 449000, purchaseDate: "2026-08-31", soldPriceOre: 200000, soldDate: "2026-09-09" };
    expect(costPerDayOre(sold, "2026-09-20")).toEqual({ ore: Math.round(249000 / 10), days: 10 });
  });
});

describe("a year of buying", () => {
  const YEAR = [RING, item(9, "Tangentbord", { purchaseDate: "2026-08-02", priceOre: 99000 }), item(10, "Matta", { purchaseDate: "2026-02-14", priceOre: 59900, category: "Inredning & verktyg" }), LAMP];

  it("puts each thing in its own month and leaves the others empty", () => {
    const months = monthsOfYear(YEAR, "2026");
    expect(months).toHaveLength(12);
    expect(months[1].items.map((i) => i.name)).toEqual(["Matta"]);
    // Both August purchases, oldest first, and their sum.
    expect(months[7].items.map((i) => i.name)).toEqual(["Tangentbord", "Ovalring Gen 4"]);
    expect(months[7].sum).toBe(99000 + 449000);
    expect(months[0].items).toEqual([]);
    // November 2025 is another year's business.
    expect(months.every((m) => m.items.every((i) => i.purchaseDate.startsWith("2026")))).toBe(true);
  });

  it("sums the year by category, biggest first, with the ones without under their own heading", () => {
    expect(sumsByCategory([...YEAR, item(11, "Sladd", { category: null, purchaseDate: "2026-03-03", priceOre: 4900 })], "2026")).toEqual([
      { category: "Elektronik", count: 2, sum: 548000 },
      { category: "Inredning & verktyg", count: 1, sum: 59900 },
      { category: "Utan kategori", count: 1, sum: 4900 },
    ]);
  });
});

describe("the Prylar page", () => {
  it("shows the gallery, the sum of what is shown, and switches to a list", async () => {
    renderView();
    expect(await screen.findByText("Ovalring Gen 4")).toBeInTheDocument();
    expect(screen.getByText("Skrivbordslampa")).toBeInTheDocument();
    // 4 490 + 1 299 = 5 789 kr, in whole kronor and without a '+': a price is
    // a price tag, not money coming in.
    await waitFor(() => expect(document.body.textContent?.replace(/\s/g, "")).toContain("5789kr"));
    expect(document.body.textContent).not.toContain("+5");
    expect(screen.getByText("2 prylar")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Lista" }));
    expect(await screen.findByText("Ovalring Gen 4")).toBeInTheDocument();
    // The list says what it is and where it was bought; the gallery says it with a picture.
    expect(screen.getByText("Elektronik · Amazon")).toBeInTheDocument();
  });

  // The choice of gallery or list is remembered as a plain string; a reload
  // has to give it back as one.
  it("comes back in the layout it was left in", async () => {
    sessionStorage.setItem("items.layout", JSON.stringify("list"));
    renderView();
    await screen.findByText("Ovalring Gen 4");
    expect(screen.getByRole("radio", { name: "Lista" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Elektronik · Amazon")).toBeInTheDocument();
  });

  it("filters on a year and says so with a chip that can be removed", async () => {
    renderView();
    await screen.findByText("Ovalring Gen 4");
    await userEvent.click(screen.getByRole("button", { name: "År" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "2025" }));

    await waitFor(() => expect(callsTo(fetchMock, "GET", "/items?").at(-1)?.[0]).toContain("year=2025"));
    await waitFor(() => expect(screen.queryByText("Ovalring Gen 4")).not.toBeInTheDocument());
    expect(screen.getByText("År: 2025")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ta bort filtret År: 2025" }));
    expect(await screen.findByText("Ovalring Gen 4")).toBeInTheDocument();
  });

  it("opens a pryl and lets the price be corrected where it stands", async () => {
    renderView();
    await userEvent.click(await screen.findByText("Ovalring Gen 4"));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("heading", { name: "Ovalring Gen 4" })).toBeInTheDocument();
    // Bought 31/8, so 21 days owned on 20/9.
    expect(within(panel).getByText(/per dag i 21 dagar/)).toBeInTheDocument();
    expect(within(panel).getByText(/dagar kvar · t.o.m. 2028-08-31/)).toBeInTheDocument();
    expect(within(panel).getByText("AMAZON EU")).toBeInTheDocument();

    const price = within(panel).getByLabelText("Pris");
    await userEvent.clear(price);
    await userEvent.type(price, "3 990");
    await userEvent.tab();
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/items/7")).toEqual([["/api/items/7", { priceOre: 399000 }]]));
    // The list is asked for again, so the gallery shows the corrected price.
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/items?").length + callsTo(fetchMock, "GET", "/items").length).toBeGreaterThan(1));
  });

  it("shows the year as a dot per pryl, a bar per month and a sum per category", async () => {
    items = [RING, item(9, "Tangentbord", { purchaseDate: "2026-08-02", priceOre: 99000, category: "Elektronik" }), item(10, "Matta", { purchaseDate: "2026-02-14", priceOre: 59900, category: "Inredning & verktyg" }), LAMP];
    renderView();
    await screen.findByText("Ovalring Gen 4");
    await userEvent.click(screen.getByRole("radio", { name: "Kalender" }));

    // Switching to the calendar picks this year, which is also the list's filter.
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/items?").at(-1)?.[0]).toContain("year=2026"));
    expect(await screen.findByRole("heading", { name: "2026" })).toBeInTheDocument();
    // A dot per thing, in the month it was bought.
    expect(screen.getByLabelText("Ovalring Gen 4, augusti 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Matta, februari 2026")).toBeInTheDocument();
    // The lamp is from 2025 and the server filtered it out with the year.
    expect(screen.queryByLabelText(/Skrivbordslampa/)).not.toBeInTheDocument();
    // In the header and in the calendar.
    expect(screen.getAllByText("3 prylar")).toHaveLength(2);
    expect(screen.getByText("Per kategori 2026")).toBeInTheDocument();

    // A dot opens the pryl.
    await userEvent.click(screen.getByLabelText("Ovalring Gen 4, augusti 2026"));
    expect(within(await screen.findByRole("dialog")).getByRole("heading", { name: "Ovalring Gen 4" })).toBeInTheDocument();
  });

  it("opens in the calendar from ?visa=kalender (where the old Analys › Prylar tab leads), and leaves the address clean", async () => {
    window.history.replaceState(null, "", "/prylar?visa=kalender");
    renderView();
    expect(await screen.findByRole("radio", { name: "Kalender" })).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText(/^Per kategori \d{4}$/)).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  // A product picture is usually copied from the shop's page, not saved to a
  // file first, so the pryl's own panel takes ⌘V.
  it("takes a picture from the clipboard, but not while you are typing", async () => {
    renderView();
    await userEvent.click(await screen.findByText("Ovalring Gen 4"));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Dra hit eller klistra in (⌘V)")).toBeInTheDocument();

    const paste = (file: File) => {
      const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
      e.clipboardData = { files: [file] };
      document.dispatchEvent(e);
    };
    const uploads = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/attachments"));

    // Typing in a field: the paste is text, and nothing is uploaded.
    within(panel).getByLabelText("Namn").focus();
    paste(new File(["x"], "ring.png", { type: "image/png" }));
    expect(uploads()).toHaveLength(0);

    (document.activeElement as HTMLElement).blur();
    paste(new File(["x"], "ring.png", { type: "image/png" }));
    await waitFor(() => expect(uploads()).toHaveLength(1));
    expect(await screen.findByText("Bilden är inlagd.")).toBeInTheDocument();

    // Anything that isn't a picture is left to the file picker.
    paste(new File(["x"], "kvitto.txt", { type: "text/plain" }));
    expect(uploads()).toHaveLength(1);
  });

  it("says nothing is there rather than showing an empty grid", async () => {
    items = [];
    renderView();
    expect(await screen.findByText("Inga prylar än")).toBeInTheDocument();
    expect(screen.getByText(/Lägg in en sak du köpt/)).toBeInTheDocument();
  });
});

describe("Prylar, Design v2", () => {
  const lastQuery = () => new URL(`http://x${callsTo(fetchMock, "GET", "/items").at(-1)![0].replace(/^\/api/, "")}`).searchParams;
  const spaced = (t: string) => t.replace(/\s*·\s*/g, " · ").replace(/\s+/g, " ").trim();
  const summary = () => spaced(screen.getByTestId("items-summary").textContent!);

  it.each([
    ["År", "2025", "year", "2025", "År: 2025"],
    ["Kategori", "Inredning & verktyg", "category", "Inredning & verktyg", "Kategori: Inredning & verktyg"],
    ["Handlare", "IKEA", "merchant", "IKEA", "Handlare: IKEA"],
    ["Vems", "Delade med Mio", "owner", "shared", "Delade med Mio"],
    ["Status", "Trasig", "status", "broken", "Status: Trasig"],
  ])("the %s chip sets the same filter as 'Fler filter' did, shows it, and takes it off", async (chip, choice, param, value, label) => {
    items = [RING, { ...LAMP, merchant: "IKEA", merchantName: "IKEA", owner: "shared" }];
    renderView();
    await screen.findByText("Ovalring Gen 4");
    await userEvent.click(screen.getByRole("button", { name: chip }));
    await userEvent.click(await screen.findByRole("menuitem", { name: new RegExp(`^${choice}`) }));
    await waitFor(() => expect(lastQuery().get(param)).toBe(value));
    await waitFor(() => expect(screen.queryByText("Ovalring Gen 4")).not.toBeInTheDocument());
    const on = screen.getByRole("button", { name: `Ta bort filtret ${label}` });
    expect(on).toHaveAttribute("data-active", "true");
    // The header sums what is shown: the lamp alone.
    await waitFor(() => expect(summary()).toMatch(/^1 pryl · 1 299 kr/));
    await userEvent.click(on);
    await waitFor(() => expect(lastQuery().get(param)).toBeNull());
    expect(await screen.findByText("Ovalring Gen 4")).toBeInTheDocument();
  });

  it("the header's sum is the sum of the prylar shown, with the year or month they are from; Rensa takes every filter off", async () => {
    items = [RING, item(9, "Tangentbord", { purchaseDate: "2026-08-02", priceOre: 99000 }), LAMP];
    renderView();
    await screen.findByText("Ovalring Gen 4");
    await waitFor(() => expect(summary()).toBe("3 prylar · 6 779 kr · alla år"));
    await userEvent.click(screen.getByRole("button", { name: "År" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "2026" }));
    await waitFor(() => expect(summary()).toBe("2 prylar · 5 480 kr · 2026"));
    await userEvent.click(screen.getByRole("button", { name: "Rensa" }));
    await waitFor(() => expect(summary()).toBe("3 prylar · 6 779 kr · alla år"));
    expect(screen.queryByRole("button", { name: "Rensa" })).not.toBeInTheDocument();
  });

  it("'utan kategori' only on a pryl without a category, in the gallery and the list", async () => {
    items = [RING, item(12, "Sladd", { category: null })];
    renderView();
    const card = (id: number) => document.querySelector(`[data-item="${id}"]`) as HTMLElement;
    await screen.findByText("Sladd");
    expect(within(card(12)).getByText("utan kategori")).toHaveAttribute("data-category-pill", "missing");
    expect(within(card(7)).queryByText("utan kategori")).toBeNull();
    expect(within(card(7)).getByText("Elektronik")).toHaveAttribute("data-category-pill", "set");
    await userEvent.click(screen.getByRole("radio", { name: "Lista" }));
    await waitFor(() => expect(card(12).querySelector("[data-category-pill=missing]")).toHaveTextContent("utan kategori"));
    expect(card(7).querySelector("[data-category-pill=missing]")).toBeNull();
  });

  it("the calendar's bars carry the months' sums as the month rows did; a bar shows that month in the gallery", async () => {
    items = [RING, item(9, "Tangentbord", { purchaseDate: "2026-08-02", priceOre: 99000 }), item(10, "Matta", { purchaseDate: "2026-02-14", priceOre: 59900 }), LAMP];
    renderView();
    await screen.findByText("Ovalring Gen 4");
    await userEvent.click(screen.getByRole("radio", { name: "Kalender" }));
    await screen.findByRole("heading", { name: "2026" });
    const year = items.filter((i) => i.purchaseDate.startsWith("2026"));
    const months = monthsOfYear(year, "2026");
    const bars = [...document.querySelectorAll<HTMLElement>("[data-bar-month]")];
    expect(bars).toHaveLength(12);
    bars.forEach((bar, i) => expect(Number(bar.dataset.sum)).toBe(months[i].sum));
    expect(bars[7]).toHaveTextContent("5,5k");
    expect(bars[1]).toHaveTextContent("599");
    // 4 490 + 990 + 599 kr over the nine months so far: 675 kr a month.
    expect(spaced(screen.getByTestId("calendar-summary").textContent!)).toBe("3 prylar · 6 079 kr · snitt 675 kr/mån");

    await userEvent.click(within(bars[7]).getByRole("button", { name: /^Augusti 2026: 2 prylar/ }));
    await waitFor(() => expect(lastQuery().get("month")).toBe("2026-08"));
    expect(screen.getByRole("radio", { name: "Galleri" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Ta bort filtret Månad: aug 2026" })).toBeInTheDocument();
    await waitFor(() => expect(summary()).toBe("2 prylar · 5 480 kr · augusti 2026"));
    expect(screen.queryByText("Matta")).not.toBeInTheDocument();
  });

  it("the order: newest first by default, then dearest or A–Ö", async () => {
    items = [RING, item(9, "Adapter", { purchaseDate: "2026-09-10", priceOre: 9900 }), LAMP];
    renderView();
    await screen.findByText("Ovalring Gen 4");
    const names = () => [...document.querySelectorAll("[data-item]")].map((e) => e.querySelector(".truncate")?.textContent);
    expect(names()).toEqual(["Ovalring Gen 4", "Adapter", "Skrivbordslampa"]);
    await userEvent.click(screen.getByRole("button", { name: /Sortering: datum/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Pris/ }));
    await waitFor(() => expect(names()).toEqual(["Ovalring Gen 4", "Skrivbordslampa", "Adapter"]));
    await userEvent.click(screen.getByRole("button", { name: /Sortering: pris/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Namn/ }));
    await waitFor(() => expect(names()).toEqual(["Adapter", "Ovalring Gen 4", "Skrivbordslampa"]));
  });

  it("a bar's sum as short as it reads, and the average over the months so far", () => {
    expect(shortSum(33000)).toBe("330");
    expect(shortSum(345200)).toBe("3,5k");
    expect(shortSum(1_229_000)).toBe("12k");
    expect(monthsSoFar("2026", "2026-09-20")).toBe(9);
    expect(monthsSoFar("2025", "2026-09-20")).toBe(12);
    expect(sortItems([LAMP, RING], "date").map((i) => i.id)).toEqual([8, 7]);
  });
});
