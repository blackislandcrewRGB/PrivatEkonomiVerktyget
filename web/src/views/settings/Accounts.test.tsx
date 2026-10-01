import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account, BankStatus, BankSyncReport } from "../../api";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { Accounts } from "./Accounts";

const account = (id: number, name: string): Account => ({
  id,
  name,
  balance: 0,
  balanceUpdatedAt: null,
  note: null,
  kind: "bank",
  source: "swedbank",
  trackBalance: true,
  accountRef: null,
  clearing: null,
});
const ACCOUNTS = [account(1, "Swedbank Privatkonto"), account(2, "Swedbank e-sparkonto")];

const status = (over: Partial<BankStatus["connections"][number]["accounts"][number]> = {}): BankStatus => ({
  configured: true,
  syncing: false,
  syncHours: [6, 12, 18],
  banks: ["Swedbank", "Bank Norwegian"],
  connections: [
    {
      id: 1,
      bank: "Swedbank",
      status: "active",
      validUntil: "2027-03-18T10:00:00+00:00",
      daysLeft: 180,
      expiresSoon: false,
      authorizedAt: "2026-09-19T12:00:00Z",
      lastSyncAt: null,
      lastError: null,
      accounts: [
        { id: 10, maskedRef: "••1234", product: "Privatkonto", accountId: 1, accountName: "Swedbank Privatkonto", lastBookingDate: null, lastSyncAt: null, pending: { count: 0, amount: 0 }, ...over },
        { id: 11, maskedRef: "••7777", product: "Sparkonto", accountId: null, accountName: null, lastBookingDate: null, lastSyncAt: null, pending: { count: 0, amount: 0 } },
      ],
    },
  ],
});
const REPORT = (dryRun: boolean): BankSyncReport => ({
  at: "2026-09-19T12:00:00Z",
  dryRun,
  connections: [
    {
      id: 1,
      bank: "Swedbank",
      status: "active",
      error: null,
      accounts: [
        { bankAccountId: 10, maskedRef: "••1234", accountId: 1, accountName: "Swedbank Privatkonto", from: null, pages: 7, fetched: 672, booked: 668, pending: 4, other: 0, rowsNew: 3, rowsLinked: 665, rowsSkipped: 0, transfersPaired: 0, balance: null, error: null },
      ],
    },
  ],
});

let current: BankStatus;
let fetchMock: ReturnType<typeof mockApi>;
beforeEach(() => {
  current = status();
  window.history.replaceState(null, "", "/installningar");
  fetchMock = mockApi({
    "GET /enable-banking/status": () => current,
    "POST /enable-banking/sync": (_: string, init: { json?: unknown }) => REPORT((init.json as { dryRun?: boolean }).dryRun === true),
    "PUT /enable-banking/bank-accounts": { ok: true },
    "POST /enable-banking/connect": { url: "https://auth.enablebanking.com/ais/start?sessionid=x" },
  });
});

const renderCard = () =>
  render(
    <>
      <Accounts accounts={ACCOUNTS} onChanged={vi.fn()} match={() => true} />
      <Toaster />
    </>,
  );

describe("Inställningar › Konton och bankkopplingar", () => {
  it("shows the consent and the accounts; an unmatched account gets one chosen; the other bank can be connected", async () => {
    renderCard();
    const bank = await waitFor(() => {
      const e = document.querySelector("[data-bank=Swedbank]") as HTMLElement | null;
      expect(e).not.toBeNull();
      return e!;
    });
    expect(bank).toHaveTextContent(/samtycket gäller till 18 mars 2027 \(180 dagar kvar\)/);
    expect(bank).toHaveTextContent(/senaste synk aldrig/);
    const row = document.querySelector("[data-account='1']") as HTMLElement;
    expect(row.querySelector("[data-link]")).toHaveTextContent("Enable Banking · aktivinte synkat än");
    // A bank account that feeds nothing here is shown with its choice, outside Ändra too.
    await userEvent.selectOptions(screen.getByLabelText("Konto här för Swedbank ••7777"), "Swedbank e-sparkonto");
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/enable-banking/bank-accounts/11")).toEqual([["/api/enable-banking/bank-accounts/11", { accountId: 2 }]]));
    expect(screen.getByRole("button", { name: /Koppla Bank Norwegian/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Koppla Swedbank/ })).toBeNull();
  });

  it("the first sync is previewed (linked, new, pending) and only fetched after Hämta", async () => {
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: /Synka nu/ }));
    const dialog = await screen.findByRole("dialog", { name: "Första hämtningen" });
    expect(dialog).toHaveTextContent("668 bokförda, 665 länkas till befintliga, 3 nya, 4 reserverade");
    expect(callsTo(fetchMock, "POST", "/enable-banking/sync")).toEqual([["/api/enable-banking/sync", { dryRun: true }]]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Hämta" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/enable-banking/sync").at(-1)).toEqual(["/api/enable-banking/sync", { dryRun: false }]));
    expect(await screen.findByText(/Swedbank Privatkonto: 3 nya, 665 länkade/)).toBeInTheDocument();
  });

  it("once synced, Synka nu fetches straight away; pending rows show as not counted yet", async () => {
    current = status({ lastBookingDate: "2026-09-18", pending: { count: 2, amount: -45000 } });
    renderCard();
    await waitFor(() => expect(document.querySelector("[data-account='1'] [data-link]")).toHaveTextContent("hämtat t.o.m. 18 sep · 2 reserverade räknas inte"));
    await userEvent.click(screen.getByRole("button", { name: /Synka nu/ }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/enable-banking/sync")).toEqual([["/api/enable-banking/sync", { dryRun: false }]]));
  });

  it("back from the bank: the outcome from the address as a message, and the address cleaned", async () => {
    window.history.replaceState(null, "", "/installningar?bank=fel&meddelande=Swedbank%3A%20Cancelled%20by%20user#banks");
    renderCard();
    expect(await screen.findByText("Swedbank: Cancelled by user")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});
