import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transaction } from "../../api";
import { callsTo, mockApi } from "../../../test/api";
import { DeletedList } from "./DeletedList";
import type { PageContext } from "./TransactionsPage";

const ROW = {
  id: 12,
  bookingDate: "2026-09-14",
  descriptionClean: "ICA MAXI",
  amount: -24900,
  accountId: 1,
  deletedAt: "2026-09-20T09:00:00Z",
} as unknown as Transaction;

// DeletedList only reaches for the accounts, the toast and the counts.
const notify = vi.fn();
const refreshCounts = vi.fn();
const ctx = { accounts: [{ id: 1, name: "Privatkonto" }], notify, refreshCounts } as unknown as PageContext;

let fetchMock: ReturnType<typeof mockApi>;
let rows: Transaction[];

beforeEach(() => {
  rows = [ROW];
  notify.mockClear();
  refreshCounts.mockClear();
  fetchMock = mockApi({
    "GET /transactions": () => ({ rows, truncated: false, totals: { count: rows.length, in: 0, out: 0 } }),
    "POST /transactions/12/forget": () => {
      rows = [];
      return { forgotten: true };
    },
    "POST /transactions/12/restore": () => {
      rows = [];
      return ROW;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Borttagna", () => {
  it("forgets a row after asking first, and the row leaves the list", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DeletedList ctx={ctx} />);
    await userEvent.click(await screen.findByRole("button", { name: /Glöm/ }));

    expect(confirm.mock.calls[0][0]).toContain("ICA MAXI");
    // formatKr writes a narrow no-break space before 'kr'.
    expect(confirm.mock.calls[0][0]).toMatch(/249,00\skr/);
    expect(callsTo(fetchMock, "POST", "/transactions/12/forget")).toHaveLength(1);
    expect(await screen.findByText("Inga borttagna rader.")).toBeInTheDocument();
    expect(refreshCounts).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({ text: "Raden är glömd." });
  });

  it("does nothing when the question is answered no", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DeletedList ctx={ctx} />);
    await userEvent.click(await screen.findByRole("button", { name: /Glöm/ }));

    expect(callsTo(fetchMock, "POST", "/transactions/12/forget")).toHaveLength(0);
    expect(screen.getByText("ICA MAXI")).toBeInTheDocument();
  });

  it("still restores, which is the other way out", async () => {
    render(<DeletedList ctx={ctx} />);
    await userEvent.click(await screen.findByRole("button", { name: /Återställ/ }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/transactions/12/restore")).toHaveLength(1));
    expect(notify).toHaveBeenCalledWith({ text: "Raden är återställd." });
  });
});
