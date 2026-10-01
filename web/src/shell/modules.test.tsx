import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { callsTo, mockApi } from "../../test/api";
import { resetModules } from "../lib/modules";
import { PrivacyContext } from "../privacy";
import { Modules } from "../views/settings/Modules";
import { AppShell } from "./AppShell";
import { viewDef } from "./routes";

function renderShell() {
  return render(
    <PrivacyContext.Provider value={{ showPrivate: false, setShowPrivate: () => {} }}>
      <AppShell>{(view) => <p data-testid="view">{viewDef(view).label}</p>}</AppShell>
    </PrivacyContext.Provider>,
  );
}

const settings = (modules: { salary: boolean; commute: boolean }) => ({ partnerSwishNumbers: [], partnerName: "partnern", ownName: null, modules });
const base = { "/review/counts": { uncategorized: 0, duplicates: 0, deleted: 0 } };

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  resetModules();
});

describe("optional modules", () => {
  it("Lön and Pendling & bränsle are not in the menu while they are off", async () => {
    const fetchMock = mockApi({ ...base, "GET /settings": settings({ salary: false, commute: false }) });
    renderShell();
    await waitFor(() => expect(callsTo(fetchMock, "GET", "/settings")).toHaveLength(1));
    expect(screen.getByRole("link", { name: /Delad ekonomi/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Lön/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Pendling/ })).toBeNull();
  });

  it("a module that is on is in the menu", async () => {
    mockApi({ ...base, "GET /settings": settings({ salary: true, commute: false }) });
    renderShell();
    expect(await screen.findByRole("link", { name: /^Lön/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Pendling/ })).toBeNull();
  });

  it("a link to a module that is off says so and where to switch it on", async () => {
    window.history.replaceState(null, "", "/lon");
    mockApi({ ...base, "GET /settings": settings({ salary: false, commute: false }) });
    renderShell();
    expect(await screen.findByText("Lön är avstängd")).toBeInTheDocument();
    expect(screen.queryByTestId("view")).toBeNull();
    expect(screen.getByRole("button", { name: "Slå på under Moduler" })).toBeInTheDocument();
  });

  it("the switches in Inställningar turn a module on, at once and on the server", async () => {
    const fetchMock = mockApi({
      ...base,
      "GET /settings": settings({ salary: false, commute: false }),
      "PUT /settings": (_: string, init: { json?: { modules?: Record<string, boolean> } }) => settings({ salary: false, commute: false, ...init.json?.modules }),
    });
    render(
      <>
        <Modules match={() => true} />
        <PrivacyContext.Provider value={{ showPrivate: false, setShowPrivate: () => {} }}>
          <AppShell>{(view) => <p data-testid="view">{viewDef(view).label}</p>}</AppShell>
        </PrivacyContext.Provider>
      </>,
    );
    expect(screen.queryByRole("link", { name: /Pendling/ })).toBeNull();
    await userEvent.click(screen.getByRole("switch", { name: "Pendling & bränsle" }));
    expect(await screen.findByRole("link", { name: /Pendling/ })).toBeInTheDocument();
    expect(callsTo(fetchMock, "PUT", "/settings")).toEqual([["/api/settings", { modules: { commute: true } }]]);
    expect(screen.queryByRole("link", { name: /^Lön/ })).toBeNull();
  });
});
