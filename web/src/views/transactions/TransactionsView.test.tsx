import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Category, Transaction } from "../../api";
import { reloadCategories } from "../../categories";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { clearCategorySuggestions } from "../../components/CategoryPicker";
import { PageHeader } from "../../shell/PageHeader";
import { callsTo, mockApi } from "../../../test/api";
import { TransactionsView } from "./TransactionsView";
import type { PageContext } from "./TransactionsPage";

const cat = (id: number, name: string, parentId: number | null = null): Category => ({
  id,
  name,
  parentId,
  color: null,
  isTransfer: false,
  isSettlement: false,
  systemKey: id === 99 ? "unknown" : null,
});
const CATEGORIES = [cat(1, "Mat"), cat(2, "Livsmedel", 1), cat(4, "Nöje"), cat(5, "Spel", 4), cat(98, "Övrigt"), cat(99, "Okänt", 98)];

let seq = 0;
const tx = (bookingDate: string, descriptionClean: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: ++seq,
  source: "swedbank",
  accountId: 1,
  bookingDate,
  transactionDate: bookingDate,
  descriptionClean,
  label: null,
  counterparty: descriptionClean,
  counterpartyName: null,
  merchantArea: null,
  cardMasked: null,
  amount,
  currency: "SEK",
  categoryId: null,
  categorySource: "none",
  shared: false,
  private: false,
  paidBy: "me",
  forOther: false,
  settlementExcluded: false,
  returnGroupId: null,
  isTransfer: false,
  isSettlement: false,
  occurrenceIndex: 1,
  importId: null,
  counterAccountId: null,
  transferPairId: null,
  recurringIncomeId: null,
  recurringExpenseId: null,
  recurringExpenseName: null,
  note: null,
  manuallyEditedAt: null,
  deletedAt: null,
  ...extra,
});

/** 'Gör till fast utgift…': the form's start, from the purchase. */
const PLAN_CANDIDATES = [{ id: 7, name: "ChatGPT", planName: null, amount: 24900, currency: null, vatPercent: null, from: "2026-10", day: 6 }];
const DRAFT = { name: "Apple.com/se", pattern: "APPLE.COM/SE", amount: 129900, date: "2026-05-25", accountName: "Swedbank Privatkonto" };

let rows: Transaction[];
let notes: { note: string; count: number }[];
let fetchMock: ReturnType<typeof mockApi>;
/** Split purchases the server counted with only their part in the filtered category. */
let partial = 0;
const ctx: PageContext = {
  accounts: [{ id: 1, name: "Swedbank Privatkonto", balance: 0, balanceUpdatedAt: null, note: null, kind: "bank", source: "swedbank", accountRef: null, clearing: null, trackBalance: true }],
  categories: CATEGORIES,
  notify: (t) => import("../../components/Toast").then((m) => m.notify(t)),
  refreshCounts: vi.fn(),
  openRecurring: vi.fn(),
  partnerName: "Mio",
};

/** The totals as the server gives them: counted rows only, Ut also per day. */
function listTotals() {
  const counted = rows.filter((r) => !r.isTransfer && !r.isSettlement && r.returnGroupId === null);
  const outByDay: Record<string, number> = {};
  for (const r of counted) if (r.amount < 0) outByDay[r.bookingDate] = (outByDay[r.bookingDate] ?? 0) + r.amount;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    count: rows.length,
    in: sum(counted.filter((r) => r.amount > 0).map((r) => r.amount)),
    out: sum(counted.filter((r) => r.amount < 0).map((r) => r.amount)),
    partial,
    outByDay,
  };
}

function renderView() {
  return render(
    <TooltipProvider>
      <PageHeader title="Transaktioner" />
      <TransactionsView ctx={ctx} />
      <Toaster />
    </TooltipProvider>,
  );
}
const activeRow = () => document.querySelector("[data-active]")?.getAttribute("data-row-id");
const row = (id: number) => document.querySelector(`[data-row-id="${id}"]`) as HTMLElement;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  // Today is 18 September 2026 (the current month is left out of the URL).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 18, 12));
  seq = 0;
  notes = [];
  partial = 0;
  rows = [
    tx("2026-09-16", "ICA KVANTUM", -25897, { categoryId: 2 }),
    tx("2026-09-16", "COOP", -13195, { categoryId: 2, shared: true }),
    tx("2026-09-14", "Swish Exempelbutik", -8204),
  ];
  window.history.replaceState(null, "", "/transaktioner?period=2026-09");
  localStorage.clear();
  sessionStorage.clear();
  clearCategorySuggestions();
  fetchMock = mockApi({
    "/categories": CATEGORIES,
    "/shared/invoices": [],
    "/transactions/category-suggestions": [{ categoryId: 5, reason: "history", detail: "3 gånger tidigare", rows: 0 }],
    // 'Utan kategori · N' asks for one row of the uncategorised ones and reads the count.
    "GET /transactions?": (url: string) =>
      url.includes("limit=1") && url.includes("categoryId=none")
        ? { rows: [], truncated: true, totals: { ...listTotals(), count: rows.filter((r) => r.categoryId === null).length } }
        : { rows, truncated: false, totals: listTotals() },
    "GET /transactions/notes": () => notes,
    "GET /label-rules/suggest": { pattern: "ICA", matchType: "contains", matches: 0, examples: [] },
    "GET /label-rules/preview": { matches: 3, examples: ["ICA NARA", "ICA MAXI"] },
    // One row renamed first (the question after L): already named, so none renamed now.
    "POST /label-rules": (_: string, init: { json?: unknown }) => {
      const b = init.json as { pattern: string; label: string; ids: number[] };
      return { rule: { id: 4, matchType: "contains", createdAt: "", rows: 0, ...b }, previousLabel: null, renamed: b.ids.length > 1 ? b.ids.length : 0, applied: 3, before: [] };
    },
    "GET /transactions/": (url: string) => url.endsWith("/plan-candidates") ? (rows.some((r) => r.descriptionClean.includes("CHATGPT")) ? PLAN_CANDIDATES : []) : url.endsWith("/recurring-draft") ? DRAFT : ({
      id: 1,
      descriptionRaw: "RAW",
      postedDate: null,
      merchantCategory: null,
      cardMasked: null,
      counterRef: null,
      fingerprint: "abcdef0123456789abcdef",
      occurrenceIndex: 1,
      createdAt: "2026-09-16",
      import: null,
      merchant: { label: "X", query: "X", since: "2025-09-18", count: 0, total: 0, average: 0 },
      rules: [],
      ruleSuggestion: null,
    }),
    "PATCH /transactions/": (url: string, init: { json?: unknown }) => {
      const id = Number(url.split("/")[2]);
      const updated = { ...rows.find((r) => r.id === id)!, ...(init.json as object) };
      rows = rows.map((r) => (r.id === id ? updated : r));
      const renamed = typeof (init.json as { label?: unknown }).label === "string";
      // A new category on a split row replaces the split, as the server does.
      const splitCleared = "categoryId" in (init.json as object) && !!rows.find((r) => r.id === id)?.splits;
      if (splitCleared) rows = rows.map((r) => (r.id === id ? { ...r, splits: null } : r));
      return {
        transaction: updated,
        splitCleared,
        ruleSuggestion: null,
        labelRuleSuggestion: renamed
          ? { pattern: updated.descriptionClean, matchType: "contains", label: updated.label, matches: 4, examples: [updated.descriptionClean], existingRuleId: null }
          : null,
      };
    },
    "DELETE /transactions/": (url: string) => {
      const id = Number(url.split("/")[2]);
      rows = rows.filter((r) => r.id !== id);
      return { deleted: "soft" };
    },
    "POST /transactions/bulk": { changed: 2, unchanged: 0, skipped: 0, skipReason: null, before: [] },
    // Any row's 'watch-charge' (the longer 'bulk' key still wins for that one).
    "POST /transactions/": { id: 12, name: "Podme", remindDays: null, remindBeforeCharge: true },
    "DELETE /recurring-expenses/12": { ok: true },
    "POST /recurring-expenses/7/": { id: 7, name: "ChatGPT" },
  });
  await reloadCategories();
});

describe("transaction list keyboard", () => {
  it("says when a split purchase counts in the sum with only its part in the category", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    expect(screen.queryByText(/uppdelat köp/)).toBeNull();
    cleanup();
    partial = 1;
    renderView();
    expect(await screen.findByText(/Ett uppdelat köp räknas bara med sin del i kategorin/)).toBeInTheDocument();
    cleanup();
    partial = 2;
    renderView();
    expect(await screen.findByText(/2 uppdelade köp räknas bara med sin del i kategorin/)).toBeInTheDocument();
  });

  it("groups rows per day and moves with j/k and the arrow keys, without clicking first", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    expect(screen.getByText("Onsdag 16 september")).toBeInTheDocument();
    expect(screen.getByText("Måndag 14 september")).toBeInTheDocument();
    expect(activeRow()).toBeUndefined();
    await userEvent.keyboard("j");
    expect(activeRow()).toBe("1");
    await userEvent.keyboard("{ArrowDown}j");
    expect(activeRow()).toBe("3");
    await userEvent.keyboard("j"); // stays on the last row
    expect(activeRow()).toBe("3");
    await userEvent.keyboard("k{ArrowUp}");
    expect(activeRow()).toBe("1");
  });

  it("Enter opens the detail panel, which follows the cursor; Esc closes it", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.keyboard("j{Enter}");
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("heading", { name: "ICA KVANTUM" })).toBeInTheDocument();
    await userEvent.keyboard("j");
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "COOP" })).toBeInTheDocument());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("C opens the picker on the row and a digit sets the suggested category", async () => {
    renderView();
    await screen.findByText("Swish Exempelbutik");
    await userEvent.keyboard("jjj");
    await userEvent.keyboard("c");
    await screen.findByText("Föreslagna");
    await userEvent.keyboard("1");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/transactions/3")).toEqual([["/api/transactions/3", { categoryId: 5 }]]));
    await waitFor(() => expect(within(row(3)).getByText("Nöje › Spel")).toBeInTheDocument());
  });

  it("S toggles shared, P private, U 'Vet ej' on the row", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.keyboard("j");
    await userEvent.keyboard("s");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/transactions/1").at(-1)?.[1]).toEqual({ shared: true }));
    await userEvent.keyboard("j"); // COOP is shared: S makes it own
    await userEvent.keyboard("s");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/transactions/2").at(-1)?.[1]).toEqual({ shared: false }));
    await userEvent.keyboard("p");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/transactions/2").at(-1)?.[1]).toEqual({ private: true }));
    // The row is now private and hidden (shown as 'Privat'); j goes on to the next one.
    await waitFor(() => expect(within(row(2)).getByText("Privat")).toBeInTheDocument());
    await userEvent.keyboard("ju");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/transactions/3").at(-1)?.[1]).toEqual({ categoryId: 99 }));
  });

  it("X and ⇧X select rows; keys then act on all of them; Esc clears", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.keyboard("jx");
    await userEvent.keyboard("jj{Shift>}X{/Shift}");
    const bar = screen.getByRole("toolbar", { name: "Åtgärder för markerade rader" });
    expect(bar).toHaveTextContent("3 markerade");
    await userEvent.keyboard("s");
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/transactions/bulk")[0][1]).toEqual({ ids: [1, 2, 3], owner: "shared" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    await userEvent.keyboard("{Meta>}a{/Meta}");
    expect(screen.getByRole("toolbar")).toHaveTextContent("3 markerade");
  });

  it("D deletes the row with Ångra, and the cursor moves to the next row", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.keyboard("jd");
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/transactions/1")).toHaveLength(1));
    expect(await screen.findByText("”ICA KVANTUM” togs bort.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ångra" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("ICA KVANTUM")).not.toBeInTheDocument());
    expect(activeRow()).toBe("2");
  });

  it("← → change the month in the URL, T goes back, / focuses the search", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.keyboard("{ArrowLeft}");
    expect(window.location.search).toBe("?period=2026-08");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(window.location.search).toBe("?period=2026-10");
    act(() => window.history.back());
    await waitFor(() => expect(window.location.search).toBe("")); // September: this month, so not in the URL
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}t");
    expect(window.location.search).toBe("");
    await userEvent.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Sök transaktioner" })).toHaveFocus();
    // Typing in the search doesn't trigger list keys.
    await userEvent.keyboard("jd");
    expect(callsTo(fetchMock, "DELETE", "/transactions/")).toHaveLength(0);
    expect(screen.getByRole("searchbox")).toHaveValue("jd");
  });

  it("N edits the note inline and saves it", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.keyboard("jn");
    const field = screen.getByRole("combobox");
    expect(field).toHaveFocus();
    await userEvent.keyboard("Matvaror{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/transactions/1").at(-1)?.[1]).toEqual({ note: "Matvaror" }));
  });

  it("? shows the shortcut list", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.keyboard("?");
    expect(await screen.findByText("Kortkommandon i Transaktioner")).toBeInTheDocument();
  });
});

describe("notes", () => {
  it("picking a suggested note in the panel saves it, shows it, and leaving the field doesn't empty it", async () => {
    notes = [{ note: "Annons Reddit", count: 1 }, { note: "MATVAROR", count: 14 }];
    renderView();
    await userEvent.click(await screen.findByText("Swish Exempelbutik"));
    const field = await screen.findByPlaceholderText("Lägg till en anteckning");
    await userEvent.click(field);
    await userEvent.pointer({ keys: "[MouseLeft>]", target: await screen.findByRole("option", { name: /Annons Reddit/ }) });
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/transactions/3")).toEqual([["/api/transactions/3", { note: "Annons Reddit" }]]));
    expect(field).toHaveValue("Annons Reddit");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.click(document.body);
    expect(callsTo(fetchMock, "PATCH", "/transactions/3")).toHaveLength(1);
    expect(field).toHaveValue("Annons Reddit");
  });

  it("gives the selected rows the same note from the bulk bar or N", async () => {
    notes = [{ note: "Annons Reddit", count: 1 }];
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.keyboard("jxjx");
    await userEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Anteckning" }));
    const dialog = await screen.findByRole("dialog", { name: "Anteckning för 2 rader" });
    await userEvent.type(within(dialog).getByRole("combobox"), "Annons");
    await userEvent.click(within(dialog).getByRole("button", { name: "Spara på 2 rader" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/transactions/bulk").at(-1)?.[1]).toEqual({ ids: [1, 2], note: "Annons" }));
    expect(screen.queryByRole("dialog", { name: /Anteckning för/ })).not.toBeInTheDocument();

    // N with rows selected opens the same dialog; a picked suggestion is saved at once, Escape cancels.
    await userEvent.keyboard("n");
    const again = await screen.findByRole("dialog", { name: "Anteckning för 2 rader" });
    await userEvent.pointer({ keys: "[MouseLeft>]", target: within(again).getByRole("option", { name: /Annons Reddit/ }) });
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/transactions/bulk").at(-1)?.[1]).toEqual({ ids: [1, 2], note: "Annons Reddit" }));
    await userEvent.keyboard("n");
    await screen.findByRole("dialog", { name: "Anteckning för 2 rader" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Anteckning för/ })).not.toBeInTheDocument());
    expect(callsTo(fetchMock, "POST", "/transactions/bulk")).toHaveLength(2);
  });

  it("renames the selected rows at once from the bulk bar or L, with or without a rule for new imports", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.keyboard("jxjx");
    await userEvent.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Namn" }));
    const dialog = await screen.findByRole("dialog", { name: "Namn för 2 rader" });
    expect(dialog).toHaveTextContent("ICA KVANTUM, COOP");
    // Only this time: no rule.
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Ge nya importer samma namn" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Namn" }), "Matbutik{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/transactions/bulk").at(-1)?.[1]).toEqual({ ids: [1, 2], label: "Matbutik" }));
    expect(screen.queryByRole("dialog", { name: /Namn för/ })).not.toBeInTheDocument();

    // With the rule (on by default): the suggested pattern, what else it renames, one call.
    await userEvent.keyboard("l");
    const again = await screen.findByRole("dialog", { name: "Namn för 2 rader" });
    await waitFor(() => expect(within(again).getByRole("textbox", { name: "Mönster" })).toHaveValue("ICA"));
    await userEvent.type(within(again).getByRole("textbox", { name: "Namn" }), "Matbutik");
    expect(await within(again).findByText(/Döper också om 3 andra rader utan namn: ICA NARA, ICA MAXI/)).toBeInTheDocument();
    await userEvent.click(within(again).getByRole("button", { name: "Spara namn och regel" }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST", "/label-rules").at(-1)?.[1]).toEqual({ pattern: "ICA", matchType: "contains", label: "Matbutik", ids: [1, 2] }),
    );
    expect(await screen.findByText("2 rader heter nu ”Matbutik”. Regeln döpte om 3 rader till. Nya importer får namnet.")).toBeInTheDocument();
    expect(callsTo(fetchMock, "POST", "/transactions/bulk")).toHaveLength(1);
  });

  it("shows a split purchase with its biggest category and '+1', and says when a new category replaces the split", async () => {
    const amazonRow = tx("2026-09-16", "AMAZON", -12990, { categoryId: 2, splits: [{ categoryId: 2, amount: -9990 }, { categoryId: 5, amount: -3000 }] });
    rows = [amazonRow];
    renderView();
    const amazon = await screen.findByText("AMAZON");
    const line = amazon.closest("[data-row-id]") as HTMLElement;
    expect(within(line).getByText("Mat › Livsmedel")).toBeInTheDocument();
    expect(within(line).getByLabelText("Uppdelat på 2 kategorier")).toHaveTextContent("+1");

    // A category for the whole row: the server drops the split and the toast says so.
    await userEvent.click(line);
    await userEvent.keyboard("u");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", `/transactions/${amazonRow.id}`).at(-1)?.[1]).toEqual({ categoryId: 99 }));
    expect(await screen.findByText("Uppdelningen togs bort: kategorin gäller hela köpet.")).toBeInTheDocument();
  });

  it("marks a row that paid for a pryl, and offers to create or link one in the panel", async () => {
    rows = [tx("2026-09-16", "AMAZON EU", -449000, { categoryId: 2, items: [{ id: 7, name: "Ovalring Gen 4" }] })];
    renderView();
    const amazon = await screen.findByText("AMAZON EU");
    // The marker sits with the shared/private ones and says what it was.
    expect(within(amazon.closest("[data-row-id]") as HTMLElement).getByLabelText("Pryl: Ovalring Gen 4")).toBeInTheDocument();

    await userEvent.click(amazon);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Prylar")).toBeInTheDocument();
    expect(within(panel).getByText("Ovalring Gen 4")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Koppla bort Ovalring Gen 4")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Skapa pryl" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Koppla till pryl" })).toBeInTheDocument();
  });

  it("offers to be reminded before a subscription draws again, and undoes it", async () => {
    const podme = tx("2026-09-10", "Podme 1A2-B3C4D5", -9900);
    rows = [podme];
    renderView();
    await userEvent.click(await screen.findByText("Podme 1A2-B3C4D5"));
    const panel = await screen.findByRole("dialog");

    await userEvent.click(within(panel).getByRole("button", { name: "Påminn innan nästa dragning…" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", `/transactions/${podme.id}/watch-charge`)).toHaveLength(1));
    // The toast says where it went: a button that quietly adds a fixed expense
    // would be a surprise.
    const toast = await screen.findByText("Podme är nu en fast utgift. Vakten säger till 3 dagar innan varje dragning.");

    // The Ångra of that toast: the panel has one of its own for a return.
    await userEvent.click(within(toast.closest("li") as HTMLElement).getByRole("button", { name: "Ångra" }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/recurring-expenses/12")).toHaveLength(1));
  });

  it("makes a purchase a yearly fixed expense, named, with the amount and day from the purchase", async () => {
    const apple = tx("2026-05-25", "APPLE.COM/SE", -129900);
    rows = [apple];
    renderView();
    await userEvent.click(await screen.findByText("APPLE.COM/SE"));
    const panel = await screen.findByRole("dialog");
    await userEvent.click(within(panel).getByRole("button", { name: "Gör till fast utgift…" }));
    const form = await within(panel).findByRole("form", { name: "Gör till fast utgift" });
    // Yearly to start with, on the purchase's day, from its account.
    expect(within(form).getByRole("radio", { name: "Årsvis" })).toBeChecked();
    expect(form.textContent?.replace(/\s/g, " ")).toContain("1 299,00 kr varje år 25 maj från Swedbank Privatkonto");
    const name = within(form).getByLabelText("Namn");
    await userEvent.clear(name);
    await userEvent.type(name, "Apple Developer");
    await userEvent.click(within(form).getByRole("button", { name: "Skapa" }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST", `/transactions/${apple.id}/make-recurring`)).toEqual([
        [`/api/transactions/${apple.id}/make-recurring`, { name: "Apple Developer", cycle: "yearly", pattern: "APPLE.COM/SE" }],
      ]),
    );
  });

  it("a purchase that looks like a fixed expense's new plan: 'Byt plan för …' makes it the first charge of the plan, and the toast takes it back", async () => {
    const chatgpt = tx("2026-10-06", "OPENAI *CHATGPT SUBSCR", -93700);
    rows = [chatgpt];
    renderView();
    await userEvent.click(await screen.findByText("OPENAI *CHATGPT SUBSCR"));
    const panel = await screen.findByRole("dialog");
    await userEvent.click(await within(panel).findByRole("button", { name: "Byt plan för ChatGPT…" }));
    const form = within(panel).getByRole("form", { name: "Byt plan" });
    expect(form.textContent?.replace(/\s/g, " ")).toContain("ChatGPT kostade 249,00 kr");
    expect(form.textContent?.replace(/\s/g, " ")).toContain("937,00 kr, blir första dragningen på den nya planen: från oktober 2026, dragen den 6:e");
    await userEvent.type(within(form).getByLabelText("Namn på planen (valfritt)"), "Pro");
    await userEvent.click(within(form).getByRole("button", { name: "Byt plan" }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST", "/recurring-expenses/7/change-plan")).toEqual([
        ["/api/recurring-expenses/7/change-plan", { transactionId: chatgpt.id, from: "2026-10", anchorDay: 6, amount: 93700, name: "Pro" }],
      ]),
    );
    const toast = await screen.findByText("ChatGPT har bytt plan: 937,00 kr från oktober 2026. Dragningen före räknas kvar på den gamla planen.");
    await userEvent.click(within(toast.closest("li") as HTMLElement).getByRole("button", { name: "Ångra" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/recurring-expenses/7/undo-plan-change")).toEqual([["/api/recurring-expenses/7/undo-plan-change", { transactionId: chatgpt.id }]]));
  });

  it("renaming one row asks whether new imports with that text should get the name too; R saves the name rule", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.keyboard("jl");
    await userEvent.keyboard("{Control>}a{/Control}Matbutiken{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/transactions/1").at(-1)?.[1]).toEqual({ label: "Matbutiken" }));
    const question = await screen.findByText(/Döp om kommande/);
    expect(question.closest("div")).toHaveTextContent("Döp om kommande ICA KVANTUM till Matbutiken?");
    expect(question.closest("div")).toHaveTextContent("Döper också om 4 rader utan namn");
    await userEvent.keyboard("r");
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST", "/label-rules").at(-1)?.[1]).toEqual({ pattern: "ICA KVANTUM", matchType: "contains", label: "Matbutiken", ids: [1] }),
    );
    expect(await screen.findByText("Namnregel sparad: ICA KVANTUM → Matbutiken. 3 rader till fick namnet. Nya importer får det.")).toBeInTheDocument();
  });
});

describe("summary cards", () => {
  const tile = (name: string) => document.querySelector(`[data-tile="${name}"]`)!.textContent!.replace(/\s/g, " ");

  it("shows In, Ut and Netto with the list's sums", async () => {
    rows.push(tx("2026-09-17", "LÖN", 2450000, { categoryId: 1 }));
    renderView();
    await screen.findByText("ICA KVANTUM");
    expect(screen.getByRole("heading", { name: /September · 4 transaktioner/ })).toBeInTheDocument();
    expect(tile("In")).toMatch(/^In\+24 500 kr$/);
    expect(tile("Ut")).toMatch(/^Ut−473 kr$/);
    expect(tile("Netto")).toMatch(/^Netto\+24 027 kr$/);
    expect(screen.getByText(/Överföringar, avstämning och returnerade köp räknas inte\./)).toBeInTheDocument();
  });

  it("has a bar per day of the month, adding up to Ut", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    const group = screen.getByRole("group", { name: "Utgifter per dag" });
    expect(group.querySelectorAll("[data-day]")).toHaveLength(30);
    const bars = within(group).getAllByRole("button");
    expect(bars.map((b) => b.getAttribute("aria-label")!.replace(/\s/g, " "))).toEqual(["14 september: −82 kr", "16 september: −391 kr"]);
    expect(bars.reduce((s, b) => s + Number(b.dataset.ore), 0)).toBe(25897 + 13195 + 8204);
  });

  it("jumps to the day of a clicked bar and lights its header", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo");
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.click(screen.getByRole("button", { name: /^14 september/ }));
    expect(scrollTo).toHaveBeenCalled();
    expect(document.querySelector('[data-day-header="2026-09-14"]')).toHaveAttribute("data-flash");
    expect(document.querySelector('[data-day-header="2026-09-16"]')).not.toHaveAttribute("data-flash");
    scrollTo.mockRestore();
  });

  it("leaves the bars out when the period isn't a month", async () => {
    window.history.replaceState(null, "", "/transaktioner?period=all");
    renderView();
    await screen.findByText("ICA KVANTUM");
    expect(screen.getByRole("heading", { name: /Alla datum · 3 transaktioner/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Utgifter per dag" })).toBeNull();
  });
});

describe("filter chips", () => {
  /** The list's own requests (not the count behind 'Utan kategori · N'), newest last. */
  const lastListQuery = () =>
    new URLSearchParams(
      callsTo(fetchMock, "GET", "/transactions?")
        .map(([u]) => u)
        .filter((u) => !u.includes("limit=1"))
        .at(-1)!
        .split("?")[1],
    );
  const chips = () => screen.getByRole("group", { name: "Filter" });

  it("counts the rows without a category, and turns the filter on", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    const chip = await within(chips()).findByRole("button", { name: /^Utan kategori\s*·\s*1$/ });
    await userEvent.click(chip);
    expect(window.location.search).toBe("?uncategorized=1");
    await waitFor(() => expect(lastListQuery().get("categoryId")).toBe("none"));
    expect(within(chips()).getByRole("button", { name: /^Utan kategori/ })).toHaveAttribute("data-active");
  });

  it("Delade, Återkommande and Med kvitto are toggles in the address and the request", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.click(within(chips()).getByRole("button", { name: "Delade med Mio" }));
    await userEvent.click(within(chips()).getByRole("button", { name: "Återkommande" }));
    await userEvent.click(within(chips()).getByRole("button", { name: "Med kvitto" }));
    expect(window.location.search).toBe("?owner=shared&recurring=1&receipt=1");
    await waitFor(() => expect(lastListQuery().get("receipt")).toBe("1"));
    expect(lastListQuery().get("shared")).toBe("shared");
    expect(lastListQuery().get("recurring")).toBe("1");
    await userEvent.click(within(chips()).getByRole("button", { name: "Återkommande" }));
    expect(window.location.search).toBe("?owner=shared&receipt=1");
  });

  it("Konto ▾ and Kategori ▾ open the panels as before", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.click(within(chips()).getByRole("button", { name: "Konto" }));
    await userEvent.click(await screen.findByRole("button", { name: "Swedbank Privatkonto" }));
    expect(window.location.search).toBe("?account=1");
    expect(within(chips()).getByRole("button", { name: "Konto: Swedbank Privatkonto" })).toHaveAttribute("data-active");
    await userEvent.click(within(chips()).getByRole("button", { name: "Kategori" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mat" }));
    expect(window.location.search).toBe("?account=1&category=1");
    await waitFor(() => expect(lastListQuery().get("categoryIds")).toBe("1"));
    expect(lastListQuery().get("accountId")).toBe("1");
  });

  it("a filter from Fler shows as its own chip that takes it off, and Rensa keeps period and order", async () => {
    window.history.replaceState(null, "", "/transaktioner?source=mastercard&sort=aldst");
    renderView();
    await screen.findByText("ICA KVANTUM");
    await waitFor(() => expect(lastListQuery().get("order")).toBe("asc"));
    const source = within(chips()).getByRole("button", { name: "Ta bort filtret Källa: Mastercard" });
    await userEvent.click(within(chips()).getByRole("button", { name: "Delade med Mio" }));
    await userEvent.click(within(chips()).getByRole("button", { name: "Rensa" }));
    expect(window.location.search).toBe("?sort=aldst");
    expect(source).not.toBeInTheDocument();
  });

  it("Fler holds the source, whose, the amount and transfers as before", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.click(within(chips()).getByRole("button", { name: "Fler" }));
    await userEvent.selectOptions(await screen.findByRole("combobox"), "mastercard");
    await userEvent.click(screen.getByRole("radio", { name: "Egna" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Visa överföringar" }));
    expect(window.location.search).toBe("?source=mastercard&owner=own&transfers=1");
    await waitFor(() => expect(lastListQuery().get("transfers")).toBe("1"));
    expect(lastListQuery().get("source")).toBe("mastercard");
    expect(lastListQuery().get("shared")).toBe("own");
    await userEvent.keyboard("{Escape}");
    for (const label of ["Källa: Mastercard", "Bara egna", "Med överföringar"]) expect(within(chips()).getByRole("button", { name: `Ta bort filtret ${label}` })).toBeInTheDocument();
  });

  it("orders oldest first from Sortering", async () => {
    renderView();
    await screen.findByText("ICA KVANTUM");
    await userEvent.click(within(chips()).getByRole("button", { name: /Sortering: datum/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Datum, äldst först" }));
    expect(window.location.search).toBe("?sort=aldst");
    await waitFor(() => expect(lastListQuery().get("order")).toBe("asc"));
    expect(within(chips()).getByRole("button", { name: /Sortering: äldst först/ })).toBeInTheDocument();
  });
});

describe("rows in Design v2", () => {
  const amountOf = (name: string) => {
    const r = screen.getByText(name).closest("[data-row-id]") as HTMLElement;
    return within(r).getByText(/kr$/);
  };

  it("strikes through a refund in green and a returned purchase in grey, dimming their names", async () => {
    rows = [tx("2026-09-11", "REFURBED", 289900, { label: "Refurbed", returnGroupId: 50, categoryId: 2 }), tx("2026-09-10", "ELGIGANTEN", -289900, { categoryId: 2 })];
    rows[1] = { ...rows[1], id: 50, returnGroupId: 50 };
    renderView();
    await screen.findByText("Refurbed");
    const refund = amountOf("Refurbed");
    expect(refund.textContent!.replace(/\s/g, " ")).toBe("+2 899,00 kr");
    expect(refund).toHaveClass("line-through", "text-positive-text");
    expect(screen.getByText("Refurbed")).toHaveClass("text-ink-3");
    expect(screen.getByText("återbetalning")).toHaveClass("bg-positive-soft", "text-positive-text");
    const returned = amountOf("ELGIGANTEN");
    expect(returned).toHaveClass("line-through", "text-ink-3");
    expect(screen.getByText("returnerad")).toHaveClass("bg-card-inset");
    // Neither counts: the day headers have no sum.
    expect(document.querySelector('[data-day-header="2026-09-11"]')!.textContent).toBe("Fredag 11 september");
  });

  it("shows an income in green with its sign, and a positive day in green", async () => {
    rows = [tx("2026-09-17", "LÖN", 2450000, { categoryId: 1 }), ...rows];
    renderView();
    await screen.findByText("LÖN");
    const pay = amountOf("LÖN");
    expect(pay.textContent!.replace(/\s/g, " ")).toBe("+24 500,00 kr");
    expect(pay).toHaveClass("text-positive-text");
    expect(pay).not.toHaveClass("line-through");
    const day = document.querySelector('[data-day-header="2026-09-17"]')!;
    expect(within(day as HTMLElement).getByText(/\+24\s500\skr/)).toHaveClass("text-positive-text");
    expect(amountOf("ICA KVANTUM")).toHaveClass("text-ink");
  });

  it("puts the note in a chip and a partner's tag in purple after the name", async () => {
    rows = [tx("2026-09-18", "MATTOR AB", -10000, { note: "MATTAN", paidBy: "partner", categoryId: 2 }), ...rows];
    renderView();
    await screen.findByText("MATTOR AB");
    expect(screen.getByText("MATTAN").closest("span")).toHaveClass("bg-card-inset");
    expect(screen.getByText("Anteckning:")).toHaveClass("sr-only");
    expect(screen.getByText("Mio betalade")).toHaveClass("bg-purple-soft", "text-purple-text");
  });
});
