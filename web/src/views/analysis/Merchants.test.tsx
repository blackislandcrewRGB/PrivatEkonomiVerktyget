import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../../components/ui/tooltip";
import { PageHeader } from "../../shell/PageHeader";
import { mockApi } from "../../../test/api";
import { AnalysisView } from "./AnalysisView";
import type { MerchantData, Piece } from "./merchants/types";

const piece = (p: Partial<Piece> & { key: string }): Piece => ({ label: null, contactName: null, categoryId: 2, area: null, count: 1, total: 10000, lastDate: "2026-08-01", ...p });
/** Kim's rent the largest, Lidl under two bank texts, Apple one large purchase, and 40 small shops. */
const DATA: MerchantData = {
  pieces: [
    piece({ key: "KIM HYRA", categoryId: 5, count: 12, total: 4_000_000 }),
    piece({ key: "LIDL 271", label: "Lidl", count: 150, total: 1_800_000, area: "EXEMPELSTAD" }),
    piece({ key: "LIDL SVERIGE", label: "Lidl", count: 20, total: 300_000 }),
    piece({ key: "APPLE", categoryId: 6, count: 1, total: 1_400_000 }),
    ...Array.from({ length: 40 }, (_, i) => piece({ key: `BUTIK ${String(i + 1).padStart(2, "0")}`, count: 2, total: 100_000 - i * 1000 })),
  ],
  categories: [
    { id: 1, name: "Mat", parentId: null },
    { id: 2, name: "Livsmedel", parentId: 1 },
    { id: 4, name: "Boende", parentId: null },
    { id: 5, name: "Hyra", parentId: 4 },
    { id: 6, name: "Elektronik", parentId: null },
  ],
  private: { count: 0, total: 0 },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 26, 12));
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/analys?flik=topplista&period=12m");
  mockApi({ "/categories": [], "/analysis/merchants": DATA });
});
const renderPage = () =>
  render(
    <TooltipProvider>
      <PageHeader title="Analys" />
      <AnalysisView openTransactions={() => {}} />
    </TooltipProvider>,
  );
const rows = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);
const bar = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-bar]")!;

describe("Analys › Topplista, Design v2", () => {
  it("shows 15 rows, then 25 more at a time, with a bar against number one: black for it, blue for the rest", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Topplista handlare" });
    expect(rows(table)).toHaveLength(15);
    const [first, lidl] = rows(table);
    expect(first).toHaveTextContent(/^1KHKIM HYRABoende › Hyra1240\s000 kr3\s333 kr$/);
    expect(bar(first).dataset.bar).toBe("1");
    expect(bar(first).firstElementChild).toHaveClass("bg-ink");
    // 21 000 kr of 40 000.
    expect(bar(lidl).dataset.bar).toBe(String(2_100_000 / 4_000_000));
    expect(bar(lidl).firstElementChild).toHaveClass("bg-accent");
    fireEvent.click(screen.getByRole("button", { name: /Visa fler · 28 kvar/ }));
    expect(rows(table)).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: /Visa fler · 3 kvar/ }));
    expect(rows(table)).toHaveLength(43);
    expect(screen.queryByRole("button", { name: /Visa fler/ })).toBeNull();
  });

  it("by average per purchase, a single purchase comes last without a bar", async () => {
    window.history.replaceState(null, "", "/analys?flik=topplista&period=12m&sortera=snitt");
    renderPage();
    const table = await screen.findByRole("table", { name: "Topplista handlare" });
    fireEvent.click(screen.getByRole("button", { name: /Visa fler/ }));
    fireEvent.click(screen.getByRole("button", { name: /Visa fler/ }));
    const last = rows(table).at(-1)!;
    expect(last).toHaveTextContent("APPLE");
    expect(bar(last).dataset.bar).toBe("none");
    expect(rows(table)[0]).toHaveTextContent("KIM HYRA");
  });

  it("the note says how 'Slå ihop' merges, with the merged rows as examples, and what Din del counts", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Topplista handlare" });
    const note = screen.getByTestId("share-note");
    expect(note).toHaveTextContent(/^”Slå ihop” använder namnreglerna: rader med samma namn räknas som en handlare \(Lidl\)\. Din del: egna köp fullt/);
    fireEvent.click(screen.getByRole("switch", { name: /Slå ihop samma handlare/ }));
    expect(note).toHaveTextContent(/^”Slå ihop” är av: varje text från banken är en egen handlare\. Din del:/);
    expect(localStorage.getItem("analysis.merchants.merge")).toBe("false");
    expect(screen.getAllByTestId("share-note")).toHaveLength(1);
  });

  /** Every row, all pages shown. */
  const allRows = async () => {
    const table = await screen.findByRole("table", { name: "Topplista handlare" });
    for (let more = screen.queryByRole("button", { name: /Visa fler/ }); more; more = screen.queryByRole("button", { name: /Visa fler/ })) fireEvent.click(more);
    return rows(table);
  };
  const names = (rs: HTMLElement[]) => rs.map((r) => within(r).getAllByRole("button")[0].querySelector(".font-medium")!.textContent);
  const totalOf = (rs: HTMLElement[]) => rs.reduce((s, r) => s + Number(r.dataset.total), 0);

  it("merging gives the same total as the list per bank text, with one row fewer for Lidl's two texts", async () => {
    renderPage();
    const merged = await allRows();
    const all = DATA.pieces.reduce((s, p) => s + p.total, 0);
    expect(totalOf(merged)).toBe(all);
    expect(merged).toHaveLength(43);
    fireEvent.click(screen.getByRole("switch", { name: /Slå ihop samma handlare/ }));
    const apart = await allRows();
    expect(apart).toHaveLength(44);
    expect(totalOf(apart)).toBe(all);
    expect(screen.getByText(/· 44 handlare/)).toBeInTheDocument();
  });

  it("a merged row carries 'N namn', and a row per bank text none", async () => {
    renderPage();
    const [, lidl] = await allRows();
    expect(within(lidl).getByText("2 namn")).toHaveAttribute("data-pill", "names");
    expect(lidl).toHaveTextContent("Mat › Livsmedel · 2 namn · Exempelstad");
    expect(document.querySelectorAll("[data-pill=names]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("switch", { name: /Slå ihop samma handlare/ }));
    expect(document.querySelectorAll("[data-pill=names]")).toHaveLength(0);
    expect(names((await allRows()).slice(0, 4))).toEqual(["KIM HYRA", "Lidl", "APPLE", "Lidl"]);
  });

  it("orders by sum, purchases or average per purchase, in the address", async () => {
    renderPage();
    expect(names((await allRows()).slice(0, 3))).toEqual(["KIM HYRA", "Lidl", "APPLE"]);
    await userEvent.click(screen.getByRole("radio", { name: "Antal köp" }));
    expect(window.location.search).toContain("sortera=antal");
    expect(names((await allRows()).slice(0, 3))).toEqual(["Lidl", "KIM HYRA", "BUTIK 01"]);
    await userEvent.click(screen.getByRole("radio", { name: "Snitt per köp" }));
    const bySnitt = await allRows();
    // Kim 3 333 kr a purchase, the shops 500 kr down to 305 kr, Lidl 124 kr, Apple's single purchase last.
    expect(names(bySnitt.slice(0, 2))).toEqual(["KIM HYRA", "BUTIK 01"]);
    expect(names(bySnitt.slice(-2))).toEqual(["Lidl", "APPLE"]);
  });

  it("the category filter keeps the purchases in a main category and its subcategories", async () => {
    renderPage();
    await allRows();
    const chip = () => document.querySelector<HTMLElement>("[data-chip=category]")!;
    expect(chip()).toHaveTextContent(/^Kategori$/);
    await userEvent.click(chip());
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mat" }));
    expect(window.location.search).toContain("kategori=1");
    const food = await allRows();
    expect(food).toHaveLength(41);
    expect(names(food.slice(0, 2))).toEqual(["Lidl", "BUTIK 01"]);
    expect(chip()).toHaveTextContent(/^Mat$/);
    expect(chip()).toHaveAttribute("data-active", "true");
    await userEvent.click(chip());
    await userEvent.click(await screen.findByRole("menuitem", { name: "Hyra" }));
    expect(names(await allRows())).toEqual(["KIM HYRA"]);
  });

  it("the top three are the list's first three, in whatever order and category", async () => {
    renderPage();
    const top = () => [...document.querySelectorAll<HTMLElement>("[data-top]")].map((c) => c.querySelector("[data-name]")!.textContent);
    const first = names((await allRows()).slice(0, 3));
    expect(top()).toEqual(first);
    await userEvent.click(screen.getByRole("radio", { name: "Antal köp" }));
    expect(top()).toEqual(["Lidl", "KIM HYRA", "BUTIK 01"]);
    expect(top()).toEqual(names((await allRows()).slice(0, 3)));
    // A search narrows the list but not the places.
    await userEvent.type(screen.getByLabelText("Sök handlare"), "sverige");
    expect(names(await allRows())).toEqual(["Lidl"]);
    expect(top()).toEqual(["Lidl", "KIM HYRA", "BUTIK 01"]);
  });
});
