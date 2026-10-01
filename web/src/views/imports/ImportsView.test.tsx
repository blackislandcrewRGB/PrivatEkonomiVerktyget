import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { todayIso } from "../../lib/today";
import { PageHeader } from "../../shell/PageHeader";
import { callsTo, mockApi } from "../../../test/api";
import { ImportsView } from "./ImportsView";

const wrap = (title: string, node: React.ReactNode) =>
  render(
    <TooltipProvider>
      <PageHeader title={title} />
      {node}
      <Toaster />
    </TooltipProvider>,
  );
const page = (imports: unknown[], older: unknown = null) => ({ imports, older });

describe("Importer", () => {
  let fetchMock: ReturnType<typeof mockApi>;
  const old = new Date(Date.parse(todayIso()) - 50 * 86_400_000).toISOString().slice(0, 10);
  beforeEach(() => {
    fetchMock = mockApi({
      "/accounts": [],
      "/imports/coverage": [
        { accountId: 1, name: "Swedbank Privatkonto", kind: "bank", source: "swedbank", importedTo: todayIso(), importedAt: null, via: "file", syncedAt: null, lastInvoiceTo: null, nextInvoiceTo: null },
        { accountId: 4, name: "Bank Norwegian", kind: "credit_card", source: "norwegian", importedTo: old, importedAt: null, via: "enable_banking", syncedAt: null, lastInvoiceTo: null, nextInvoiceTo: null },
      ],
      "GET /imports": page([
        { id: 2, source: "swedbank", filename: "Uttag.csv", periodFrom: "2026-08-01", periodTo: "2026-09-18", importedAt: "2026-09-18T18:06:00Z", rowsTotal: 10, rowsNew: 10, rowsSkipped: 0, via: "file", undo: { ok: true, rows: 10, statement: false } },
        { id: 1, source: "swedbank", filename: "Insattningar.csv", periodFrom: "2026-08-01", periodTo: "2026-09-18", importedAt: "2026-09-18T18:05:00Z", rowsTotal: 5, rowsNew: 5, rowsSkipped: 0, via: "file", undo: { ok: false, reason: "En senare import från samma bank har rört samma konto." } },
      ]),
      "DELETE /imports": { removed: 10 },
    });
  });

  it("a card per account: how far it is imported, the gap in colour, a status dot and how it gets its data", async () => {
    wrap("Importer", <ImportsView onImported={() => {}} />);
    const list = await screen.findByRole("list", { name: "Senast importerat per konto" });
    const [privat, norwegian] = within(list).getAllByRole("listitem");
    expect(privat).toHaveTextContent(/t\.o\.m\. \d+\/\d+/);
    expect(privat).toHaveTextContent("inget glapp");
    expect(privat).toHaveTextContent("CSV, manuellt");
    expect(privat).toHaveAttribute("data-health", "ok");
    expect(within(privat).getByRole("img", { name: "i fas" })).toBeInTheDocument();
    expect(norwegian).toHaveTextContent("50 dagars glapp");
    expect(norwegian).toHaveTextContent("Enable Banking");
    expect(norwegian).toHaveAttribute("data-health", "overdue");
  });

  it("'Ångra' asks first, then removes the import; others say why they can't be undone", async () => {
    wrap("Importer", <ImportsView onImported={() => {}} />);
    const row = (await screen.findByText("Uttag.csv")).closest("li")!;
    expect(within(screen.getByText("Insattningar.csv").closest("li")!).getByLabelText("kan inte ångras")).toHaveAttribute(
      "title",
      "Kan inte ångras: En senare import från samma bank har rört samma konto.",
    );
    await userEvent.click(within(row).getByRole("button", { name: "Ångra" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("10 rader tas bort helt");
    await userEvent.click(within(dialog).getByRole("button", { name: /Ångra importen/ }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/imports/2")).toHaveLength(1));
    expect(await screen.findByText(/Importen av Uttag.csv är ångrad: 10 rader borttagna/)).toBeInTheDocument();
  });

  it("rent notices, three at a time: previewed with what they do to the rent, imported and undone", async () => {
    const notice = (n: number, month: string, due: string, amount: number, alreadyImported = false) => ({
      filename: `Avi-${n}.pdf`,
      index: n - 1,
      ok: true,
      alreadyImported,
      result: {
        source: "rent_notice",
        dryRun: true,
        filename: `Avi-${n}.pdf`,
        importId: null,
        period: { from: `${month}-01`, to: `${month}-31` },
        account: { id: 2, name: "Swedbank e-sparkonto" },
        notice: { issuer: "Exempel Förvaltning AB", number: String(n), noticeDate: "2026-09-11", dueDate: due, rentMonth: month, period: due.slice(0, 7), amount, lines: [{ text: "Hyra", amount }], bankgiro: "123-4567", alreadyImported },
        expense: { id: 8, name: "Hyra", usualAmount: 725000, before: 725000 },
        rowsTotal: 0, rowsNew: 0, rowsSkipped: 0, rowsUncategorized: 0, newRowsPreview: [], possibleDuplicates: [], unmappedMerchantCategories: [], internalTransfers: 0, transferPairs: 0, recurringLinked: 0, recategorized: 0,
      },
    });
    fetchMock = mockApi({
      "/accounts": [],
      "/imports/coverage": [],
      "GET /imports": page([
        { id: 5, source: "rent_notice", filename: "Avi-1.pdf", periodFrom: "2026-10-01", periodTo: "2026-10-31", importedAt: "2026-09-24T08:00:00Z", rowsTotal: 0, rowsNew: 0, rowsSkipped: 0, via: "file", undo: { ok: true, rows: 0, statement: false } },
      ]),
      "DELETE /imports": { removed: 0 },
      "GET /recurring-income/suggestions": [],
      "POST /imports": {
        dryRun: true,
        accounts: [],
        files: [notice(1, "2026-10", "2026-09-30", 725000, true), notice(2, "2026-11", "2026-10-30", 725000), notice(3, "2026-12", "2026-11-30", 750000)],
      },
    });
    wrap("Importer", <ImportsView onImported={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, [1, 2, 3].map((n) => new File(["%PDF"], `Avi-${n}.pdf`, { type: "application/pdf" })));
    const row = (await screen.findByText("Avi-3.pdf")).closest("tr")!;
    expect(row).toHaveTextContent("Hyresavi");
    expect(row).toHaveTextContent("Hyra · Swedbank e-sparkonto");
    expect(row).toHaveTextContent("hyra december 2026");
    expect(row).toHaveTextContent(/7\s500,00\skr · förfaller 30\/11 · nytt belopp/);
    const tableRow = (name: string) => screen.getAllByText(name).map((el) => el.closest("tr")).find(Boolean)!;
    expect(tableRow("Avi-1.pdf")).toHaveTextContent("Redan importerad");
    expect(screen.getByText(/Totalt 0 nya rader/)).toHaveTextContent("2 hyresavier");
    await userEvent.click(row);
    expect(screen.getByTestId("rent-notice")).toHaveTextContent(/Hyra i november 2026 blir 7\s500,00\skr \(var 7\s250,00\skr\)/);

    // The history: a notice is undone like a file, and says what that does.
    const history = screen.getAllByText("Avi-1.pdf").map((el) => el.closest("li")).find(Boolean)!;
    expect(history).toHaveTextContent("hyresavi");
    await userEvent.click(within(history).getByRole("button", { name: "Ångra" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("hyresavin tas bort, och hyrans belopp för månaden går tillbaka");
  });

  it("a tax return receipt: named by its year, shows what it replaces, is sent by its place in the upload and undone from the history", async () => {
    const boxes = (salary: number) => ({ employmentIncome: salary, commuteDeduction: 1_850_000, iskStandardIncome: 98_700, capitalIncome: null, capitalExpenses: null });
    fetchMock = mockApi({
      "/accounts": [],
      "/imports/coverage": [],
      "GET /imports": page([
        { id: 7, source: "tax_return", filename: "Deklarationskvittens 2023.pdf", periodFrom: "2023-01-01", periodTo: "2023-12-31", importedAt: "2026-09-24T08:00:00Z", rowsTotal: 0, rowsNew: 0, rowsSkipped: 0, via: "file", undo: { ok: true, rows: 0, statement: false } },
      ]),
      "DELETE /imports": { removed: 0 },
      "GET /recurring-income/suggestions": [],
      "POST /imports": {
        dryRun: true,
        accounts: [],
        files: [
          {
            filename: "Deklarationskvittens 2024.pdf",
            index: 0,
            ok: true,
            alreadyImported: false,
            result: {
              source: "tax_return",
              dryRun: true,
              filename: "Deklarationskvittens 2024.pdf",
              importId: null,
              period: { from: "2024-01-01", to: "2024-12-31" },
              taxReturn: { incomeYear: 2024, submittedAt: "2025-03-21", boxes: boxes(28_760_000), alreadyImported: false, replaces: { submittedAt: "2025-03-20", source: "manual", boxes: boxes(28_500_000) } },
              rowsTotal: 0, rowsNew: 0, rowsSkipped: 0, rowsUncategorized: 0, newRowsPreview: [], possibleDuplicates: [], unmappedMerchantCategories: [], internalTransfers: 0, transferPairs: 0, recurringLinked: 0, recategorized: 0,
            },
          },
        ],
      },
    });
    wrap("Importer", <ImportsView onImported={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, [new File(["%PDF"], "Kvittens 191212121212 - Inkomstdeklaration 1 2025.pdf", { type: "application/pdf" })]);
    const row = (await screen.findByText("Deklarationskvittens 2024.pdf")).closest("tr")!;
    expect(row).toHaveTextContent("inkomståret 2024");
    expect(row).toHaveTextContent("ersätter inmatat 2024 (20/3 2025)");
    expect(screen.getByText(/Totalt 0 nya rader/)).toHaveTextContent("1 deklarationskvittens");
    await userEvent.click(row);
    const box = screen.getByTestId("tax-return");
    expect(within(box).getByText("Från kvittensen")).toBeInTheDocument();
    expect(box.querySelector('[data-box="1.1"]')).toHaveTextContent(/285\s000 kr.*287\s600 kr/);
    expect(box).toHaveTextContent("Namn, personnummer, kvittensnummer och filen sparas inte.");
    // Renamed after its year, the file is still the one sent.
    await userEvent.click(screen.getByRole("button", { name: "Importera 1 fil" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/imports")).toHaveLength(2));

    const history = screen.getAllByText("Deklarationskvittens 2023.pdf").map((el) => el.closest("li")).find(Boolean)!;
    expect(history).toHaveTextContent("deklaration");
    expect(history).toHaveTextContent("Deklarationskvittens · inkomståret 2023");
    await userEvent.click(within(history).getByRole("button", { name: "Ångra" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("inkomståret går tillbaka till det det var innan kvittensen lästes in");
  });
});

describe("Importer's header and drop zone", () => {
  const connection = (daysLeft: number, validUntil: string) => ({
    id: 1,
    bank: "Swedbank",
    status: "active",
    validUntil,
    daysLeft,
    expiresSoon: daysLeft < 14,
    authorizedAt: null,
    lastSyncAt: null,
    lastError: null,
    accounts: [],
  });
  const withStatus = (status: unknown) =>
    mockApi({ "/accounts": [], "/imports/coverage": [], "GET /imports": page([]), "/enable-banking/status": status });
  beforeEach(() => window.history.replaceState(null, "", "/importer"));

  it("says when the banks are synced and the next run", async () => {
    withStatus({ configured: true, syncing: false, banks: [], syncHours: [6, 12, 18], connections: [connection(174, "2027-03-18T10:00:00Z")] });
    wrap("Importer", <ImportsView onImported={() => {}} />);
    expect(await screen.findByText(/^Banksynk kl 06, 12 och 18 · nästa i (dag|morgon) (06|12|18):00$/)).toBeInTheDocument();
  });

  it("warns instead when a consent runs out within 30 days, with a way to renew it", async () => {
    withStatus({ configured: true, syncing: false, banks: [], syncHours: [6, 12, 18], connections: [connection(174, "2027-03-18T10:00:00Z"), connection(21, "2026-10-16T10:00:00Z")] });
    wrap("Importer", <ImportsView onImported={() => {}} />);
    const warning = await screen.findByText(/Bankkopplingen går ut 16 oktober/);
    expect(screen.queryByText(/nästa i/)).not.toBeInTheDocument();
    await userEvent.click(within(warning).getByRole("button", { name: "förnya" }));
    expect(window.location.pathname).toBe("/installningar");
  });

  it("says nothing without a bank connection", async () => {
    withStatus({ configured: false, syncing: false, banks: [], syncHours: [6, 12, 18], connections: [] });
    wrap("Importer", <ImportsView onImported={() => {}} />);
    await screen.findByText("Inga importer ännu.");
    expect(screen.queryByText(/^Banksynk kl|^Bankkopplingen/)).not.toBeInTheDocument();
  });

  it("the drop zone turns blue while files are dragged over it; 'Välj filer' opens the file picker", async () => {
    withStatus({ configured: false, syncing: false, banks: [], syncHours: [], connections: [] });
    wrap("Importer", <ImportsView onImported={() => {}} />);
    const zone = screen.getByText("Släpp filer här eller klicka").closest("[class*='border-dashed']") as HTMLElement;
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute("data-dragging");
    expect(zone).toHaveClass("border-accent", "bg-accent-soft");
    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveAttribute("data-dragging");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const picked = vi.spyOn(input, "click");
    await userEvent.click(screen.getByRole("button", { name: "Välj filer" }));
    expect(picked).toHaveBeenCalledTimes(1);
  });
});
