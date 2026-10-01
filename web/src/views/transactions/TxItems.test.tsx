import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Item, ItemSuggestion, Transaction } from "../../api";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { ItemDialogHost, closeItemDialog } from "../items/ItemDialogHost";
import { TxItems } from "./TxItems";

const AMAZON: Transaction = {
  id: 1,
  source: "swedbank",
  accountId: 1,
  bookingDate: "2026-08-31",
  transactionDate: "2026-08-31",
  descriptionClean: "AMAZON EU",
  label: null,
  counterparty: "AMAZON EU",
  counterpartyName: null,
  merchantArea: null,
  cardMasked: null,
  amount: -449000,
  currency: "SEK",
  categoryId: 2,
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
};

const SUGGESTION: ItemSuggestion = {
  transactionId: 1,
  name: "AMAZON EU",
  merchant: "AMAZON EU",
  priceOre: 449000,
  purchaseDate: "2026-08-31",
  bookedDate: "2026-08-31",
  category: "Elektronik",
  icon: null,
  categoryOptions: ["Elektronik", "Frakt", "Inredning & verktyg", "Kläder"],
};

const RING: Item = {
  id: 7,
  name: "Ovalring Gen 4",
  category: "Elektronik",
  purchaseDate: "2026-08-31",
  priceOre: 449000,
  merchant: "Amazon",
  purchaseUrl: null,
  note: null,
  owner: "me",
  status: "owned",
  warrantyMonths: 24,
  returnDeadline: null,
  soldPriceOre: null,
  soldDate: null,
  createdAt: "2026-09-20T09:00:00Z",
  updatedAt: "2026-09-20T09:00:00Z",
  deletedAt: null,
  warrantyEndsOn: "2028-08-31",
  cover: null,
  attachmentCount: 0,
  transactionIds: [],
  icon: null,
  merchantName: "Amazon",
};

let fetchMock: ReturnType<typeof mockApi>;
const changed = vi.fn();

function renderItems(row: Transaction = AMAZON) {
  return render(
    <TooltipProvider>
      <TxItems row={row} onChanged={changed} />
      {/* The dialog belongs to the app, not to the panel: Att göra opens the same one. */}
      <ItemDialogHost />
      <Toaster />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  changed.mockClear();
  // The dialog is app-wide state; a test that left it open must not reach the next.
  closeItemDialog();
  fetchMock = mockApi({
    "/settings": { partnerSwishNumbers: [], partnerName: "Mio" },
    "GET /items/suggest/": SUGGESTION,
    "GET /items": { items: [RING], totals: { count: 1, priceOre: 449000, soldOre: 0 }, years: ["2026"], categories: ["Elektronik"], categoryOptions: SUGGESTION.categoryOptions },
    "POST /items/7/transactions": { transactionIds: [1] },
    "DELETE /items/7/transactions/1": { transactionIds: [] },
    "POST /items": (_: string, init: { json?: unknown }) => ({ ...RING, ...(init.json as object) }),
  });
});

describe("prylar in the transaction panel", () => {
  it("opens the dialog filled in from the row, and saves what the thing actually is", async () => {
    renderItems();
    await userEvent.click(screen.getByRole("button", { name: "Skapa pryl" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /Ny pryl/ })).toBeInTheDocument();
    // Filled from the transaction: the price positive, the date, the merchant,
    // and the category only because the row sits under Prylar & hem.
    const price = within(dialog).getByLabelText("Pris (kr)") as HTMLInputElement;
    expect(price.value.replace(/\s/g, "")).toBe("4490,00");
    expect(within(dialog).getByLabelText("Inköpsdatum")).toHaveValue("2026-08-31");
    expect(within(dialog).getByLabelText("Handlare")).toHaveValue("AMAZON EU");
    expect(within(dialog).getByLabelText("Kategori")).toHaveValue("Elektronik");

    const name = within(dialog).getByLabelText("Vad är det?");
    await userEvent.clear(name);
    await userEvent.type(name, "Ovalring Gen 4");
    await userEvent.type(within(dialog).getByLabelText("Garanti (månader)"), "24");
    await userEvent.click(within(dialog).getByRole("button", { name: "Spara" }));

    await waitFor(() => expect(callsTo(fetchMock, "POST", "/items")).toHaveLength(1));
    expect(callsTo(fetchMock, "POST", "/items")[0][1]).toMatchObject({
      name: "Ovalring Gen 4",
      priceOre: 449000,
      purchaseDate: "2026-08-31",
      merchant: "AMAZON EU",
      category: "Elektronik",
      warrantyMonths: 24,
      owner: "me",
      transactionIds: [1],
    });
    expect(await screen.findByText("Ovalring Gen 4 är inlagd.")).toBeInTheDocument();
    expect(changed).toHaveBeenCalled();
  });

  // A Swish sent on Saturday is booked on Monday: the lists show the Monday,
  // the pryl is dated the Saturday, and the dialog says so instead of leaving
  // the difference to be puzzled over.
  it("keeps the day the thing was bought, and says when the bank booked it", async () => {
    fetchMock = mockApi({
      "/settings": { partnerSwishNumbers: [], partnerName: "Mio" },
      "GET /items/suggest/": { ...SUGGESTION, name: "Swish Exempelshop", merchant: "Exempelshop", priceOre: 7500, purchaseDate: "2026-09-12", bookedDate: "2026-09-14", category: null },
      "POST /items": (_: string, init: { json?: unknown }) => ({ ...RING, ...(init.json as object) }),
    });
    renderItems();
    await userEvent.click(screen.getByRole("button", { name: "Skapa pryl" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Inköpsdatum")).toHaveValue("2026-09-12");
    expect(within(dialog).getByText("Bokfördes 14/9")).toBeInTheDocument();

    // Set it to the booking day and there is nothing left to explain.
    fireEvent.change(within(dialog).getByLabelText("Inköpsdatum"), { target: { value: "2026-09-14" } });
    expect(within(dialog).queryByText(/Bokfördes/)).not.toBeInTheDocument();
  });

  it("refuses a name-less pryl and a price that isn't a number, without sending anything", async () => {
    renderItems();
    await userEvent.click(screen.getByRole("button", { name: "Skapa pryl" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.clear(within(dialog).getByLabelText("Vad är det?"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
    expect(await within(dialog).findByText("Prylen behöver ett namn.")).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText("Vad är det?"), "Ring");
    await userEvent.clear(within(dialog).getByLabelText("Pris (kr)"));
    await userEvent.type(within(dialog).getByLabelText("Pris (kr)"), "fyra tusen");
    await userEvent.click(within(dialog).getByRole("button", { name: "Spara" }));
    expect(await within(dialog).findByText(/Skriv priset som ett tal/)).toBeInTheDocument();
    expect(callsTo(fetchMock, "POST", "/items")).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole("button", { name: "Avbryt" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("links the row to a pryl that already exists, and unlinks it again", async () => {
    renderItems();
    await userEvent.click(screen.getByRole("button", { name: "Koppla till pryl" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Sök pryl"), "oval");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Ovalring Gen 4/ }));

    await waitFor(() => expect(callsTo(fetchMock, "POST", "/items/7/transactions")).toEqual([["/api/items/7/transactions", { transactionId: 1 }]]));
    expect(await screen.findByText("Kopplad till Ovalring Gen 4.")).toBeInTheDocument();

    // The row now knows about it, as the list's reload would give it.
    renderItems({ ...AMAZON, items: [{ id: 7, name: "Ovalring Gen 4" }] });
    await userEvent.click(screen.getAllByLabelText("Koppla bort Ovalring Gen 4")[0]);
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/items/7/transactions/1")).toHaveLength(1));
  });

  // The file picker only offers the types it takes; a drop can carry anything.
  it("keeps a dropped file it can't use out of the upload", async () => {
    renderItems({ ...AMAZON, items: [{ id: 7, name: "Ovalring Gen 4" }] });
    const zone = screen.getByText("Dra hit kvitto eller bild").closest("div")!;
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["inte en bild"], "anteckning.txt", { type: "text/plain" })] } });
    expect(await screen.findByText(/Bara JPG, PNG, WebP, HEIC eller PDF/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("attachments"))).toHaveLength(0);
  });
});
