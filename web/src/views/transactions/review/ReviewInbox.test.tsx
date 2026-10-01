import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Category, ReviewGroup } from "../../../api";
import { reloadCategories } from "../../../categories";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { Toaster } from "../../../components/Toast";
import { clearCategorySuggestions } from "../../../components/CategoryPicker";
import { PageHeader } from "../../../shell/PageHeader";
import { callsTo, mockApi } from "../../../../test/api";
import type { PageContext } from "../TransactionsPage";
import { ReviewInbox } from "./ReviewInbox";
import { toCards } from "./model";

const cat = (id: number, name: string, parentId: number | null = null, systemKey: Category["systemKey"] = null): Category => ({
  id,
  name,
  parentId,
  color: null,
  isTransfer: false,
  isSettlement: false,
  systemKey,
});
const CATEGORIES = [cat(1, "Mat"), cat(2, "Livsmedel", 1), cat(4, "Nöje"), cat(5, "Spel", 4), cat(98, "Övrigt"), cat(99, "Okänt", 98, "unknown")];

const group = (key: string, merchant: string, direction: "in" | "out", ids: number[], isSwish = false): ReviewGroup => ({
  key,
  merchant,
  name: null,
  direction,
  isSwish,
  count: ids.length,
  sum: (direction === "out" ? -1 : 1) * 10000 * ids.length,
  first: "2026-09-01",
  last: "2026-09-10",
  accountIds: [1],
  ids,
  examples: [merchant],
});
const GROUPS = [
  group("out|GAMESHOP", "GAMESHOP", "out", [1, 2, 3]),
  group("out|+46701234567", "+46701234567", "out", [4, 5], true),
  group("in|+46701234567", "+46701234567", "in", [6], true),
];

const ctx: PageContext = {
  accounts: [{ id: 1, name: "Swedbank Privatkonto", balance: 0, balanceUpdatedAt: null, note: null, kind: "bank", source: "swedbank", accountRef: null, clearing: null, trackBalance: true }],
  categories: CATEGORIES,
  notify: (t) => import("../../../components/Toast").then((m) => m.notify(t)),
  refreshCounts: vi.fn(),
  openRecurring: vi.fn(),
  partnerName: "Mio",
};

let fetchMock: ReturnType<typeof mockApi>;
let groups: ReviewGroup[];
beforeEach(async () => {
  localStorage.clear();
  clearCategorySuggestions();
  groups = GROUPS;
  const picks = [
    { categoryId: 5, reason: "history", detail: "3 gånger tidigare", rows: 0 },
    { categoryId: 2, reason: "popular", detail: "Ofta använd", rows: 0 },
  ];
  fetchMock = mockApi({
    "/categories": CATEGORIES,
    "GET /review/groups": () => ({ groups, privateHidden: 0 }),
    "POST /review/rows": [],
    "POST /review/quick-picks": (_: string, init: { json?: unknown }) =>
      Object.fromEntries((init.json as { groups: { key: string }[] }).groups.map((g) => [g.key, picks])),
    "POST /transactions/categorize": (_: string, init: { json?: unknown }) => {
      const ids = (init.json as { ids: number[] }).ids;
      groups = groups.map((g) => ({ ...g, ids: g.ids.filter((id) => !ids.includes(id)) })).filter((g) => g.ids.length);
      return { byRule: 0, manual: ids.length, undo: { rows: [{ id: ids[0] }], rule: null } };
    },
    "POST /transactions/undo": { restored: 1 },
    "/transactions/category-suggestions": [],
  });
  await reloadCategories();
});

function renderInbox() {
  return render(
    <TooltipProvider>
      <PageHeader title="Transaktioner" />
      <ReviewInbox ctx={ctx} />
      <Toaster />
    </TooltipProvider>,
  );
}
const activeCard = () => document.querySelector("[data-card].ring-1")?.getAttribute("data-card");
const categorized = () => callsTo(fetchMock, "POST", "/transactions/categorize").map(([, body]) => body);

describe("review cards", () => {
  it("puts the same Swish number both ways in one card, most rows first", () => {
    const cards = toCards(GROUPS);
    expect(cards.map((c) => [c.key, c.count, c.sections.map((s) => s.direction)])).toEqual([
      ["out|GAMESHOP", 3, ["out"]],
      ["swish|+46701234567", 3, ["out", "in"]],
    ]);
  });
});

describe("Att granska inbox keyboard", () => {
  it("shows progress, and 1 applies the first quick pick with a rule; the next card becomes active", async () => {
    renderInbox();
    await screen.findByText("3 gånger tidigare", { exact: false }).catch(() => null);
    await waitFor(() => expect(activeCard()).toBe("out|GAMESHOP"));
    expect(screen.getByText(/6 rader i 2 grupper/)).toBeInTheDocument();
    await waitFor(() => expect(within(document.querySelector('[data-card="out|GAMESHOP"]')!).getByText("Nöje › Spel")).toBeInTheDocument());
    await userEvent.keyboard("1");
    await waitFor(() => expect(categorized()).toEqual([{ ids: [1, 2, 3], categoryId: 5, rule: { pattern: "GAMESHOP", matchType: "contains", direction: "any" } }]));
    await waitFor(() => expect(activeCard()).toBe("swish|+46701234567"));
    expect(await screen.findByText(/GAMESHOP: 3 rader → Nöje › Spel\. Regel sparad\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/1 gjorda i dag/)).toBeInTheDocument());
  });

  it("R turns 'kom ihåg' off (no rule); U sets Vet ej without a rule", async () => {
    renderInbox();
    await waitFor(() => expect(activeCard()).toBe("out|GAMESHOP"));
    await userEvent.keyboard("r2");
    await waitFor(() => expect(categorized()[0]).toEqual({ ids: [1, 2, 3], categoryId: 2, rule: null }));
    await waitFor(() => expect(activeCard()).toBe("swish|+46701234567"));
    await userEvent.keyboard("u");
    // The Swish card's larger direction (out) by default.
    await waitFor(() => expect(categorized()[1]).toEqual({ ids: [4, 5], categoryId: 99, rule: null }));
  });

  it("⇧J/⇧K move between cards; B makes one choice for both directions with one rule", async () => {
    renderInbox();
    await waitFor(() => expect(activeCard()).toBe("out|GAMESHOP"));
    await userEvent.keyboard("{Shift>}J{/Shift}");
    expect(activeCard()).toBe("swish|+46701234567");
    await userEvent.keyboard("{Shift>}K{/Shift}");
    expect(activeCard()).toBe("out|GAMESHOP");
    await userEvent.keyboard("{Shift>}J{/Shift}b1");
    await waitFor(() =>
      expect(categorized()[0]).toEqual({ ids: [4, 5, 6], categoryId: 5, rule: { pattern: "+46701234567", matchType: "contains", direction: "any" } }),
    );
  });

  it("a Swish card for one direction makes a rule for that direction only", async () => {
    renderInbox();
    await waitFor(() => expect(activeCard()).toBe("out|GAMESHOP"));
    await userEvent.keyboard("{Shift>}J{/Shift}1");
    await waitFor(() => expect(categorized()[0]).toMatchObject({ ids: [4, 5], rule: { direction: "out" } }));
    // The same number's other direction stays active.
    await waitFor(() => expect(activeCard()).toBe("in|+46701234567"));
  });

  it("C opens the category picker for the card; Ångra undoes", async () => {
    renderInbox();
    await waitFor(() => expect(activeCard()).toBe("out|GAMESHOP"));
    await userEvent.keyboard("c");
    expect(await screen.findByPlaceholderText("Sök kategori…")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("1");
    await screen.findByText(/GAMESHOP: 3 rader/);
    await userEvent.click(screen.getAllByRole("button", { name: "Ångra" }).at(-1)!);
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/transactions/undo")).toHaveLength(1));
  });
});
