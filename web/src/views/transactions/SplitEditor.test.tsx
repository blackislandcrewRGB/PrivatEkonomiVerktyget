import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Category, Transaction } from "../../api";
import { reloadCategories } from "../../categories";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { SplitEditor, checkDrafts } from "./SplitEditor";

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
const CATEGORIES = [cat(1, "Mat"), cat(2, "Livsmedel", 1), cat(4, "Prylar & hem"), cat(5, "Elektronik", 4), cat(6, "Överföringar", null, { isTransfer: true })];

const row: Transaction = {
  id: 7,
  source: "swedbank",
  accountId: 1,
  bookingDate: "2026-09-17",
  transactionDate: "2026-09-17",
  descriptionClean: "Amazon",
  label: null,
  counterparty: "Amazon",
  counterpartyName: null,
  merchantArea: null,
  cardMasked: null,
  amount: -12990,
  currency: "SEK",
  categoryId: 5,
  categorySource: "rule",
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
  splits: null,
};

const drafts = (...list: [number | null, string][]) => list.map(([categoryId, text]) => ({ categoryId, text }));

describe("what the parts have to add up to", () => {
  it("gives the rest to the one line left empty", () => {
    const { parts, error } = checkDrafts(drafts([5, ""], [2, "30"]), -12990);
    expect(error).toBeNull();
    expect(parts).toEqual([
      { categoryId: 5, amount: -9990 },
      { categoryId: 2, amount: -3000 },
    ]);
  });

  it("says what is missing, and what is too much", () => {
    expect(checkDrafts(drafts([5, "99,90"], [2, "20"]), -12990).error).toMatch(/10,00.*inte fördelade/);
    expect(checkDrafts(drafts([5, "99,90"], [2, "40"]), -12990).error).toMatch(/10,00.*för mycket/);
  });

  it("refuses two empty lines, a missing category, the same category twice and junk", () => {
    expect(checkDrafts(drafts([5, ""], [2, ""]), -12990).error).toMatch(/Bara en del kan ta resten/);
    expect(checkDrafts(drafts([5, "30"], [null, ""]), -12990).error).toMatch(/kategori för varje del/);
    expect(checkDrafts(drafts([5, "30"], [5, ""]), -12990).error).toMatch(/står två gånger/);
    expect(checkDrafts(drafts([5, "abc"], [2, ""]), -12990).error).toMatch(/Skriv beloppen som tal/);
  });

  it("keeps the row's sign, so money in is split as money in", () => {
    const { parts } = checkDrafts(drafts([5, "30"], [2, ""]), 12990);
    expect(parts).toEqual([
      { categoryId: 5, amount: 3000 },
      { categoryId: 2, amount: 9990 },
    ]);
  });
});

describe("the split editor", () => {
  let fetchMock: ReturnType<typeof mockApi>;
  beforeEach(async () => {
    fetchMock = mockApi({
      "/categories": CATEGORIES,
      "PUT /transactions/7/splits": { splits: [], transaction: row },
    });
    await reloadCategories();
  });

  it("sends the parts, with the empty line taking the rest", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <>
        <SplitEditor row={row} onSaved={onSaved} onCancel={vi.fn()} />
        <Toaster />
      </>,
    );
    // Two lines: the row's own category, and one to choose.
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    // Transfers can't be a part, so they aren't offered.
    expect(screen.queryByRole("option", { name: "Överföringar" })).not.toBeInTheDocument();

    await user.selectOptions(selects[1], "2");
    await user.type(screen.getByLabelText("Belopp för del 2"), "30");
    // The empty line shows what is left over.
    expect(screen.getByLabelText("Belopp för del 1")).toHaveAttribute("placeholder", "99,90");

    await user.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(callsTo(fetchMock, "PUT", "/transactions/7/splits")[0][1]).toEqual({
      parts: [
        { categoryId: 5, amount: -9990 },
        { categoryId: 2, amount: -3000 },
      ],
    });
  });

  it("won't save until the parts add up", async () => {
    const user = userEvent.setup();
    render(<SplitEditor row={row} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();
    expect(screen.getByText(/kategori för varje del/)).toBeInTheDocument();

    await user.selectOptions(screen.getAllByRole("combobox")[1], "2");
    await user.type(screen.getByLabelText("Belopp för del 1"), "100");
    await user.type(screen.getByLabelText("Belopp för del 2"), "10");
    expect(screen.getByText(/19,90.*inte fördelade/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();
  });

  it("starts from the parts a split purchase already has", () => {
    render(<SplitEditor row={{ ...row, splits: [{ categoryId: 5, amount: -9990 }, { categoryId: 2, amount: -3000 }] }} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Belopp för del 1")).toHaveValue("99,90");
    expect(screen.getByLabelText("Belopp för del 2")).toHaveValue("30");
    expect(screen.getByText(/Delarna blir 129,90/)).toBeInTheDocument();
  });
});
