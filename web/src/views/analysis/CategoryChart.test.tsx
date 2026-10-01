import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../../components/ui/tooltip";
import { PageHeader } from "../../shell/PageHeader";
import { callsTo, mockApi } from "../../../test/api";
import { AnalysisView } from "./AnalysisView";

const download = vi.fn();
vi.mock("../../csv", async (orig) => ({ ...(await orig<typeof import("../../csv")>()), downloadCsv: (...a: unknown[]) => download(...a) }));

const MAIN = {
  months: ["2026-07", "2026-08", "2026-09"],
  series: [
    { key: "1", categoryId: 1, name: "Mat", color: "#117733" },
    { key: "2", categoryId: 2, name: "Boende", color: "#56B4E9" },
  ],
  data: [
    { month: "2026-07", "1": 400000, "2": 380000, total: 780000 },
    { month: "2026-08", "1": 1000000, "2": 380000, total: 1380000 },
    { month: "2026-09", "1": 100000, "2": 370000, total: 470000 },
  ],
  parent: null,
};
const MAT = {
  months: MAIN.months,
  series: [
    { key: "11", categoryId: 11, name: "Livsmedel", color: "#3d8f55" },
    { key: "12", categoryId: 12, name: "Restaurang & café", color: "#7fb38e" },
  ],
  data: [
    { month: "2026-07", "11": 300000, "12": 100000, total: 400000 },
    { month: "2026-08", "11": 700000, "12": 300000, total: 1000000 },
    { month: "2026-09", "11": 100000, "12": 0, total: 100000 },
  ],
  parent: { id: 1, name: "Mat" },
};

let fetchMock: ReturnType<typeof mockApi>;
beforeEach(() => {
  // Today: 26 September 2026, so September is the month so far.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 26, 12));
  sessionStorage.clear();
  localStorage.clear();
  download.mockClear();
  window.history.replaceState(null, "", "/analys?period=3m");
  fetchMock = mockApi({
    "/categories": [],
    "/analysis/categories": (url: string) => (new URL(`http://x${url}`).searchParams.get("parent") === "1" ? MAT : MAIN),
  });
});

const renderPage = () =>
  render(
    <TooltipProvider>
      <PageHeader title="Analys" />
      <AnalysisView openTransactions={() => {}} />
    </TooltipProvider>,
  );
const figure = (id: string) => document.querySelector(`[data-figure="${id}"]`) as HTMLElement;
const plain = (s: string | null) => (s ?? "").replace(/\s+/g, " ");

describe("Analys › Per kategori, Design v2", () => {
  it("the key figures come from the table: its total, the whole months' average, the largest category, the dearest month", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Utgifter per kategori och månad" });
    // The table's Totalt row, summed: 7 800 + 13 800 + 4 700 kr.
    expect(plain(figure("total").textContent)).toBe("Totalt 3 mån26 300 krmin del · med sep t.o.m. 26/9");
    // July and August are whole: (7 800 + 13 800) / 2; September is left out.
    expect(plain(figure("average").textContent)).toMatch(/10 800 kr.*median 10 800 kr · utan sep/);
    expect(plain(figure("largest").textContent)).toMatch(/Mat15 000 kr · 57 %/);
    expect(plain(figure("dearest").textContent)).toMatch(/aug 202613 800 kr · Mat 10 000/);
    // The table's snitt: the category over the whole months.
    expect(document.querySelector('[data-average="1"]')).toHaveTextContent(/7\s000 kr/);
    expect(document.querySelector('[data-average="total"]')).toHaveTextContent(/10\s800 kr/);
  });

  it("rounds the key figures to the krona as the table does, so the average is the table's snitt", async () => {
    // July 7 800,00 and August 13 801,00 kr: an average of 10 800,50 kr, which the table rounds up.
    fetchMock = mockApi({
      "/categories": [],
      "/analysis/categories": {
        ...MAIN,
        data: [
          { month: "2026-07", "1": 400000, "2": 380000, total: 780000 },
          { month: "2026-08", "1": 1000100, "2": 380000, total: 1380100 },
          { month: "2026-09", "1": 100000, "2": 370000, total: 470000 },
        ],
      },
    });
    renderPage();
    await screen.findByRole("table", { name: "Utgifter per kategori och månad" });
    expect(document.querySelector('[data-average="total"]')).toHaveTextContent(/10\s801 kr/);
    expect(plain(figure("average").textContent)).toMatch(/Snitt per månad10 801 kr.*median 10 801 kr/);
  });

  it("tones against the category's average, none for the month so far; Toner turns them off and is remembered", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Utgifter per kategori och månad" });
    const cell = (k: string) => document.querySelector(`[data-cell="${k}"]`) as HTMLElement;
    // Mat's average 7 000: July 4 000 (57 %) under, August 10 000 (143 %) over, September not toned.
    expect(cell("1:2026-07")).toHaveAttribute("data-heat", "under");
    expect(cell("1:2026-08")).toHaveAttribute("data-heat", "over");
    expect(cell("1:2026-09")).not.toHaveAttribute("data-heat");
    expect(cell("2:2026-07")).not.toHaveAttribute("data-heat");
    expect(screen.getByRole("columnheader", { name: /sep 26\s*påbörjad/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Toner" }));
    expect(cell("1:2026-08")).not.toHaveAttribute("data-heat");
    expect(localStorage.getItem("analysis.tones")).toBe("false");
  });

  it("a legend chip drills into the subcategories, with Tillbaka first; Tillbaka goes back", async () => {
    renderPage();
    const legend = await screen.findByRole("list", { name: "Kategorier" });
    expect(within(legend).getByRole("button", { name: /Mat\s*15,0k/ })).toBeInTheDocument();
    await userEvent.click(within(legend).getByRole("button", { name: /Mat\s*15,0k/ }));
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/analysis/categories").at(-1)![0]).toMatch(/parent=1/));
    const sub = await screen.findByRole("list", { name: "Kategorier" });
    await waitFor(() => expect(within(sub).getAllByRole("listitem")[0]).toHaveTextContent("Tillbaka"));
    expect(within(sub).getByText("Livsmedel")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mat: underkategorier per månad" })).toBeInTheDocument();
    await userEvent.click(within(sub).getByRole("button", { name: /Tillbaka/ }));
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/analysis/categories").at(-1)![0]).not.toMatch(/parent=/));
    expect(await screen.findByRole("heading", { name: "Utgifter per huvudkategori och månad" })).toBeInTheDocument();
  });

  it("drilled into Prylar & hem, the legend offers Visa prylarna, to the Prylar view; other categories don't", async () => {
    const PRYLAR = { ...MAT, parent: { id: 2, name: "Prylar & hem" } };
    fetchMock = mockApi({
      "/categories": [],
      "/analysis/categories": (url: string) => {
        const p = new URL(`http://x${url}`).searchParams.get("parent");
        return p === "1" ? MAT : p === "2" ? PRYLAR : MAIN;
      },
    });
    renderPage();
    const legend = await screen.findByRole("list", { name: "Kategorier" });
    expect(within(legend).queryByRole("button", { name: "Visa prylarna ›" })).toBeNull();
    await userEvent.click(within(legend).getByRole("button", { name: /Mat\s*15,0k/ }));
    await screen.findByRole("heading", { name: "Mat: underkategorier per månad" });
    expect(screen.queryByRole("button", { name: "Visa prylarna ›" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Tillbaka/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Boende/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Visa prylarna ›" }));
    expect(window.location.pathname).toBe("/prylar");
  });

  it("the old Prylar tab leads to Prylar's calendar", async () => {
    window.history.replaceState(null, "", "/analys?flik=prylar");
    renderPage();
    await waitFor(() => expect(window.location.pathname).toBe("/prylar"));
    expect(window.location.search).toBe("?visa=kalender");
    // Eleven tabs, no Prylar among them.
    window.history.replaceState(null, "", "/analys");
  });

  it("Andelar switches the chart to 100 % bars; the total line is off until Totalt is chosen", async () => {
    renderPage();
    await screen.findByRole("list", { name: "Kategorier" });
    expect(screen.getByRole("button", { name: /Totalt/ })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("radio", { name: "Andelar" }));
    expect(document.querySelector("[data-mode]")).toHaveAttribute("data-mode", "shares");
    // No total line with shares.
    expect(screen.queryByRole("button", { name: /^Totalt/ })).toBeNull();
  });

  it("the CSV is as before: the months and the sum per category", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Utgifter per kategori och månad" });
    await userEvent.click(screen.getByRole("button", { name: /CSV/ }));
    expect(download).toHaveBeenCalledWith(
      "kategorier-per-manad",
      ["Kategori", "2026-07", "2026-08", "2026-09", "Summa"],
      [
        ["Mat", "4000,00", "10000,00", "1000,00", "15000,00"],
        ["Boende", "3800,00", "3800,00", "3700,00", "11300,00"],
        ["Totalt", "7800,00", "13800,00", "4700,00", "26300,00"],
      ],
    );
  });
});
