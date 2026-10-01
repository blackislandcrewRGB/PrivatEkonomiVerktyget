import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { callsTo, mockApi } from "../../../test/api";
import { NewAccount } from "./NewAccount";

describe("Nytt konto", () => {
  it("makes a bank account fed by CSV files, by default", async () => {
    const fetchMock = mockApi({ "POST /accounts": (_: string, init: { json?: object }) => ({ id: 7, ...init.json }) });
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(<NewAccount open onOpenChange={onOpenChange} onCreated={onCreated} />);
    expect(screen.getByRole("button", { name: "Skapa konto" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Namn" }), "Lönekonto");
    await userEvent.click(screen.getByRole("button", { name: "Skapa konto" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(callsTo(fetchMock, "POST", "/accounts")).toEqual([["/api/accounts", { name: "Lönekonto", kind: "bank", source: "csv" }]]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a credit card can say what its bill's payment is called, and the other banks are choices", async () => {
    const fetchMock = mockApi({ "POST /accounts": (_: string, init: { json?: object }) => ({ id: 8, ...init.json }) });
    render(<NewAccount open onOpenChange={() => {}} onCreated={() => {}} />);
    expect(screen.queryByText(/Så står betalningen/)).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Kreditkort" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Namn" }), "Exempelkortet");
    await userEvent.type(screen.getByLabelText(/Så står betalningen/), "EXEMPELKORTET");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Hur fylls det på?" }), "norwegian");
    await userEvent.click(screen.getByRole("button", { name: "Skapa konto" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/accounts")).toHaveLength(1));
    expect(callsTo(fetchMock, "POST", "/accounts")[0][1]).toEqual({ name: "Exempelkortet", kind: "credit_card", source: "norwegian", paymentText: "EXEMPELKORTET" });
  });

  it("a Swedbank account can say which product in the file it is, to be chosen first time", async () => {
    const fetchMock = mockApi({ "POST /accounts": (_: string, init: { json?: object }) => ({ id: 9, ...init.json }) });
    render(<NewAccount open onOpenChange={() => {}} onCreated={() => {}} />);
    expect(screen.queryByLabelText(/Produkten i Swedbanks fil/)).toBeNull();
    await userEvent.type(screen.getByRole("textbox", { name: "Namn" }), "Privat");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Hur fylls det på?" }), "swedbank");
    await userEvent.type(screen.getByLabelText(/Produkten i Swedbanks fil/), "Privatkonto");
    await userEvent.click(screen.getByRole("button", { name: "Skapa konto" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/accounts")).toHaveLength(1));
    expect(callsTo(fetchMock, "POST", "/accounts")[0][1]).toEqual({ name: "Privat", kind: "bank", source: "swedbank", importHint: "Privatkonto" });
  });

  it("says what the server says when the name is taken, and stays open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: 'Det finns redan ett konto som heter "Lönekonto".' }), { status: 409 })));
    const onOpenChange = vi.fn();
    render(<NewAccount open onOpenChange={onOpenChange} onCreated={() => {}} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Namn" }), "Lönekonto");
    await userEvent.click(screen.getByRole("button", { name: "Skapa konto" }));
    expect(await screen.findByText(/Det finns redan ett konto/)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
