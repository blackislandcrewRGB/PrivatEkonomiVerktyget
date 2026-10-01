import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi } from "../../../test/api";
import type { Account, CsvImportResult, CsvMapping, CsvPreview } from "../../api";
import { CsvImport } from "./CsvImport";

const account = (over: Partial<Account>): Account => ({ id: 1, name: "Exempelbanken Lönekonto", balance: 0, balanceUpdatedAt: null, note: null, kind: "bank", source: "csv", trackBalance: true, accountRef: null, clearing: null, ...over });
const ACCOUNTS = [account({}), account({ id: 2, name: "Swedbank Privatkonto", source: "swedbank" }), account({ id: 3, name: "Utan källa", source: null })];

const MAPPING: CsvMapping = { delimiter: ";", skipLines: 0, hasHeader: true, dateColumn: 0, dateFormat: "iso", textColumn: 1, extraTextColumn: null, amountMode: "signed", amountColumn: 2, outColumn: null, inColumn: null, decimal: ",", outIsNegative: true };
const DRY: CsvImportResult = { dryRun: true, source: "csv", filename: "export.csv", period: { from: "2026-09-01", to: "2026-09-03" }, accountId: 1, rowsTotal: 3, rowsNew: 2, rowsSkipped: 1, rowsLinked: 0, rowsUncategorized: 1, internalTransfers: 0 };
const PREVIEW: CsvPreview = {
  filename: "export.csv",
  encoding: "utf-8",
  mapping: MAPPING,
  origin: "guessed",
  table: { columns: 3, header: ["Datum", "Text", "Belopp"], sample: [["2026-09-03", "ICA SUPERMARKET EXEMPEL", "-245,50"], ["2026-09-02", "LÖN EXEMPELBOLAGET", "24 500,00"]], lines: 3 },
  read: { count: 3, period: { from: "2026-09-01", to: "2026-09-03" }, sample: [{ date: "2026-09-03", text: "ICA SUPERMARKET EXEMPEL", amountOre: -24550 }] },
  dryRun: null,
};

const file = () => new File(["Datum;Text;Belopp\n"], "export.csv", { type: "text/csv" });
const fields = (init: unknown) => Object.fromEntries([...((init as RequestInit).body as FormData).entries()].map(([k, v]) => [k, typeof v === "string" ? v : "(fil)"]));
const posted = (fetchMock: ReturnType<typeof mockApi>, path: string) => fetchMock.mock.calls.filter(([u]) => String(u) === `/api${path}`).map(([, init]) => fields(init));

function open(props: Partial<Parameters<typeof CsvImport>[0]> = {}) {
  const onImported = vi.fn();
  const onNewAccount = vi.fn();
  render(<CsvImport open onOpenChange={() => {}} accounts={ACCOUNTS} onNewAccount={onNewAccount} onImported={onImported} {...props} />);
  return { onImported, onNewAccount };
}

describe("CSV från en annan bank", () => {
  it("offers the accounts a CSV can go to (CSV or nothing yet), previews the guess and imports onto the chosen account", async () => {
    const fetchMock = mockApi({
      "POST /imports/csv/preview": (_: string, init: unknown) => ({ ...PREVIEW, dryRun: fields(init).accountId ? DRY : null }),
      "POST /imports/csv": { ...DRY, dryRun: false },
    });
    const { onImported } = open();
    const select = screen.getByRole("combobox", { name: "Konto" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Välj konto", "Exempelbanken Lönekonto", "Utan källa", "Nytt konto…"]);

    await userEvent.upload(screen.getByLabelText("CSV-fil"), file());
    expect(await screen.findByText(/Kolumnerna är en gissning/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Filens första rader" });
    expect(within(table).getByText("ICA SUPERMARKET EXEMPEL")).toBeInTheDocument();
    // Each column says what it is read as.
    expect(within(table).getAllByText(/^(Datum|Text|Belopp)$/).length).toBeGreaterThanOrEqual(6);
    expect(screen.getByRole("button", { name: "Importera" })).toBeDisabled();

    await userEvent.selectOptions(select, "1");
    await waitFor(() => expect(document.body.textContent).toMatch(/2 nya, 1 finns redan, 1 utan kategori/));
    await userEvent.click(await screen.findByRole("button", { name: "Importera 2 nya" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    const [sent] = posted(fetchMock, "/imports/csv");
    expect(sent).toMatchObject({ file: "(fil)", accountId: "1" });
    expect(JSON.parse(sent.mapping)).toEqual(MAPPING);
  });

  it("a change to the columns is sent as the whole mapping and asked about again", async () => {
    const fetchMock = mockApi({ "POST /imports/csv/preview": PREVIEW });
    open();
    await userEvent.upload(screen.getByLabelText("CSV-fil"), file());
    await screen.findByText(/Kolumnerna är en gissning/);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Decimaltecken" }), ".");
    await screen.findByText("Dina ändringar.", { exact: false });
    await waitFor(() => expect(posted(fetchMock, "/imports/csv/preview").some((f) => f.mapping && JSON.parse(f.mapping).decimal === ".")).toBe(true));
    expect(JSON.parse(posted(fetchMock, "/imports/csv/preview").at(-1)!.mapping)).toEqual({ ...MAPPING, decimal: "." });
  });

  it("says why a file can't be read, line by line, and doesn't offer to import it", async () => {
    mockApi({ "POST /imports/csv/preview": { ...PREVIEW, read: { error: "2 rader gick inte att läsa med de här inställningarna. Inget är importerat.", details: ['Rad 4: går inte att läsa: datumet "i går".'] } } });
    open();
    await userEvent.upload(screen.getByLabelText("CSV-fil"), file());
    expect(await screen.findByText(/2 rader gick inte att läsa/)).toBeInTheDocument();
    expect(screen.getByText(/Rad 4: går inte att läsa/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importera" })).toBeDisabled();
  });

  it("'Nytt konto…' hands over to making one, and an account just made is picked", async () => {
    mockApi({ "POST /imports/csv/preview": PREVIEW });
    const { onNewAccount } = open();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Konto" }), "new");
    expect(onNewAccount).toHaveBeenCalledTimes(1);
  });

  it("with one account to choose from it is already chosen", async () => {
    mockApi({ "POST /imports/csv/preview": { ...PREVIEW, dryRun: DRY } });
    open({ accounts: [ACCOUNTS[0]] });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Konto" })).toHaveValue("1"));
  });
});
