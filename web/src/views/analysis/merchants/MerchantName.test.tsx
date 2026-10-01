import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MerchantName, shortList } from "./MerchantName";
import type { Merchant } from "./types";

const CATS = [
  { id: 3, name: "Bil", parentId: null },
  { id: 4, name: "Drivmedel", parentId: 3 },
];
const m = (o: Partial<Merchant>): Merchant => ({ key: "x", name: "x", label: null, contactName: null, texts: ["x"], areas: [], categoryId: null, count: 1, total: 100, avg: 100, ...o });

describe("MerchantName", () => {
  it("marks a merged row with 'N namn' and lists its towns under the category", () => {
    const { container } = render(
      <MerchantName m={m({ key: "Circle K", label: "Circle K", texts: ["CIRCLE K EXEMPELBY", "CIRCLE K EXEMPELVIK", "CIRCLE K BRO", "CIRCLE K UMEA"], areas: ["Exempelby", "Exempelvik", "Bro", "Umea"], categoryId: 4 })} categories={CATS} />,
    );
    expect(container.querySelector("[data-pill=names]")?.textContent).toBe("4 namn");
    expect(screen.getByText("Bil › Drivmedel · 4 namn · Exempelby, Exempelvik, Bro +1")).toBeInTheDocument();
  });

  it("lists the bank's texts when there are no towns, and has no pill for one text", () => {
    const { container, rerender } = render(<MerchantName m={m({ key: "Lidl", label: "Lidl", texts: ["LIDL SVERIGE", "LIDL 271"] })} categories={CATS} />);
    expect(screen.getByText("2 namn · LIDL SVERIGE, LIDL 271")).toBeInTheDocument();
    rerender(<MerchantName m={m({ key: "AKAGI", name: "AKAGI", texts: ["AKAGI"] })} categories={CATS} />);
    expect(container.querySelector("[data-pill=names]")).toBeNull();
    expect(shortList(["a", "b"])).toBe("a, b");
  });
});
