import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi } from "../../../test/api";
import { GettingStarted } from "./GettingStarted";

const coverage = (importedTo: string | null) => [{ accountId: 1, name: "Lönekonto", kind: "bank", source: "csv", importedTo, importedAt: null, via: "file", syncedAt: null, lastInvoiceTo: null, nextInvoiceTo: null }];

describe("Välkommen", () => {
  it("in an empty database: make the accounts first, with the other steps waiting", async () => {
    mockApi({ "/accounts": [], "/imports/coverage": [] });
    render(<GettingStarted onNavigate={() => {}} />);
    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).not.toHaveAttribute("data-step-done");
    expect(screen.getByRole("button", { name: "Skapa konton" })).toBeInTheDocument();
  });

  it("ticks off the accounts once there are some, and leads on to Importer", async () => {
    mockApi({ "/accounts": [{ id: 1, name: "Lönekonto" }], "/imports/coverage": coverage(null) });
    const onNavigate = vi.fn();
    render(<GettingStarted onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-step-done"));
    await userEvent.click(screen.getByRole("button", { name: "Till Importer" }));
    expect(onNavigate).toHaveBeenCalledWith("imports");
  });

  it("is gone after the first import, and says nothing when the answers can't be read", async () => {
    mockApi({ "/accounts": [{ id: 1, name: "Lönekonto" }], "/imports/coverage": coverage("2026-09-18") });
    const { container, unmount } = render(<GettingStarted onNavigate={() => {}} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
    unmount();
    mockApi({});
    const again = render(<GettingStarted onNavigate={() => {}} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(again.container).toBeEmptyDOMElement();
  });
});
