import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrivacyContext } from "../privacy";
import { AppShell } from "./AppShell";
import { navigate, viewDef } from "./routes";
import { mockApi } from "../../test/api";

function renderShell() {
  let showPrivate = false;
  return render(
    <PrivacyContext.Provider value={{ showPrivate, setShowPrivate: (v) => (showPrivate = v) }}>
      <AppShell>{(view) => <p data-testid="view">{viewDef(view).label}</p>}</AppShell>
    </PrivacyContext.Provider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  mockApi({
    "/review/counts": { uncategorized: 12, duplicates: 2, deleted: 0 },
    "/accounts": [{ id: 1, name: "Swedbank Privatkonto", kind: "bank" }],
    "/categories": [{ id: 5, name: "Mat", parentId: null, color: "#009E73" }],
    "/transactions?": {
      rows: [{ id: 9, bookingDate: "2026-09-12", label: null, descriptionClean: "ICA KVANTUM", amount: -25897, categoryId: 5 }],
      totals: { count: 1 },
    },
    "GET /items": (url: string) => {
      const q = new URL(`http://x${url}`).searchParams.get("q") ?? "";
      const all = [{ id: 7, name: "Ovalring Gen 4", merchant: "Amazon", purchaseDate: "2026-08-31", priceOre: 449000 }];
      return { items: all.filter((i) => `${i.name} ${i.merchant}`.toLowerCase().includes(q.toLowerCase())), totals: { count: 1, priceOre: 449000, soldOre: 0 }, years: [], categories: [], categoryOptions: [] };
    },
  });
});

describe("app shell", () => {
  it("shows the view from the URL, and the review count on Transaktioner", async () => {
    window.history.replaceState(null, "", "/fasta-utgifter");
    renderShell();
    expect(screen.getByTestId("view")).toHaveTextContent("Fasta utgifter");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Fasta utgifter");
    const link = screen.getByRole("link", { name: /Transaktioner/ });
    await waitFor(() => expect(link).toHaveTextContent("14"));
  });

  it("⌃/⌘ + digit switches view and back goes back", async () => {
    renderShell();
    await userEvent.keyboard("{Control>}2{/Control}");
    expect(screen.getByTestId("view")).toHaveTextContent("Transaktioner");
    expect(window.location.pathname).toBe("/transaktioner");
    await userEvent.keyboard("{Meta>}5{/Meta}");
    expect(screen.getByTestId("view")).toHaveTextContent("Analys");
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId("view")).toHaveTextContent("Transaktioner"));
  });

  it("the sidebar navigates and folds to icons", async () => {
    renderShell();
    await userEvent.click(screen.getByRole("link", { name: /Delad ekonomi/ }));
    expect(screen.getByTestId("view")).toHaveTextContent("Delad ekonomi");
    expect(screen.getByRole("link", { name: /Delad ekonomi/ })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "Fäll ihop menyn" }));
    expect(screen.queryByText("Privatekonomi")).not.toBeInTheDocument();
    expect(localStorage.getItem("privatekonomi.sidebarCollapsed")).toBe("1");
  });

  it("⌘K opens the palette; typing filters and Enter goes to the view", async () => {
    renderShell();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByPlaceholderText(/Sök transaktioner/);
    await userEvent.type(input, "fasta");
    expect(screen.getByRole("option", { name: /Fasta utgifter/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Analys/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("view")).toHaveTextContent("Fasta utgifter");
    expect(screen.queryByPlaceholderText(/Sök transaktioner/)).not.toBeInTheDocument();
  });

  it("the palette finds views without å/ä/ö and searches transactions", async () => {
    renderShell();
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = await screen.findByPlaceholderText(/Sök transaktioner/);
    await userEvent.type(input, "oversikt");
    expect(screen.getByRole("option", { name: /Översikt/ })).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "ica");
    expect(await screen.findByRole("option", { name: /ICA KVANTUM/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Visa träffen för ”ica”/ }));
    expect(screen.getByTestId("view")).toHaveTextContent("Transaktioner");
    expect(new URLSearchParams(window.location.search).get("q")).toBe("ica");
  });

  it("the palette finds a pryl by name or merchant and opens it", async () => {
    renderShell();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByPlaceholderText(/Sök transaktioner/);
    await userEvent.type(input, "oval");
    const hit = await screen.findByRole("option", { name: /Ovalring Gen 4/ });
    expect(hit).toHaveTextContent("Amazon");
    await userEvent.click(hit);
    expect(screen.getByTestId("view")).toHaveTextContent("Prylar");

    // The merchant finds it too.
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.type(await screen.findByPlaceholderText(/Sök transaktioner/), "amazon");
    expect(await screen.findByRole("option", { name: /Ovalring Gen 4/ })).toBeInTheDocument();
  });

  it("navigate() from anywhere updates the shell", () => {
    renderShell();
    act(() => navigate("settings"));
    expect(screen.getByTestId("view")).toHaveTextContent("Inställningar");
  });
});
