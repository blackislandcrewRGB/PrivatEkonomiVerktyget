import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import { PageHeader } from "../../shell/PageHeader";
import { mockApi } from "../../../test/api";
import { TransactionsPage } from "./TransactionsPage";

function renderPage(counts: { uncategorized: number; duplicates: number; deleted: number }) {
  mockApi({ "/categories": [], "/accounts": [], "/settings": { partnerName: "Mio" }, "/review/counts": counts });
  window.history.replaceState(null, "", "/transaktioner");
  return render(
    <TooltipProvider>
      <PageHeader title="Transaktioner" appearance="v2" />
      <TransactionsPage onOpenRecurring={vi.fn()} />
    </TooltipProvider>,
  );
}

afterEach(cleanup);

describe("TransactionsPage's tabs", () => {
  it("sits after the title as Alla / Att granska / Borttagna, Att granska counting in orange", async () => {
    renderPage({ uncategorized: 2, duplicates: 1, deleted: 4 });
    const nav = screen.getByRole("navigation", { name: "Transaktioner" });
    expect(await within(nav).findByText("3")).toHaveClass("bg-caution", "text-white");
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Alla", "Att granska3", "Borttagna4"]);
    expect(within(nav).getByRole("link", { name: "Alla" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByText("4")).not.toHaveClass("bg-caution");
    // In the header, right after the title.
    expect(screen.getByRole("heading", { name: "Transaktioner" }).closest("header")).toContainElement(nav);
  });

  it("has no count when there is nothing to review", async () => {
    renderPage({ uncategorized: 0, duplicates: 0, deleted: 0 });
    const nav = screen.getByRole("navigation", { name: "Transaktioner" });
    await screen.findByRole("link", { name: "Att granska" });
    expect(nav.querySelector("[data-badge]")).toBeNull();
  });
});
