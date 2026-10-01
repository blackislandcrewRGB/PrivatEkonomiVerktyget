import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiCosts } from "./ApiCosts";

const months = Array.from({ length: 12 }, (_, i) => {
  const month = `${i < 3 ? 2025 : 2026}-${String(((i + 9) % 12) + 1).padStart(2, "0")}`;
  return { month, total: 0, byProvider: {} as Record<string, number> };
});
months[10] = { month: "2026-08", total: 23000, byProvider: { Mistral: 20000, Anthropic: 3000 } };
months[11] = { month: "2026-09", total: 16000, byProvider: { Anthropic: 10000, OpenAI: 6000 } };
const DATA = {
  categoryId: 60,
  month: "2026-09",
  months,
  providers: [
    { name: "Mistral", thisMonth: 0, year: 20000 },
    { name: "Anthropic", thisMonth: 10000, year: 13000 },
    { name: "OpenAI", thisMonth: 6000, year: 6000 },
  ],
  thisMonth: 16000,
  year: 39000,
  averagePerMonth: 2091,
};
const plain = (s: string | null) => (s ?? "").replace(/\s/g, " ");

describe("API-kostnader", () => {
  it("this month and the year per provider, a bar per month that opens its rows", async () => {
    render(<ApiCosts data={DATA} />);
    const section = await screen.findByRole("region", { name: "API-kostnader" });
    expect(plain(section.textContent)).toContain("september hittills 160 kr · snitt 21 kr/mån · 12 månader 390 kr");
    const row = (name: string) => plain(within(section).getByText(name).closest("tr")!.textContent);
    expect(row("Anthropic")).toBe("Anthropic100 kr130 kr");
    expect(row("Mistral")).toBe("Mistral–200 kr");
    expect(within(screen.getByTestId("api-cost-bars")).getAllByRole("button")).toHaveLength(12);
    await userEvent.click(screen.getByRole("button", { name: /^augusti:/ }));
    expect(decodeURIComponent(window.location.href)).toMatch(/2026-08/);
  });

  it("shows nothing without the category, or without any cost", async () => {
    const { container, rerender } = render(<ApiCosts data={{ ...DATA, categoryId: null }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ApiCosts data={{ ...DATA, year: 0, thisMonth: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
