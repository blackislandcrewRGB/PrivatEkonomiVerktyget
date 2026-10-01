import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./SegmentedControl";

function Harness({ appearance }: { appearance?: "default" | "v2" }) {
  const [v, setV] = useState<"mine" | "household">("mine");
  return (
    <SegmentedControl
      label="Visa"
      appearance={appearance}
      value={v}
      onChange={setV}
      options={[
        { value: "mine", label: "Min del" },
        { value: "household", label: "Hushållet" },
      ]}
    />
  );
}

describe("SegmentedControl", () => {
  it("switches on click and with the arrow keys", async () => {
    render(<Harness />);
    const mine = screen.getByRole("radio", { name: "Min del" });
    const household = screen.getByRole("radio", { name: "Hushållet" });
    expect(mine).toHaveAttribute("aria-checked", "true");
    await userEvent.click(household);
    expect(household).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowRight}");
    expect(mine).toHaveAttribute("aria-checked", "true");
    expect(mine).toHaveFocus();
  });

  it("the v2 look is only a look: the same radios, the same keys", async () => {
    render(<Harness appearance="v2" />);
    const group = screen.getByRole("radiogroup", { name: "Visa" });
    expect(group).toHaveClass("bg-segment");
    const household = screen.getByRole("radio", { name: "Hushållet" });
    await userEvent.click(household);
    expect(household).toHaveAttribute("aria-checked", "true");
    expect(household).toHaveClass("bg-segment-on");
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Min del" })).toHaveFocus();
  });
});
