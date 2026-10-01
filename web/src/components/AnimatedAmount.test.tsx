import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AnimatedAmount, AnimatedNumber } from "./AnimatedAmount";
import { kr } from "../views/overview/format";

/** Answers the reduced-motion query with `on`, leaving other queries as they were. */
function reducedMotion(on: boolean) {
  const real = window.matchMedia;
  vi.stubGlobal("matchMedia", (query: string) =>
    query.includes("prefers-reduced-motion") ? { ...real(query), matches: on } : real(query),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("a figure that counts to its new value", () => {
  it("shows the value at once on the first render, without counting", () => {
    render(<AnimatedAmount ore={2532812} whole size="xl" kind="neutral" />);
    expect(screen.getByText("25 328,12 kr")).toBeInTheDocument();
  });

  it("counts to the new value when it changes", async () => {
    const { rerender } = render(<AnimatedNumber value={100000} format={kr} />);
    expect(screen.getByText("1 000 kr")).toBeInTheDocument();
    rerender(<AnimatedNumber value={150000} format={kr} />);
    await waitFor(() => expect(screen.getByText("1 500 kr")).toBeInTheDocument());
  });

  it("jumps straight to the new value when the system asks for less motion", async () => {
    reducedMotion(true);
    const { rerender } = render(<AnimatedNumber value={100000} format={kr} />);
    rerender(<AnimatedNumber value={150000} format={kr} />);
    await waitFor(() => expect(screen.getByText("1 500 kr")).toBeInTheDocument());
  });

  it("keeps the colours and the sign of a plain amount", () => {
    const { container, rerender } = render(<AnimatedAmount ore={50000} />);
    expect(screen.getByText("+500,00 kr")).toHaveClass("text-income");
    rerender(<AnimatedAmount ore={-50000} />);
    expect(container.firstChild).toHaveClass("text-expense", "tabular-nums");
  });
});
