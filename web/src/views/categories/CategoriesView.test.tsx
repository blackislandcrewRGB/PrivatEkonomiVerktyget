import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Category, LabelRule, Rule } from "../../api";
import { reloadCategories } from "../../categories";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { categoryColor, subTone } from "../../lib/palette";
import { PageHeader } from "../../shell/PageHeader";
import { callsTo, mockApi } from "../../../test/api";
import { CategoriesView } from "./CategoriesView";

const cat = (id: number, name: string, parentId: number | null = null, color: string | null = null): Category => ({
  id,
  name,
  parentId,
  color,
  isTransfer: false,
  isSettlement: false,
  systemKey: null,
});
const CATEGORIES = [
  cat(1, "Mat", null, "#117733"),
  cat(2, "Livsmedel", 1, "#117733"),
  cat(3, "Restaurang", 1, "#117733"),
  cat(4, "Resor", null, "#E69F00"),
  cat(5, "Hotell", 4, "#E69F00"),
  cat(6, "Nöje", null, "#CC79A7"),
];
const rule = (id: number, pattern: string, categoryId: number, matches12: number, over: Partial<Rule> = {}): Rule => ({
  id,
  pattern,
  matchType: "contains",
  direction: "any",
  categoryId,
  sharedDefault: null,
  isTransfer: false,
  createdFrom: "seed",
  hits: matches12 * 2,
  matches12,
  brandSlug: null,
  iconPath: null,
  ...over,
});

let rules: Rule[];
let nameRules: LabelRule[];
let fetchMock: ReturnType<typeof mockApi>;
beforeEach(async () => {
  window.history.replaceState(null, "", "/kategorier");
  localStorage.clear();
  nameRules = [];
  rules = [rule(1, "LIDL", 2, 21), rule(2, "EXEMPELBUTIK", 3, 17), rule(3, "EXEMPELHOTELL", 5, 1), rule(4, "GAMMAL", 2, 0, { createdFrom: "manual" })];
  fetchMock = mockApi({
    "/categories/usage": {
      2: { transactions: 50, rules: 2, count12: 47, sum12: -950000, countYtd: 30, sumYtd: -700000 },
      3: { transactions: 40, rules: 1, count12: 34, sum12: -480000, countYtd: 20, sumYtd: -300000 },
    },
    "GET /categories": CATEGORIES,
    "PATCH /categories": {},
    "GET /rules": () => rules,
    "GET /label-rules/preview": (url: string) => (url.includes("pattern=GITHUB") ? { matches: 2, examples: ["GITHUB, INC."] } : { matches: 0, examples: [] }),
    "GET /label-rules": () => nameRules,
    "POST /label-rules": (_: string, init: { json?: unknown }) => {
      const rule = { id: 9, matchType: "contains", createdAt: "", rows: 2, ...(init.json as object) };
      nameRules = [...nameRules, rule as LabelRule];
      return { rule, previousLabel: null, renamed: 0, applied: 2, before: [] };
    },
    "DELETE /label-rules": (url: string) => {
      const id = Number(url.split("/").pop());
      const rule = nameRules.find((r) => r.id === id);
      nameRules = nameRules.filter((r) => r.id !== id);
      return { rule };
    },
    "GET /merchant-categories": [
      { id: 1, key: "hotell", label: "Hotell", categoryId: null, timesSeen: 3, lastSeenAt: null, uncategorized: 2 },
      { id: 2, key: "livs", label: "Livsmedelsbutiker", categoryId: 2, timesSeen: 40, lastSeenAt: null, uncategorized: 0 },
      // Not mapped, but its rows all have a category from the rules.
      { id: 3, key: "bok", label: "Bokhandel", categoryId: null, timesSeen: 5, lastSeenAt: null, uncategorized: 0 },
    ],
    "PATCH /rules": (url: string, init: { json?: unknown }) => {
      const id = Number(url.split("/").pop());
      rules = rules.map((r) => (r.id === id ? { ...r, ...(init.json as object) } : r));
      return { rule: rules.find((r) => r.id === id), applied: 0 };
    },
    "DELETE /rules": (url: string) => {
      const id = Number(url.split("/").pop());
      const r = rules.find((x) => x.id === id);
      rules = rules.filter((x) => x.id !== id);
      return r;
    },
    "POST /rules/2/icon": { iconPath: "dddddddddddddddddddd.png", icon: { image: "/api/icons/dddddddddddddddddddd.png" } },
    "PUT /merchant-categories": (url: string, init: { json?: unknown }) => {
      const id = Number(url.split("/").pop());
      return { id, key: "hotell", label: "Hotell", categoryId: (init.json as { categoryId: number }).categoryId, timesSeen: 3, lastSeenAt: null };
    },
    "POST /rules/delete": (_: string, init: { json?: unknown }) => {
      const ids = (init.json as { ids: number[] }).ids;
      const gone = rules.filter((r) => ids.includes(r.id));
      rules = rules.filter((r) => !ids.includes(r.id));
      return gone;
    },
    "POST /rules/restore": (_: string, init: { json?: unknown }) => {
      rules = [...rules, ...(Array.isArray(init.json) ? (init.json as Rule[]) : [init.json as Rule])];
      return init.json;
    },
    "POST /rules/preview": { matches: 2, total: 3, uncategorized: 2, rows: [{ id: 9, bookingDate: "2026-09-01", descriptionClean: "GYMMET", amount: -39900, accountId: 1, categoryId: null, isTransfer: false, private: false }] },
    "POST /rules": (_: string, init: { json?: unknown }) => ({ rule: rule(9, (init.json as Rule).pattern, (init.json as Rule).categoryId, 0), applied: 2, previousCategoryId: null, before: [] }),
    "/transactions/category-suggestions": [],
  });
  await reloadCategories();
});

function renderView() {
  return render(
    <TooltipProvider>
      <PageHeader title="Kategorier & regler" />
      <CategoriesView />
      <Toaster />
    </TooltipProvider>,
  );
}
const patterns = () => [...document.querySelectorAll("[data-rule] [data-pattern]")].map((el) => el.textContent);

describe("Kategorier & regler", () => {
  it("the tree shows rows and sum for 12 months (main category with its subcategories); a click filters the rules", async () => {
    renderView();
    const mat = await screen.findByRole("button", { name: "Mat" });
    const row = mat.closest("[data-category]")!;
    await waitFor(() => expect(row).toHaveTextContent("81"));
    expect(row).toHaveTextContent(/−14\s300 kr/);
    await waitFor(() => expect(patterns()).toEqual(["LIDL", "EXEMPELBUTIK", "EXEMPELHOTELL"]));
    await userEvent.click(screen.getByRole("button", { name: "Resor" }));
    expect(window.location.search).toBe("?kategori=4");
    expect(patterns()).toEqual(["EXEMPELHOTELL"]);
  });

  it("icons: most hits first, 'Saknar ikon' shows the rules without a brand or picture (a grey '?'); ⌘V puts a picture on the selected rule", async () => {
    rules = [
      rule(1, "LIDL", 2, 21, { brandSlug: "lidl", icon: { brand: "lidl" } }),
      rule(2, "EXEMPELBUTIK", 3, 17),
      rule(3, "EXEMPELHOTELL", 5, 1),
      rule(5, "PARKSTER", 2, 40, { iconPath: "cccccccccccccccccccc.png", icon: { image: "/api/icons/cccccccccccccccccccc.png" } }),
    ];
    renderView();
    await waitFor(() => expect(patterns()).toEqual(["PARKSTER", "LIDL", "EXEMPELBUTIK", "EXEMPELHOTELL"]));
    expect(document.querySelector('[data-rule="1"] [data-merchant-icon]')!.getAttribute("data-merchant-icon")).toBe("brand:lidl");
    expect(document.querySelector('[data-rule="2"] [data-no-icon]')).toHaveTextContent("?");
    await userEvent.click(screen.getByRole("button", { name: "Saknar ikon, 2" }));
    expect(patterns()).toEqual(["EXEMPELBUTIK", "EXEMPELHOTELL"]);
    await userEvent.click(screen.getByRole("button", { name: "Sortering: Flest träffar" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /A–Ö/ }));
    expect(patterns()).toEqual(["EXEMPELBUTIK", "EXEMPELHOTELL"]);

    // Select EXEMPELBUTIK, paste a picture.
    await userEvent.click(document.querySelector('[data-rule="2"]')!);
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, "clipboardData", { value: { files: [new File([new Uint8Array([0x89, 0x50])], "k.png", { type: "image/png" })] } });
    document.dispatchEvent(paste);
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/rules/2/icon")).toHaveLength(1));
    expect(paste.defaultPrevented).toBe(true);
  });

  it("rules without matches in 12 months are folded under 'Oanvända'; / searches", async () => {
    renderView();
    await waitFor(() => expect(patterns()).toHaveLength(3));
    await userEvent.click(screen.getByRole("button", { name: /Oanvända \(1\)/ }));
    expect(patterns()).toContain("GAMMAL");
    await userEvent.keyboard("/");
    expect(screen.getByLabelText("Sök regler")).toHaveFocus();
    await userEvent.keyboard("butik");
    expect(patterns()).toEqual(["EXEMPELBUTIK"]);
  });

  it("j and Enter edit a pattern in the row; d deletes with Ångra", async () => {
    renderView();
    await waitFor(() => expect(patterns()).toHaveLength(3));
    await userEvent.keyboard("j{Enter}");
    const input = screen.getByLabelText("Mönster");
    await userEvent.clear(input);
    await userEvent.type(input, "LIDL SVERIGE{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/rules/1")).toEqual([["/api/rules/1", { pattern: "LIDL SVERIGE" }]]));

    await userEvent.keyboard("d");
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/rules/1")).toHaveLength(1));
    await userEvent.click(await screen.findByRole("button", { name: "Ångra" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/rules/restore")[0][1]).toMatchObject({ id: 1, pattern: "LIDL SVERIGE" }));
  });

  it("'Testa mönster' shows the rows a pattern matches before it is saved as a rule", async () => {
    renderView();
    await waitFor(() => expect(patterns()).toHaveLength(3));
    await userEvent.keyboard("t");
    await userEvent.type(screen.getByLabelText("Mönster att testa"), "GYMMET");
    expect(await screen.findByText("3 rader matchar · 2 utan kategori får den direkt")).toBeInTheDocument();
    expect(callsTo(fetchMock, "POST", "/rules/preview").at(-1)![1]).toMatchObject({ pattern: "GYMMET", examples: true });
    expect(screen.getByRole("button", { name: "Spara som regel" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Regelns kategori" }));
    await userEvent.click(await screen.findByRole("option", { name: /Nöje/ }));
    await userEvent.click(screen.getByRole("button", { name: "Spara som regel" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/rules").filter(([u]) => u === "/api/rules")[0][1]).toEqual({ pattern: "GYMMET", matchType: "contains", direction: "any", categoryId: 6 }));
  });

  it("a subcategory dragged onto another main category moves there", async () => {
    renderView();
    const hotell = (await screen.findByRole("button", { name: "Hotell" })).closest("[data-category]")!;
    const noje = screen.getByRole("button", { name: "Nöje" }).closest("[data-category]")!;
    fireEvent.dragStart(hotell, { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    fireEvent.dragOver(noje, { dataTransfer: { dropEffect: "" } });
    fireEvent.drop(noje, { dataTransfer: {} });
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/categories/5")).toEqual([["/api/categories/5", { parentId: 6 }]]));
  });

  it("a main category can't take a colour another main category has", async () => {
    renderView();
    await userEvent.click(await screen.findByRole("button", { name: "Färg för Nöje" }));
    expect(screen.getByRole("button", { name: /#117733, används av Mat/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "#56B4E9" }));
    await waitFor(() => expect(callsTo(fetchMock, "PATCH", "/categories/6")).toEqual([["/api/categories/6", { color: "#56B4E9" }]]));
  });

  it("the merchant categories are a tab of their own, missing ones first", async () => {
    renderView();
    await screen.findByRole("button", { name: "Mat" });
    await userEvent.keyboard("h");
    expect(window.location.search).toBe("?flik=namnregler");
    await userEvent.keyboard("h");
    expect(window.location.search).toBe("?flik=handlarkategorier");
    const labels = () => [...document.querySelectorAll("[data-mapping]")].map((r) => r.firstElementChild!.firstChild!.textContent);
    // 'Ej kopplade' is chosen while some aren't mapped.
    expect(screen.getByRole("button", { name: "Ej kopplade · 2" })).toHaveAttribute("aria-pressed", "true");
    expect(labels()).toEqual(["Bokhandel", "Hotell"]);
    // Only Hotell has rows without a category: the badge, the edge and the orange button are its.
    expect(document.querySelector("[data-badge=unmapped]")).toHaveTextContent("1 saknar");
    expect(document.querySelector('[data-mapping="1"]')).toHaveAttribute("data-urgent", "true");
    expect(document.querySelector('[data-mapping="1"]')).toHaveTextContent("2 köp utan kategori");
    expect(document.querySelector('[data-mapping="3"]')).not.toHaveAttribute("data-urgent");
    expect(screen.getByRole("button", { name: "Välj kategori för Hotell" })).toHaveClass("bg-caution-soft");
    expect(screen.getByRole("button", { name: "Välj kategori för Bokhandel" })).toHaveClass("bg-card-inset");
    await userEvent.click(screen.getByRole("button", { name: "Alla · 3" }));
    expect(labels()).toEqual(["Bokhandel", "Hotell", "Livsmedelsbutiker"]);
  });
});

describe("Kategorier & regler in Design v2", () => {
  const shownCategories = () => [...document.querySelectorAll("[role=tree] [data-category]")].map((el) => el.querySelector("button[aria-pressed]")?.textContent);

  it("the tree searches names and folds main categories, remembered in this browser; 'i år' switches rows and sum", async () => {
    const view = renderView();
    await screen.findByRole("button", { name: "Mat" });
    await userEvent.type(screen.getByLabelText("Sök kategori"), "hot");
    expect(shownCategories()).toEqual(["Resor", "Hotell"]);
    await userEvent.clear(screen.getByLabelText("Sök kategori"));
    expect(shownCategories()).toEqual(["Mat", "Livsmedel", "Restaurang", "Resor", "Hotell", "Nöje"]);

    await userEvent.click(screen.getByRole("button", { name: "Fäll ihop Mat" }));
    expect(shownCategories()).toEqual(["Mat", "Resor", "Hotell", "Nöje"]);
    expect(JSON.parse(localStorage.getItem("categories.folded")!)).toEqual([1]);
    // A search opens what is folded.
    await userEvent.type(screen.getByLabelText("Sök kategori"), "livs");
    expect(shownCategories()).toEqual(["Mat", "Livsmedel"]);
    view.unmount();

    renderView();
    await screen.findByRole("button", { name: "Fäll ut Mat" });
    expect(shownCategories()).toEqual(["Mat", "Resor", "Hotell", "Nöje"]);
    const mat = screen.getByRole("button", { name: "Mat" }).closest("[data-category]")!;
    await waitFor(() => expect(mat.querySelector("[data-count]")).toHaveTextContent("81"));
    await userEvent.click(screen.getByRole("radio", { name: "i år" }));
    expect(mat.querySelector("[data-count]")).toHaveTextContent("50");
    expect(mat.querySelector("[data-sum]")).toHaveTextContent(/−10\s000 kr/);
    expect(localStorage.getItem("categories.period")).toBe('"ytd"');
  });

  it("each chip's count is the rows it shows", async () => {
    renderView();
    await waitFor(() => expect(patterns()).toHaveLength(3));
    const rows = () => patterns().length + Number(screen.queryByRole("button", { name: /Oanvända \((\d+)\)/ })?.textContent?.match(/\((\d+)\)/)?.[1] ?? 0);
    for (const [name, n] of [["Grund, 3", 3], ["Manuella, 1", 1], ["Alla, 4", 4]] as const) {
      await userEvent.click(screen.getByRole("button", { name }));
      expect(rows()).toBe(n);
    }
    await userEvent.click(screen.getByRole("button", { name: "Saknar ikon, 4" }));
    expect(rows()).toBe(4);
  });

  it("'Välj kategori' in a merchant category's row saves it, and the row leaves 'Ej kopplade' with the badge", async () => {
    window.history.replaceState(null, "", "/kategorier?flik=handlarkategorier");
    renderView();
    await userEvent.click(await screen.findByRole("button", { name: "Välj kategori för Hotell" }));
    await userEvent.click(await screen.findByRole("option", { name: /Nöje/ }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/merchant-categories/1")).toEqual([["/api/merchant-categories/1", { categoryId: 6 }]]));
    expect(document.querySelector("[data-badge=unmapped]")).toBeNull();
    expect(screen.getByRole("button", { name: "Ej kopplade · 1" })).toBeInTheDocument();
    // It fades out of the list rather than vanishing at once.
    await waitFor(() => expect(document.querySelector('[data-mapping="1"]')).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Alla · 3" }));
    expect(within(document.querySelector('[data-mapping="1"]') as HTMLElement).getByRole("button", { name: "Vår kategori för Hotell" })).toHaveTextContent("Nöje");
  });

  it("'Rensa oanvända …' removes only the rules ticked, none to begin with, with Ångra", async () => {
    rules = [...rules, rule(7, "SOMMARSTUGA", 2, 0)];
    renderView();
    await waitFor(() => expect(patterns()).toHaveLength(3));
    await userEvent.click(screen.getByRole("button", { name: "Rensa oanvända …" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("checkbox").map((c) => (c as HTMLInputElement).checked)).toEqual([false, false]);
    expect(within(dialog).getByRole("button", { name: "Ta bort 0 regler" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "GAMMAL" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Ta bort 1 regel" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/rules/delete")).toEqual([["/api/rules/delete", { ids: [4] }]]));
    expect(rules.map((r) => r.pattern)).toEqual(["LIDL", "EXEMPELBUTIK", "EXEMPELHOTELL", "SOMMARSTUGA"]);
    const toast = (await screen.findByText(/1 oanvänd regel är borttagen/)).closest("li, [role=status], div")!.parentElement!;
    await userEvent.click(within(toast).getByRole("button", { name: "Ångra" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/rules/restore")[0][1]).toEqual([expect.objectContaining({ id: 4, pattern: "GAMMAL" })]));
  });
});

describe("category colours", () => {
  it("subcategories that follow their main category get lighter tones of it; own colours stay", () => {
    const all = [...CATEGORIES, cat(7, "Egen", 1, "#123456")];
    expect(categoryColor(all[0], all)).toBe("#117733");
    expect(categoryColor(all[1], all)).toBe(subTone("#117733", 0, 3));
    expect(categoryColor(all[2], all)).toBe(subTone("#117733", 1, 3));
    expect(categoryColor(all[2], all)).not.toBe(categoryColor(all[1], all));
    expect(categoryColor(all[6], all)).toBe("#123456");
  });
});

describe("name rules", () => {
  it("are listed in their own tab; a new one shows what it would rename, and one can be removed", async () => {
    nameRules = [{ id: 1, pattern: "ANTHROPIC* CLAUDE SUB", matchType: "contains", label: "CLAUDE Abonnemang", createdAt: "", rows: 4 }];
    window.history.replaceState(null, "", "/kategorier?flik=namnregler");
    renderView();
    const list = await screen.findByRole("list", { name: "Namnregler" });
    expect(list).toHaveTextContent("ANTHROPIC* CLAUDE SUB");
    expect(list).toHaveTextContent("CLAUDE Abonnemang");
    expect(list).toHaveTextContent("4 rader");

    await userEvent.type(screen.getByRole("textbox", { name: "Mönster" }), "GITHUB");
    expect(await screen.findByText(/Döper också om 2 rader utan namn: GITHUB, INC\./)).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Namn" }), "GitHub{Enter}");
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/label-rules").at(-1)?.[1]).toEqual({ pattern: "GITHUB", matchType: "contains", label: "GitHub" }));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));

    // The bin asks first.
    await userEvent.click(screen.getByRole("button", { name: "Ta bort namnregeln ANTHROPIC* CLAUDE SUB" }));
    const confirm = await screen.findByRole("dialog");
    expect(confirm).toHaveTextContent("Ta bort namnregeln?");
    expect(callsTo(fetchMock, "DELETE", "/label-rules/1")).toHaveLength(0);
    await userEvent.click(within(confirm).getByRole("button", { name: "Ta bort" }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/label-rules/1")).toHaveLength(1));
    await waitFor(() => expect(list).not.toHaveTextContent("ANTHROPIC"));
  });
});
