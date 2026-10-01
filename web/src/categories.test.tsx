import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { Category } from "./api";

const MAT: Category = { id: 8, name: "Mat", parentId: null, color: "#16a34a", isTransfer: false, isSettlement: false, systemKey: null };

/** fetch('/api/categories') fails the first `failures` times, then answers. */
function categoriesApi(failures: number) {
  let calls = 0;
  const fetchMock = vi.fn(async () => {
    calls++;
    if (calls <= failures) return new Response("", { status: 502, statusText: "Bad Gateway" });
    return new Response(JSON.stringify([MAT]), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// The list lives in module state: a fresh module per test.
async function load() {
  vi.resetModules();
  const store = await import("./categories");
  const { CategoryChip } = await import("./components/CategoryChip");
  return { ...store, CategoryChip };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the shared category list", () => {
  it("waits 1, 2, 4 … s between tries, at most 30 s", async () => {
    const { retryDelay } = await load();
    expect([1, 2, 3, 4, 5, 6, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it("loads again after a failed first load instead of staying empty", async () => {
    const fetchMock = categoriesApi(2);
    const { CategoryChip } = await load();
    render(<CategoryChip categoryId={8} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("Saknar kategori")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saknar kategori")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Mat")).toBeInTheDocument();

    // Loaded: no more tries.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never rejects, so a caller awaiting it isn't broken by a failed load", async () => {
    categoriesApi(1);
    const { reloadCategories } = await load();
    await expect(reloadCategories()).resolves.toBeUndefined();
  });

  it("does not keep trying when no view uses the list", async () => {
    const fetchMock = categoriesApi(5);
    const { reloadCategories } = await load();
    await reloadCategories();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("CategoryChip without the list", () => {
  it("shows the name it was given instead of 'Saknar kategori'", async () => {
    categoriesApi(99);
    const { CategoryChip } = await load();
    render(<CategoryChip categoryId={8} fallbackName="Mat" short />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("Mat").parentElement).not.toHaveClass("text-warning");
    expect(screen.queryByText("Saknar kategori")).toBeNull();
  });

  it("still says 'Saknar kategori' for a row without category", async () => {
    categoriesApi(0);
    const { CategoryChip } = await load();
    render(<CategoryChip categoryId={null} fallbackName="Utan kategori" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("Saknar kategori")).toBeInTheDocument();
  });
});

describe("Den här månaden without the list", () => {
  it("names every row by the overview's own names, in both modes", async () => {
    categoriesApi(99);
    vi.resetModules();
    const { MonthBars } = await import("./views/overview/MonthBars");
    const row = (categoryId: number, name: string, current: number) => ({ categoryId, name, color: "#16a34a", current, average: 0 });
    const data = {
      today: "2026-09-21",
      month: { day: 21, categories: [row(8, "Mat", 120000)], household: [row(8, "Mat", 240000), row(24, "Nöje", 50000)] },
    } as unknown as Parameters<typeof MonthBars>[0]["data"];
    const { rerender } = render(<MonthBars data={data} share="household" onOpen={() => {}} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("Mat")).toBeInTheDocument();
    expect(screen.getByText("Nöje")).toBeInTheDocument();
    expect(screen.queryByText("Saknar kategori")).toBeNull();
    rerender(<MonthBars data={data} share="mine" onOpen={() => {}} />);
    expect(screen.getByText("Mat")).toBeInTheDocument();
    expect(screen.queryByText("Saknar kategori")).toBeNull();
  });
});
