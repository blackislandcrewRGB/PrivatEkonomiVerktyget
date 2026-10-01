import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ParsedReceipt, Receipt, Transaction } from "../../api";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { TxReceipt } from "./TxReceipt";

const LIDL = { id: 1, descriptionClean: "LIDL", amount: -19253, bookingDate: "2026-09-15" } as unknown as Transaction;

const PARSED: ParsedReceipt = {
  store: "lidl",
  storeArea: "Exempelstad, Exempelvägen 1",
  receiptDate: null,
  purchaseDate: "2026-09-15",
  purchaseTime: null,
  totalOre: 19253,
  sumOre: 19253,
  balances: true,
  statedItemCount: null,
  source: "text",
  rawText: "…",
  lines: [
    { kind: "item", name: "RFA Färsk apelsinj", quantityMilli: null, unit: null, unitPriceOre: null, totalOre: 2990 },
    { kind: "discount", name: "Lidl Plus-rabatt", quantityMilli: null, unit: null, unitPriceOre: null, totalOre: -1000 },
    { kind: "item", name: "Havredryck Barista", quantityMilli: 2000, unit: "st", unitPriceOre: 1561, totalOre: 3122 },
    { kind: "item", name: "Resten av kvittot", quantityMilli: null, unit: null, unitPriceOre: null, totalOre: 14141 },
  ],
  transaction: { id: 1, bookingDate: "2026-09-15", transactionDate: "2026-09-15", descriptionClean: "LIDL", amountOre: 19253, matchesTotal: true, hasReceipt: false },
};

const SAVED: Receipt = {
  id: 5,
  transactionId: 1,
  store: "lidl",
  storeArea: "Exempelstad, Exempelvägen 1",
  purchaseDate: "2026-09-15",
  purchaseTime: null,
  totalOre: 19253,
  statedItemCount: null,
  source: "text",
  createdAt: "2026-09-20T09:00:00Z",
  updatedAt: "2026-09-20T09:00:00Z",
  deletedAt: null,
  lines: PARSED.lines.map((l, i) => ({ ...l, id: i + 1, receiptId: 5, position: i, nameKey: l.name.toLowerCase() })),
};

let fetchMock: ReturnType<typeof mockApi>;
const changed = vi.fn();

/** ⌘V with text on the clipboard, the way the shops' pages give a receipt. */
const pasteText = (text: string) =>
  fireEvent.paste(document, { clipboardData: { getData: () => text, files: [], types: ["text/plain"] } });

function setup(receipt: Receipt | null = null) {
  changed.mockClear();
  fetchMock = mockApi({
    "GET /receipts/transaction/1": () => receipt,
    "POST /receipts/parse": PARSED,
    "POST /receipts": SAVED,
    "DELETE /receipts/5": { ok: true },
    "POST /receipts/5/restore": SAVED,
  });
  return render(
    <TooltipProvider>
      <TxReceipt row={LIDL} onChanged={changed} />
      <Toaster />
    </TooltipProvider>,
  );
}

describe("Kvitto i transaktionspanelen", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("reads a pasted receipt and shows the rows before anything is stored", async () => {
    setup();
    expect(await screen.findByText(/Klistra in kvittotexten/)).toBeInTheDocument();

    pasteText("Lidl Plus-rabatt … en lång kvittotext");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("Namn rad 1")).toHaveValue("RFA Färsk apelsinj");
    // Swedish writes a real minus sign; typing a plain hyphen works just as well.
    expect(dialog.getByLabelText("Belopp rad 2")).toHaveValue("−10,00");
    // The count the receipt gave is shown, but isn't something to type in.
    expect(dialog.getByText("2 st à 15,61")).toBeInTheDocument();
    expect(dialog.getByText("Raderna stämmer med kvittot")).toBeInTheDocument();
    // Read, not stored.
    expect(callsTo(fetchMock, "POST", "/receipts").filter(([u]) => !u.includes("parse"))).toHaveLength(0);

    await userEvent.click(dialog.getByRole("button", { name: "Spara kvitto" }));
    const [[, body]] = callsTo(fetchMock, "POST", "/receipts").filter(([u]) => !u.includes("parse"));
    expect(body).toMatchObject({ transactionId: 1, store: "lidl", totalOre: 19253 });
    expect((body as { lines: unknown[] }).lines).toHaveLength(4);
    expect(await screen.findByText(/Kvittot från Lidl är inlagt/)).toBeInTheDocument();
    expect(changed).toHaveBeenCalled();
  });

  it("won't save rows that no longer add up to the receipt's total", async () => {
    setup();
    pasteText("Lidl Plus-rabatt … en lång kvittotext");
    const dialog = within(await screen.findByRole("dialog"));

    const amount = dialog.getByLabelText("Belopp rad 1");
    await userEvent.clear(amount);
    await userEvent.type(amount, "10,00");
    expect(dialog.getByText("Raderna stämmer inte med kvittot")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Spara kvitto" })).toBeDisabled();
    // 192,53 − 29,90 + 10,00 = 172,63
    expect(dialog.getByText(/172,63.*av.*192,53/)).toBeInTheDocument();

    // Putting it back makes the rows add up again, and Spara comes back.
    await userEvent.clear(amount);
    await userEvent.type(amount, "29,90");
    expect(dialog.getByRole("button", { name: "Spara kvitto" })).toBeEnabled();
  });

  it("lets a badly read name be corrected, and sends the correction", async () => {
    setup();
    pasteText("Lidl Plus-rabatt … en lång kvittotext");
    const dialog = within(await screen.findByRole("dialog"));
    const name = dialog.getByLabelText("Namn rad 1");
    await userEvent.clear(name);
    await userEvent.type(name, "Färsk apelsinjuice");
    await userEvent.click(dialog.getByRole("button", { name: "Spara kvitto" }));

    const [[, body]] = callsTo(fetchMock, "POST", "/receipts").filter(([u]) => !u.includes("parse"));
    expect((body as { lines: { name: string }[] }).lines[0].name).toBe("Färsk apelsinjuice");
  });

  it("leaves a pasted picture alone: that one is the merchant's icon", async () => {
    setup();
    await screen.findByText(/Klistra in kvittotexten/);
    const image = new File(["x"], "bild.png", { type: "image/png" });
    fireEvent.paste(document, { clipboardData: { getData: () => "", files: [image], types: ["Files"] } });
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/receipts/parse")).toHaveLength(0));
  });

  it("shows a receipt that is already in, and removes it with Ångra", async () => {
    setup(SAVED);
    expect(await screen.findByText("RFA Färsk apelsinj")).toBeInTheDocument();
    expect(screen.getByText("Lidl · 15/9")).toBeInTheDocument();
    // No paste box while there is a receipt.
    expect(screen.queryByText(/Klistra in kvittotexten/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Ta bort kvittot"));
    expect(callsTo(fetchMock, "DELETE", "/receipts/5")).toHaveLength(1);
    expect(await screen.findByText("Kvittot är borttaget.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ångra" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/receipts/5/restore")).toHaveLength(1));
  });
});
