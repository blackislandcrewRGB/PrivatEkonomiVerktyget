import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../../components/ui/tooltip";
import { PageHeader } from "../../shell/PageHeader";
import { callsTo, mockApi } from "../../../test/api";
import { AnalysisView } from "./AnalysisView";

const line = (key: string, name: string, a: number, b: number, parentKey: string | null = null) => ({ key, categoryId: Number(key) || null, parentKey, name, a, b, diff: a - b, pct: b ? (a - b) / Math.abs(b) : null });
const ROWS = [line("8", "Bil", 1_130_800, 345_800), line("28", "Prylar & hem", 525_600, 151_600), line("1", "Mat", 417_600, 531_400), line("18", "Nöje", 28_200, 134_000), line("13", "Resor", 105_000, 194_100), line("33", "IT & tele", 47_400, 47_400)];
const sum = (k: "a" | "b") => ROWS.reduce((s, r) => s + r[k], 0);
/** Answers as the server does: A and B from the query, and swapped when asked for the other way round. */
const answer = (url: string) => {
  const q = new URL(`http://x${url}`).searchParams;
  const flip = q.get("aFrom")! < q.get("bFrom")!;
  const rows = flip ? ROWS.map((r) => line(r.key, r.name, r.b, r.a)) : ROWS;
  const [a, b] = flip ? [sum("b"), sum("a")] : [sum("a"), sum("b")];
  return { a: { from: q.get("aFrom"), to: q.get("aTo") }, b: { from: q.get("bFrom"), to: q.get("bTo") }, rows, total: line("total", "Totalt", a, b), days: { a: 31, b: 31 } };
};

let fetchMock: ReturnType<typeof mockApi>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 26, 12));
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/analys?flik=jamfor");
  fetchMock = mockApi({ "/categories": [], "/analysis/compare": answer });
});
const renderPage = () =>
  render(
    <TooltipProvider>
      <PageHeader title="Analys" />
      <AnalysisView openTransactions={() => {}} />
    </TooltipProvider>,
  );

describe("Analys › Jämför perioder, Design v2", () => {
  it("August against July by default; the hero is the total's Δ with the four largest differences", async () => {
    renderPage();
    const delta = await screen.findByTestId("compare-delta");
    expect(callsTo(fetchMock, "GET", "/analysis/compare").at(-1)![0]).toContain("aFrom=2026-08-01&aTo=2026-08-31&bFrom=2026-07-01&bTo=2026-07-31");
    expect(delta).toHaveTextContent(/^\+8\s503 kr$/);
    expect(delta).toHaveAttribute("data-tone", "more");
    expect(delta).toHaveClass("text-caution-text");
    expect([...document.querySelectorAll<HTMLElement>("[data-largest]")].map((p) => p.dataset.largest)).toEqual(["8", "28", "1", "18"]);
    // The total row's Δ is the same.
    expect(document.querySelector('[data-row="total"] [data-diff]')).toHaveAttribute("data-diff", String(sum("a") - sum("b")));
  });

  it("the quick choices set B, and stand in the address", async () => {
    renderPage();
    await screen.findByTestId("compare-delta");
    await userEvent.click(screen.getByRole("button", { name: "Samma förra året" }));
    expect(window.location.search).toBe("?flik=jamfor&a=2026-08&b=ifjol");
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/analysis/compare").at(-1)![0]).toContain("bFrom=2025-08-01&bTo=2025-08-31"));
    await userEvent.click(screen.getByRole("button", { name: "Snitt 12 mån" }));
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/analysis/compare").at(-1)![0]).toMatch(/bFrom=2025-08-01&bTo=2026-07-31.*bScale=0\.083/));
    expect(screen.getByRole("button", { name: "Byt A och B" })).toBeDisabled();
  });

  it("⇄ swaps A and B, and Δ changes sign", async () => {
    renderPage();
    await screen.findByTestId("compare-delta");
    await userEvent.click(screen.getByRole("button", { name: "Byt A och B" }));
    expect(window.location.search).toBe("?flik=jamfor&a=2026-07&b=2026-08");
    await waitFor(() => expect(screen.getByTestId("compare-delta")).toHaveTextContent(/^−8\s503 kr$/));
    expect(screen.getByTestId("compare-delta")).toHaveAttribute("data-tone", "less");
  });

  it("largest difference first or the categories' order, remembered; rows at ±0 grey", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Per kategori" });
    const order = () => [...table.querySelectorAll<HTMLElement>("tbody tr[data-row]")].map((r) => r.dataset.row).filter((k) => k !== "total");
    expect(order()).toEqual(["8", "28", "1", "18", "13", "33"]);
    await userEvent.click(screen.getByRole("radio", { name: "Kategoriordning" }));
    expect(order()).toEqual(["8", "28", "1", "18", "13", "33"].sort((x, y) => ROWS.findIndex((r) => r.key === x) - ROWS.findIndex((r) => r.key === y)));
    expect(JSON.parse(localStorage.getItem("analysis.compare.order")!)).toBe("category");
    expect(within(table.querySelector('[data-row="33"]') as HTMLElement).getByText("±0")).toHaveAttribute("data-tone", "even");
  });
});
