import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "./ui/tooltip";
import { BulkActionBar } from "./BulkActionBar";

const renderBar = (props: Partial<Parameters<typeof BulkActionBar>[0]> = {}) => {
  const actions = { shared: vi.fn(), remove: vi.fn() };
  const onClear = vi.fn();
  render(
    <TooltipProvider>
      <BulkActionBar
        count={3}
        sum={-65200}
        onClear={onClear}
        actions={[
          { label: "Delad", onClick: actions.shared, keys: ["s"] },
          { label: "Ta bort", onClick: actions.remove, danger: true },
        ]}
        {...props}
      />
    </TooltipProvider>,
  );
  return { actions, onClear };
};

describe("BulkActionBar", () => {
  it("shows how many rows are selected and their sum", () => {
    renderBar();
    const bar = screen.getByRole("toolbar", { name: "Åtgärder för markerade rader" });
    expect(bar).toHaveTextContent("3 markerade");
    expect(bar.textContent).toContain("\u2212652,00\u00A0kr");
  });

  it("runs an action and clears the selection", async () => {
    const { actions, onClear } = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Delad" }));
    expect(actions.shared).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Avmarkera" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("is not shown when nothing is selected, and says 'markerad' for one", () => {
    const { rerender } = render(<BulkActionBar count={0} actions={[]} onClear={() => {}} />);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    rerender(
      <TooltipProvider>
        <BulkActionBar count={1} actions={[]} onClear={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("toolbar")).toHaveTextContent("1 markerad");
  });
});
