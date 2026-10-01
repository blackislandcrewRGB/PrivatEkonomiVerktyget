import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SharedFigures, SharedMonth } from "../../api";
import { reloadCategories } from "../../categories";
import { TooltipProvider } from "../../components/ui/tooltip";
import { Toaster } from "../../components/Toast";
import { PageHeader } from "../../shell/PageHeader";
import { callsTo, mockApi } from "../../../test/api";
import { SharedView } from "./SharedView";
import { settlementSummary } from "./summary";

// This month in local time, as the view picks it (UTC is last month 00–02 on the 1st).
const MONTH = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
const figures = (o: Partial<SharedFigures> = {}): SharedFigures => ({
  iPaid: 1270000,
  partnerPaid: 0,
  iPaidForPartner: 0,
  partnerPaidForMe: 0,
  fromPartner: 0,
  toPartner: 10000,
  carryIn: 0,
  half: 635000,
  result: 645000,
  ...o,
});
const row = (id: number, description: string, amount: number, categoryId: number | null = 1) => ({
  id,
  date: `${MONTH}-10`,
  payDate: `${MONTH}-25`,
  paid: false,
  description,
  amount,
  categoryId,
});
function month(o: Partial<SharedMonth> = {}): SharedMonth {
  return {
    month: MONTH,
    today: `${MONTH}-19`,
    partnerName: "Mio",
    ownName: null,
    startMonth: "2026-01",
    beforeStart: false,
    carryFrom: null,
    iPaid: {
      total: 1270000,
      groups: [
        { key: "norwegian:x", kind: "norwegian", label: "Bank Norwegian", payDate: `${MONTH}-25`, periodEnd: `${MONTH}-15`, total: 520000, paidTotal: 0, rows: [row(1, "ICA", 520000)] },
        { key: "recurring", kind: "recurring", label: "Fasta utgifter", total: 750000, paidTotal: 0, rows: [row(2, "Hyra", 750000, null)] },
      ],
    },
    partnerPaid: { total: 0, rows: [] },
    forPartner: { total: 0, rows: [] },
    forMe: { total: 0, rows: [] },
    swishCandidates: {},
    transfers: { fromPartner: { total: 0, rows: [], excluded: [] }, toPartner: { total: 10000, rows: [row(3, "Swish skickad", 10000, 2)], excluded: [] } },
    live: figures(),
    sofar: figures(),
    nextPayDate: `${MONTH}-25`,
    payDay: `${MONTH}-25`,
    settlement: null,
    deviates: false,
    monthNotOver: true,
    incompleteImports: [],
    warnings: [],
    history: [
      { month: "2026-07", result: -640000, status: "even", note: "Kvitt", deviates: false },
      { month: MONTH, result: 645000, status: "open", note: null, deviates: false },
    ],
    ...o,
  };
}

describe("the summary to send", () => {
  it("adds up the kinds, halves, and says who swishes", () => {
    expect(settlementSummary(month()).replace(/ /g, " ")).toMatch(
      /^\S+: Norwegian 5 200 \+ fasta 7 500 = 12 700 delat, hälften 6 350\. Jag har swishat dig 100 kr\. Du swishar 6 450 kr\.$/,
    );
    const even = month({ live: figures({ toPartner: 0, result: 0, half: 0, iPaid: 0 }), iPaid: { total: 0, groups: [] } });
    expect(settlementSummary(even)).toMatch(/inget delat, hälften 0\. Vi är jämna\.$/);
    const owe = month({ live: figures({ result: -50000, carryIn: -700000 }), carryFrom: { month: "2026-07", reconciled: true, settledEven: false } });
    expect(settlementSummary(owe).replace(/ /g, " ")).toMatch(/Från juli: jag är skyldig 7 000 kr\. Jag swishar dig 500 kr\.$/);
  });
});

let fetchMock: ReturnType<typeof mockApi>;
beforeEach(async () => {
  window.history.replaceState(null, "", "/delad-ekonomi");
  fetchMock = mockApi({
    "/categories": [
      { id: 1, name: "Mat", parentId: null, color: "#117733", isTransfer: false, isSettlement: false, systemKey: null },
      { id: 2, name: "Till partner", parentId: null, color: "#AA4499", isTransfer: false, isSettlement: true, systemKey: "to_partner" },
    ],
    "GET /shared/": () => month(),
    "POST /transactions": { id: 9 },
    "PUT /shared": () => month(),
  });
  await reloadCategories();
});

function renderView() {
  return render(
    <TooltipProvider>
      <PageHeader title="Delad ekonomi" />
      <SharedView />
      <Toaster />
    </TooltipProvider>,
  );
}

describe("Delad ekonomi", () => {
  it("shows the result with its direction, the calculation and the last months", async () => {
    renderView();
    expect(await screen.findByText("Mio ska betala dig", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Att betala den 25/" + Number(MONTH.slice(5)))).toBeInTheDocument();
    const history = screen.getByRole("heading", { name: "Senaste avstämningarna" }).nextElementSibling as HTMLElement;
    expect(within(history).getByText("avstämd, kvitt")).toHaveClass("bg-positive-soft");
    expect(within(history).getByText("öppen")).toHaveClass("bg-accent-soft");
    // The shown month is ringed in blue.
    expect(within(history).getByRole("button", { current: "page" })).toHaveClass("ring-accent");
    await userEvent.click(within(history).getByText(/Juli/));
    expect(window.location.search).toBe("?manad=2026-07");
  });

  it("copies a summary to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderView();
    await userEvent.click(await screen.findByRole("button", { name: /Kopiera sammanfattning/ }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/Du swishar 6 450 kr\.$/));
    expect(await screen.findByText("Sammanfattningen är kopierad.")).toBeInTheDocument();
  });

  it("'Mio har betalat' is a side panel (N) that adds a purchase she paid", async () => {
    renderView();
    await screen.findByText("Mio ska betala dig", { selector: "p" });
    await userEvent.keyboard("n");
    const panel = await screen.findByRole("dialog", { name: "Mio har betalat" });
    await userEvent.type(within(panel).getByText("Beskrivning").nextElementSibling as HTMLElement, "Apotek");
    await userEvent.type(within(panel).getByText("Belopp (kr)").nextElementSibling as HTMLElement, "120");
    await userEvent.click(within(panel).getByRole("radio", { name: /Bara mitt/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Lägg till" }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST", "/transactions")[0][1]).toMatchObject({ label: "Apotek", amount: -12000, paidBy: "partner", forOther: true }),
    );
  });

  it("says what the figures are missing in an orange box, with Importera › to the imports", async () => {
    fetchMock = mockApi({
      "/categories": [],
      "GET /shared/": () => month({ incompleteImports: [{ source: "mastercard", importedTo: `${MONTH}-18` }], warnings: ["Spotify räknas troligen dubbelt."] }),
    });
    renderView();
    const box = await screen.findByRole("list", { name: "Att känna till" });
    expect(box).toHaveClass("bg-caution-soft");
    expect(box).toHaveTextContent(`Mastercard är importerad till och med 18/${Number(MONTH.slice(5))}. Senare köp saknas (reserverade köp importeras inte).`);
    expect(within(box).getAllByRole("button", { name: "Importera ›" })).toHaveLength(1);
    await userEvent.click(within(box).getByRole("button", { name: "Importera ›" }));
    expect(window.location.pathname).toBe("/importer");
  });

  it("sets the month the running balance counts from, next to the last months", async () => {
    fetchMock = mockApi({ "/categories": [], "GET /shared/": () => month(), "PUT /shared/start": { month: "2026-03" } });
    renderView();
    const line = (await screen.findByText(/Löpande saldo räknas från/)).closest("p")!;
    expect(line).toHaveTextContent(/Löpande saldo räknas från januari 2026 · ändra/);
    expect(line).toHaveAttribute("title", "Månader före det för inget vidare.");
    // On the same row as the cards.
    expect(screen.getByRole("heading", { name: "Senaste avstämningarna" }).parentElement).toContainElement(line);
    await userEvent.click(within(line).getByRole("button", { name: "ändra" }));
    const field = within(line).getByLabelText("Startmånad");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "2026-03" } });
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/shared/start")).toEqual([["/api/shared/start", { month: "2026-03" }]]));
  });

  const hero = () => screen.getByRole("heading", { name: /Att betala den|Resultat för/ }).closest("section")!;
  const serve = (m: SharedMonth) => {
    fetchMock = mockApi({ "/categories": [], "GET /shared/": () => m });
  };
  const settled = (o: Partial<SharedMonth["settlement"] & object> = {}) => ({ ...figures(), note: null, settledAt: "2026-09-26T10:00:00Z", carryForward: false, ...o });

  it("the hero's pill says how the month stands: open, avstämd kvitt, förd över or avviker", async () => {
    const cases: [Partial<SharedMonth>, string, string][] = [
      [{}, `${new Date(`${MONTH}-01T00:00:00`).toLocaleDateString("sv-SE", { month: "long" })} · öppen`, "bg-accent-soft"],
      [{ settlement: settled() }, "avstämd, kvitt", "bg-positive-soft"],
      [{ settlement: settled({ carryForward: true }) }, "förd över", "bg-card-inset"],
      [{ settlement: settled(), deviates: true, live: figures({ result: 800000 }) }, "avviker", "bg-alarm-soft"],
    ];
    for (const [o, label, tone] of cases) {
      serve(month(o));
      const { unmount } = renderView();
      await screen.findByText("Mio ska betala dig", { selector: "p" });
      const pill = hero().querySelector("[data-state]") as HTMLElement;
      expect(pill).toHaveTextContent(label);
      expect(pill).toHaveClass(tone);
      unmount();
    }
  });

  it("the arrow points to whoever gets the money, and there is none when you are even", async () => {
    serve(month({ ownName: "Kim" }));
    const first = renderView();
    await screen.findByText("Mio ska betala dig", { selector: "p" });
    expect(hero().querySelector("[data-direction]")).toHaveAttribute("data-direction", "to-me");
    expect(hero()).toHaveTextContent("← pengarna går åt det här hållet");
    // The initials: mine from Ditt namn, hers from her name.
    expect(hero().querySelector('[data-person="Jag"]')).toHaveTextContent(/^KJaglagt ut 12\s700 kr$/);
    expect(hero().querySelector('[data-person="Mio"]')).toHaveTextContent(/^MMiolagt ut 0 kr$/);
    first.unmount();

    serve(month({ live: figures({ result: -50000 }) }));
    const second = renderView();
    await screen.findByText("Du ska betala Mio", { selector: "p" });
    expect(hero().querySelector("[data-direction]")).toHaveAttribute("data-direction", "to-partner");
    expect(hero()).toHaveTextContent("pengarna går åt det här hållet →");
    expect(hero().querySelector('[data-person="Jag"]')).toHaveTextContent(/^J/);
    second.unmount();

    serve(month({ live: figures({ result: 0 }) }));
    renderView();
    await screen.findByText("Ni är jämna", { selector: "p" });
    expect(hero().querySelector("[data-direction]")).toBeNull();
    expect(hero()).toHaveTextContent("ni är kvitt");
  });

  it("the receipt's lines add up to its last line", async () => {
    const f = figures({ iPaid: 1539343, partnerPaid: 120000, iPaidForPartner: 30000, fromPartner: 200000, toPartner: 10000, carryIn: -55800 });
    const half = Math.round((f.iPaid - f.partnerPaid) / 2);
    const result = half + f.iPaidForPartner - f.partnerPaidForMe - f.fromPartner + f.toPartner + f.carryIn;
    serve(month({ live: { ...f, half, result }, carryFrom: { month: "2026-07", reconciled: true, settledEven: true } }));
    renderView();
    const receipt = (await screen.findByRole("heading", { name: "Uträkning" })).closest("section")!;
    const lines = [...receipt.querySelectorAll<HTMLElement>("[data-line]")];
    const value = (key: string) => Number(lines.find((l) => l.dataset.line === key)!.dataset.ore);
    // The first two make the half; from there each line's operator applies.
    expect(Math.round((value("iPaid") - value("partnerPaid")) / 2)).toBe(value("half"));
    const after = lines.slice(lines.findIndex((l) => l.dataset.line === "half") + 1).filter((l) => l.dataset.line !== "result");
    const sum = after.reduce((s, l) => s + (l.dataset.sign === "−" ? -1 : 1) * Number(l.dataset.ore), value("half"));
    expect(sum).toBe(result);
    expect(value("result")).toBe(Math.abs(result));
    expect(lines.at(-1)).toHaveClass("border-ink");
    expect(within(receipt).getByText("avstämd, kvitt")).toHaveClass("text-ink-3");
  });
});

