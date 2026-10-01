import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Category } from "../api";
import { reloadCategories } from "../categories";
import { rememberCategory } from "../lib/recentCategories";
import { clearCategorySuggestions, CategoryPicker } from "./CategoryPicker";
import { mockApi } from "../../test/api";

const cat = (id: number, name: string, parentId: number | null = null, extra: Partial<Category> = {}): Category => ({
  id,
  name,
  parentId,
  color: null,
  isTransfer: false,
  isSettlement: false,
  systemKey: null,
  ...extra,
});
const CATEGORIES = [
  cat(1, "Mat"),
  cat(2, "Livsmedel", 1),
  cat(3, "Restaurang & café", 1),
  cat(4, "Nöje"),
  cat(5, "Spel", 4),
  cat(6, "Överföringar", null, { isTransfer: true }),
];

function Harness({ onPick, rowIds = [10], includeTransfers }: { onPick: (c: Category) => void; rowIds?: number[]; includeTransfers?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button id="anchor">ankare</button>
      <CategoryPicker
        open={open}
        onOpenChange={setOpen}
        anchor={document.getElementById("anchor")}
        rowIds={rowIds}
        value={2}
        includeTransfers={includeTransfers}
        onPick={onPick}
      />
    </>
  );
}

beforeEach(async () => {
  localStorage.clear();
  clearCategorySuggestions();
  mockApi({
    "/categories": CATEGORIES,
    "/transactions/category-suggestions": [
      { categoryId: 3, reason: "rule", detail: "Regel: EXEMPELKAFÉ", rows: 1 },
      { categoryId: 5, reason: "history", detail: "2 gånger tidigare", rows: 0 },
    ],
  });
  await reloadCategories();
});

describe("CategoryPicker", () => {
  it("lists the suggestions first with their reason, numbered", async () => {
    render(<Harness onPick={() => {}} />);
    const first = await screen.findByRole("option", { name: /Restaurang & café.*Regel: EXEMPELKAFÉ/ });
    expect(first).toHaveTextContent("1");
    expect(screen.getByRole("option", { name: /Nöje › Spel.*2 gånger tidigare/ })).toHaveTextContent("2");
    expect(screen.getByText("Föreslagna")).toBeInTheDocument();
  });

  it("a digit picks the numbered category while the search is empty", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await screen.findByText("Föreslagna");
    await userEvent.keyboard("2");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 5, name: "Spel" }));
  });

  it("shows recent categories after the suggestions, numbered on", async () => {
    rememberCategory(4);
    render(<Harness onPick={() => {}} />);
    await screen.findByText("Senast använda");
    expect(screen.getByRole("option", { name: /^Nöje\s*3$/ })).toBeInTheDocument();
  });

  it("search (without å/ä/ö) narrows to matching categories and Enter picks", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await screen.findByText("Föreslagna");
    await userEvent.type(screen.getByPlaceholderText("Sök kategori…"), "cafe");
    expect(screen.queryByText("Föreslagna")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Mat › Restaurang & café/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Livsmedel/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });

  it("typing digits into the search types them instead of picking", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await screen.findByText("Föreslagna");
    await userEvent.type(screen.getByPlaceholderText("Sök kategori…"), "s1");
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Sök kategori…")).toHaveValue("s1");
  });

  it("marks the current category, remembers picks, and can leave out transfer categories", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} includeTransfers={false} />);
    await screen.findByText("Föreslagna");
    expect(screen.queryByRole("option", { name: /Överföringar/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /^Nöje$/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("privatekonomi.recentCategories")!)).toEqual([4]));
  });
});
