import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { callsTo, mockApi } from "../../../test/api";
import { Receipts } from "./Receipts";

/**
 * Kvitton i Pendling & bränsle.
 *
 * The form's job is to catch a mistyped receipt while it is still on screen:
 * price times litres less the discount has to be what the bank charged. What
 * the tests hold is that it says so, both when it adds up and when it does
 * not, and that nothing is saved in the second case.
 */

const plain = (text: string) => text.replace(/\s/g, " ").replace(/−/g, "-");

const MISSING = [{ id: 21, date: "2026-09-10", amountOre: 102_500, description: "CIRCLE K EXEMPELSTAD" }];
const FILLS = [
  { id: 1, transactionId: 21, date: "2026-07-24", litresE2: 4_000, listPriceOre: 1_850, discountOre: 1_000, amountOre: 73_000, station: "Circle K Exempelstad", note: null },
];

let data: { fills: typeof FILLS; missing: typeof MISSING };
let fetchMock: ReturnType<typeof mockApi>;

beforeEach(() => {
  data = { fills: FILLS, missing: MISSING };
  fetchMock = mockApi({
    "GET /fuel/fills": () => data,
    "POST /fuel/fills": { id: 2 },
    "DELETE /fuel/fills": { ok: true },
  });
});

const renderIt = () => render(<Receipts onChanged={vi.fn()} onError={vi.fn()} />);

describe("kvittolistan", () => {
  it("shows what was paid per litre and what the discount was worth", async () => {
    renderIt();
    const list = await screen.findByRole("list", { name: "Kvitton" });
    const row = within(list).getByText("Circle K Exempelstad").closest("li")!;
    expect(plain(row.textContent!)).toContain("40,00 l");
    // 730,00 kr over 40,00 l is 18,25 kr/l — 25 öre under the pump's 18,50.
    expect(plain(row.textContent!)).toContain("18,25 kr/l");
    expect(plain(row.textContent!)).toContain("-25 öre/l");
  });

  it("lists the fill-ups that have no receipt yet as chips, each opening the receipt form", async () => {
    renderIt();
    const list = await screen.findByRole("list", { name: "Tankningar utan kvitto" });
    const chip = within(list).getByRole("button", { name: /CIRCLE K EXEMPELSTAD/ });
    expect(plain(chip.textContent!)).toBe("Utan kvitto: 10 sep CIRCLE K EXEMPELSTAD 1 025 kr · lägg till");
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Liter")).toBeInTheDocument();
  });

  it("has a chip for each fill-up the server lists without a receipt, no more and no less", async () => {
    data = {
      fills: FILLS,
      missing: [
        { id: 7, date: "2026-08-02", amountOre: 91_500, description: "OKQ8 EXEMPELVIK" },
        { id: 8, date: "2026-09-22", amountOre: 78_400, description: "CIRCLE K EXEMPELSTAD" },
        { id: 9, date: "2026-09-03", amountOre: 69_900, description: "CIRCLE K EXEMPELS" },
      ],
    };
    renderIt();
    const list = await screen.findByRole("list", { name: "Tankningar utan kvitto" });
    expect(within(list).getAllByRole("button").map((b) => plain(b.textContent!))).toEqual([
      "Utan kvitto: 2 aug OKQ8 EXEMPELVIK 915 kr · lägg till",
      "22 sep CIRCLE K EXEMPELSTAD 784 kr · lägg till",
      "3 sep CIRCLE K EXEMPELS 699 kr · lägg till",
    ]);
  });

  it("shows the 8 latest receipts, and all on request", async () => {
    data = { fills: Array.from({ length: 11 }, (_, i) => ({ ...FILLS[0], id: i + 1, date: `2026-07-${String(20 - i).padStart(2, "0")}` })), missing: [] };
    renderIt();
    const list = await screen.findByRole("list", { name: "Kvitton" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(8);
    await userEvent.click(screen.getByRole("button", { name: "Visa alla 11 ›" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(11);
  });
});

describe("att lägga in ett kvitto", () => {
  it("checks the receipt against the bank while it is typed, and saves it", async () => {
    renderIt();
    await userEvent.click(await screen.findByRole("button", { name: /Kvitto/ }));

    // Half typed: nothing is claimed yet, and the amount to match is stated.
    expect(plain(screen.getByText(/Beloppet är/).textContent!)).toContain("1 025,00 kr");

    await userEvent.type(screen.getByLabelText("Liter"), "50,00");
    await userEvent.type(screen.getByLabelText("Literpris"), "20,80");
    // Without the discount the receipt does not add up, and it says by how much.
    expect(plain(screen.getByText(/men banken drog/).textContent!)).toContain("1 040,00 kr, men banken drog 1 025,00 kr (+15,00 kr)");
    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Rabatt"), "15,00");
    expect(plain(screen.getByText(/stämmer med banken/).textContent!)).toContain("Betalt 20,50 kr/l, 30 öre/l under pumppriset");

    await userEvent.click(screen.getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/fuel/fills")).toHaveLength(1));
    expect(callsTo(fetchMock, "POST", "/fuel/fills")[0][1]).toMatchObject({
      date: "2026-09-10",
      litresE2: 5_000,
      listPriceOre: 2_080,
      discountOre: 1_500,
      amountOre: 102_500,
      transactionId: 21,
    });
  });

  it("will not save a receipt that does not add up", async () => {
    renderIt();
    await userEvent.click(await screen.findByRole("button", { name: /Kvitto/ }));
    // The litres mistyped: 5,00 instead of 50,00.
    await userEvent.type(screen.getByLabelText("Liter"), "5,00");
    await userEvent.type(screen.getByLabelText("Literpris"), "20,80");
    expect(screen.getByRole("button", { name: "Spara" })).toBeDisabled();
    expect(callsTo(fetchMock, "POST", "/fuel/fills")).toEqual([]);
  });
});

describe("att ta bort ett kvitto", () => {
  it("asks the server and reloads", async () => {
    renderIt();
    await userEvent.click(await screen.findByRole("button", { name: /Ta bort kvittot 2026-07-24/ }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/fuel/fills/1")).toHaveLength(1));
  });
});
