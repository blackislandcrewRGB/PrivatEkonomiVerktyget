import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImportLog } from "../../../api";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { callsTo, mockApi } from "../../../../test/api";
import { History } from "./History";

const imp = (id: number, filename: string, via: ImportLog["via"], importedAt: string): ImportLog => ({
  id,
  source: filename.endsWith(".pdf") ? "mastercard" : "swedbank",
  filename,
  periodFrom: "2026-09-01",
  periodTo: "2026-09-18",
  importedAt,
  rowsTotal: 3,
  rowsNew: 1,
  rowsSkipped: 2,
  via,
  undo: via === "file" ? { ok: true, rows: 1, statement: false } : { ok: false, reason: "Hämtat från banken." },
});

const FILES = [imp(3, "Faktura.pdf", "file", "2026-09-19T06:10:00Z"), imp(1, "Uttag.csv", "file", "2026-09-18T13:26:00Z")];
const SYNCS = [imp(4, "Enable Banking · Swedbank ••0001", "enable_banking", "2026-09-19T04:00:00Z"), imp(2, "Enable Banking · Swedbank ••0001", "enable_banking", "2026-09-18T16:00:00Z")];
const OLDER = [imp(0, "Augusti.xlsx", "file", "2026-09-10T10:00:00Z")];

describe("Importer's history", () => {
  let fetchMock: ReturnType<typeof mockApi>;
  beforeEach(() => {
    window.history.replaceState(null, "", "/importer");
    fetchMock = mockApi({
      "GET /imports": (url: string) => {
        const q = new URLSearchParams(url.split("?")[1] ?? "");
        if (q.get("before")) return { imports: OLDER, older: null };
        const via = q.get("via");
        const list = [...FILES, ...SYNCS].filter((i) => !via || i.via === via).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
        return { imports: list, older: via === "enable_banking" ? null : { before: "2026-09-18", from: "2026-09-10", count: 1 } };
      },
    });
  });

  const view = () =>
    render(
      <TooltipProvider>
        <History version={0} onUndo={() => {}} />
      </TooltipProvider>,
    );
  const rows = () => screen.getAllByRole("listitem").map((li) => li.getAttribute("data-import") ?? li.getAttribute("data-syncs"));

  it("filters to files or bank syncs, in the URL, fetching only those", async () => {
    view();
    await screen.findByText("Faktura.pdf");
    // All: the files one by one, each older day's syncs as one row.
    expect(rows()).toEqual(["3", "syncs:2026-09-19", "1", "syncs:2026-09-18"]);

    await userEvent.click(screen.getByRole("radio", { name: "Filer" }));
    expect(window.location.search).toBe("?visa=filer");
    await waitFor(() => expect(rows()).toEqual(["3", "1"]));
    expect(callsTo(fetchMock, "GET", "/imports?via=file")).toHaveLength(1);

    await userEvent.click(screen.getByRole("radio", { name: "Banksynkar" }));
    expect(window.location.search).toBe("?visa=banksynkar");
    await screen.findByRole("button", { name: /2 banksynkar/ });
    expect(screen.queryByText("Faktura.pdf")).not.toBeInTheDocument();
    // Two older days with only syncs: one band, one row, folding out to both.
    expect(rows()).toEqual(["syncs:2026-09-19|2026-09-18"]);
    await userEvent.click(screen.getByRole("button", { name: /2 banksynkar/ }));
    expect(rows()).toEqual(["syncs:2026-09-19|2026-09-18", "4", "2"]);

    await userEvent.click(screen.getByRole("radio", { name: "Alla" }));
    expect(window.location.search).toBe("");
  });

  it("starts from the URL's filter", async () => {
    window.history.replaceState(null, "", "/importer?visa=filer");
    view();
    await screen.findByText("Faktura.pdf");
    expect(screen.getByRole("radio", { name: "Filer" })).toHaveAttribute("aria-checked", "true");
    expect(rows()).toEqual(["3", "1"]);
  });

  it("each day's band totals its imports; 'Visa äldre' fetches the next page and adds it", async () => {
    view();
    const band = await screen.findByRole("group", { name: "Lördag 19 september" });
    expect(within(band).getByText(/^1 fil · 1 banksynk · 2 nya · 4 dubbletter$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Visa äldre · 10 september och tidigare (1 import)" }));
    expect(await screen.findByText("Augusti.xlsx")).toBeInTheDocument();
    expect(callsTo(fetchMock, "GET", "/imports?before=2026-09-18")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Visa äldre/ })).not.toBeInTheDocument();
  });
});
