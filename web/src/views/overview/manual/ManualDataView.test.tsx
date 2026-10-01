import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ManualDataItem } from "../../../api";
import { mockApi } from "../../../../test/api";
import { ManualData } from "./ManualDataView";

/**
 * Att fylla i: what is typed in by hand, where it is found, and how old it
 * is. What matters here is that what needs doing stands first and apart,
 * that each row says where the figure comes from and when it was last given,
 * and that the button goes to where it is typed in.
 */

const item = (over: Partial<ManualDataItem>): ManualDataItem => ({
  key: "x",
  group: "Förmögenhet och pension",
  title: "X",
  source: "minpension.se",
  input: "form",
  cadence: "En gång om året",
  asOf: "2026-09-01",
  ageDays: 20,
  enteredOn: "2026-09-01",
  status: "ok",
  note: "",
  link: { view: "overview", search: "?flik=pension" },
  ...over,
});

const ITEMS: ManualDataItem[] = [
  item({ key: "pension_forecast", title: "Pensionsprognosen", asOf: null, ageDays: null, enteredOn: null, status: "never", note: "Ingen prognos inlagd." }),
  item({
    key: "shifts",
    group: "Pendling",
    title: "Arbetspass per månad",
    source: "Arbetsschemat",
    cadence: "Varje månad, gärna i förväg",
    asOf: "2026-09",
    ageDays: null,
    enteredOn: null,
    status: "soon",
    note: "Nästa månads pass är inte ifyllda än.",
    link: { view: "commute" },
  }),
  item({ key: "pension:1", title: "Pension: Pensionsmyndigheten – Inkomstpension", asOf: "2025-11-28", ageDays: 297, enteredOn: "2026-09-20" }),
  item({ key: "tax_table", group: "Lön", title: "Skattetabell 32", source: "Skatteverket (hämtas med en knapp)", input: "fetch", asOf: "2026", ageDays: null, enteredOn: null, link: { view: "settings", anchor: "salary" } }),
  item({ key: "trades", group: "Sparande", title: "Affärer (köp och sälj)", status: "info", asOf: "2026-09-18", ageDays: 3, enteredOn: "2026-09-20" }),
];

const plain = (text: string) => text.replace(/\s/g, " ");

afterEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
});

/** A group's card, opened when it is folded. */
async function openGroup(name: string) {
  const group = await screen.findByRole("region", { name });
  if (group.getAttribute("data-open") !== "true") await userEvent.click(within(group).getByRole("button", { name: new RegExp(`^${name}`) }));
  return screen.getByRole("region", { name });
}

describe("Att fylla i", () => {
  it("puts what needs doing first, and counts it, in a card with a red edge when something is late", async () => {
    mockApi({ "GET /manual-data": ITEMS });
    render(<ManualData />);
    const now = await screen.findByRole("region", { name: "Behöver fyllas i" });
    const text = plain(now.textContent ?? "");
    expect(text).toContain("Pensionsprognosen");
    expect(text).toContain("Arbetspass per månad");
    expect(text).not.toContain("Inkomstpension");
    expect(text).toContain("1 behöver fyllas i · 1 snart dags");
    // The status is a dot, its word the label.
    expect(within(now).getByRole("img", { name: "Aldrig ifylld" })).toBeInTheDocument();
    expect(within(now).getByRole("img", { name: "Snart dags" })).toBeInTheDocument();
    expect(now).toHaveAttribute("data-tone", "late");
    expect(within(now).getAllByRole("button", { name: "Fyll i" })).toHaveLength(2);
  });

  it("has an orange edge when only something is soon due", async () => {
    mockApi({ "GET /manual-data": ITEMS.filter((i) => i.status !== "never") });
    render(<ManualData />);
    expect(await screen.findByRole("region", { name: "Behöver fyllas i" })).toHaveAttribute("data-tone", "soon");
  });

  it("says where each figure comes from, what kind of input it is, and how old it is", async () => {
    mockApi({ "GET /manual-data": ITEMS });
    render(<ManualData />);
    const group = await openGroup("Förmögenhet och pension");
    const text = plain(group.textContent ?? "");
    expect(text).toContain("Från: minpension.se");
    expect(text).toContain("Formulär");
    expect(text).toContain("En gång om året");
    // The day it was true, with the year since it isn't this one, how old, and when it was typed.
    expect(text).toContain("28/11 2025");
    expect(text).toContain("9 mån gammal");
    expect(text).toContain("ifyllt 20/9");
    expect(within(group).getByRole("img", { name: "Aktuell" })).toBeInTheDocument();
    // A yearly figure is shown as its year; one with no clock says so.
    expect(plain((await openGroup("Lön")).textContent ?? "")).toContain("Hämta med knapp");
    expect(within(await openGroup("Sparande")).getByRole("img", { name: "Vid behov" })).toBeInTheDocument();
  });

  it("goes to where the figure is typed in", async () => {
    mockApi({ "GET /manual-data": ITEMS });
    render(<ManualData />);
    const now = await screen.findByRole("region", { name: "Behöver fyllas i" });
    const row = within(now).getByText("Pensionsprognosen").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Fyll i" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/?flik=pension");
    const tax = within(await openGroup("Lön")).getByRole("button", { name: "Fyll i" });
    await userEvent.click(tax);
    expect(window.location.pathname).toBe("/installningar");
  });

  it("folds a group when all in it is up to date, sums it up, and remembers a group opened by hand", async () => {
    const items = [...ITEMS, item({ key: "late", group: "Pendling", title: "Pass", status: "overdue" }), item({ key: "shift2", group: "Pendling", title: "Tankning", status: "ok" })];
    mockApi({ "GET /manual-data": items });
    const { unmount } = render(<ManualData />);
    const pension = await screen.findByRole("region", { name: "Förmögenhet och pension" });
    expect(pension).toHaveAttribute("data-open", "false");
    expect(pension).toHaveTextContent("1 av 1 aktuell");
    expect(pension).toHaveTextContent("äldst 9 mån");
    expect(screen.getByRole("region", { name: "Sparande" })).toHaveTextContent("1 vid behov");
    await userEvent.click(within(pension).getByRole("button", { name: /^Förmögenhet och pension/ }));
    expect(screen.getByRole("region", { name: "Förmögenhet och pension" })).toHaveAttribute("data-open", "true");
    unmount();
    mockApi({ "GET /manual-data": items });
    render(<ManualData />);
    expect(await screen.findByRole("region", { name: "Förmögenhet och pension" })).toHaveAttribute("data-open", "true");
    expect(screen.getByRole("region", { name: "Lön" })).toHaveAttribute("data-open", "false");
    // The note under says so, and what the dots mean.
    expect(screen.getByText(/Grupper där allt är aktuellt/)).toHaveTextContent("grön aktuell, orange snart dags, röd inaktuell eller aldrig ifylld, grå vid behov");
  });

  it("with a status chosen, opens every group with rows and leaves out the rest", async () => {
    window.history.replaceState(null, "", "/?flik=att-fylla-i&status=ok");
    mockApi({ "GET /manual-data": ITEMS });
    render(<ManualData />);
    expect(await screen.findByRole("region", { name: "Förmögenhet och pension" })).toHaveAttribute("data-open", "true");
    expect(screen.getByRole("region", { name: "Lön" })).toHaveAttribute("data-open", "true");
    expect(screen.queryByRole("region", { name: "Sparande" })).toBeNull();
  });

  it("says when all is up to date", async () => {
    mockApi({ "GET /manual-data": ITEMS.filter((i) => i.status === "ok") });
    render(<ManualData />);
    expect(await screen.findByText("Allt är aktuellt.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Behöver fyllas i" })).toBeNull();
  });

  it("filters by status from the address: counts that add up to Alla, only matching rows, no empty groups", async () => {
    window.history.replaceState(null, "", "/?flik=att-fylla-i");
    mockApi({ "GET /manual-data": ITEMS });
    render(<ManualData />);
    const filter = await screen.findByRole("radiogroup", { name: "Visa efter status" });
    const count = (label: string) => plain(within(filter).getByRole("radio", { name: new RegExp(`^${label} ·`) }).textContent ?? "");
    expect([count("Alla"), count("Snart dags"), count("Inaktuell"), count("Aktuell"), count("Vid behov")]).toEqual(["Alla · 5", "Snart dags · 1", "Inaktuell · 1", "Aktuell · 2", "Vid behov · 1"]);
    await userEvent.click(within(filter).getByRole("radio", { name: /^Vid behov/ }));
    expect(window.location.search).toBe("?flik=att-fylla-i&status=info");
    expect(screen.getByRole("region", { name: "Sparande" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Lön" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Behöver fyllas i" })).toBeNull();
    await userEvent.click(within(filter).getByRole("radio", { name: /^Alla/ }));
    expect(window.location.search).toBe("?flik=att-fylla-i");
  });

  it("opens on the status in the address", async () => {
    window.history.replaceState(null, "", "/?flik=att-fylla-i&status=late");
    mockApi({ "GET /manual-data": ITEMS });
    render(<ManualData />);
    const now = await screen.findByRole("region", { name: "Behöver fyllas i" });
    expect(now).toHaveTextContent("Pensionsprognosen");
    expect(now).not.toHaveTextContent("Arbetspass per månad");
    expect(screen.queryByRole("region", { name: "Förmögenhet och pension" })).toBeNull();
  });
});
