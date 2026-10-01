import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewSkeleton, RecurringSkeleton, TransactionsSkeleton } from "./skeletons";

describe("what a view looks like while it loads", () => {
  it("says what is loading, and says it once", () => {
    const { unmount } = render(<OverviewSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("Översikten laddas");
    unmount();
    render(<RecurringSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("Fasta utgifter laddas");
  });

  it("stands in with the same number of rows as the list it replaces", () => {
    const { container } = render(<TransactionsSkeleton rows={5} />);
    expect(screen.getByRole("status")).toHaveTextContent("Transaktionerna laddas");
    // The blocks themselves are decoration: a day heading and five rows.
    expect(container.querySelectorAll(".grid")).toHaveLength(5);
    expect(container.querySelector("[aria-busy='true']")).toBeInTheDocument();
  });
});
