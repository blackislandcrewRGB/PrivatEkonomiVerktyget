import { useState } from "react";
import { sendJson, type Account } from "../../api";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { notify } from "../../components/Toast";
import { FIELD } from "./ui";

type Kind = Account["kind"];
type Source = "csv" | "swedbank" | "norwegian" | "mastercard" | "";

export const SOURCE_CHOICES: { value: Source; label: string; hint: string }[] = [
  { value: "csv", label: "CSV-fil från banken", hint: "Vilken bank som helst: du pekar ut kolumnerna första gången." },
  { value: "swedbank", label: "Swedbank", hint: "Bankens egen CSV (Privatkonto, e-sparkonto). Överföringar mellan dina konton känns igen." },
  { value: "norwegian", label: "Bank Norwegian", hint: "Månadsexporten (XLSX) och fakturan (PDF)." },
  { value: "mastercard", label: "Swedbank Mastercard", hint: "Fakturan (PDF) och transaktionslistan." },
  { value: "", label: "Ingen import", hint: "Du för in saldot och raderna själv." },
];

/**
 * A new account: a name, whether it is a bank account or a credit card, and how it gets its rows.
 * A credit card can say what its bill's payment is called on the account that pays it, so that
 * payment is a transfer to the card and not an expense.
 */
export function NewAccount({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (account: Account) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("bank");
  const [source, setSource] = useState<Source>("csv");
  const [paymentText, setPaymentText] = useState("");
  const [product, setProduct] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setKind("bank");
    setSource("csv");
    setPaymentText("");
    setProduct("");
    setError(null);
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const account = await sendJson<Account>("POST", "/accounts", { name, kind, source: source || null, paymentText: kind === "credit_card" ? paymentText : undefined, importHint: source === "swedbank" ? product : undefined });
      notify({ text: `Kontot "${account.name}" är skapat.` });
      reset();
      onOpenChange(false);
      onCreated(account);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const hint = SOURCE_CHOICES.find((c) => c.value === source)?.hint;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o && reset(), onOpenChange(o))}>
      <DialogContent aria-describedby="new-account-desc" className="rounded-card">
        <DialogTitle>Nytt konto</DialogTitle>
        <DialogDescription id="new-account-desc" className="mt-1">
          Ett bankkonto eller ett kreditkort. Du kan byta namn och ta bort kontot senare under Ändra.
        </DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-ink-2">Namn</span>
            <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="till exempel Lönekonto" autoFocus maxLength={60} />
          </label>
          <div className="space-y-1">
            <span className="text-[12px] font-medium text-ink-2">Sort</span>
            <div>
              <SegmentedControl<Kind>
                appearance="v2"
                size="sm"
                label="Sort"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "bank", label: "Bankkonto" },
                  { value: "credit_card", label: "Kreditkort" },
                ]}
              />
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-ink-2">Hur fylls det på?</span>
            <select className={FIELD} value={source} onChange={(e) => setSource(e.target.value as Source)} aria-label="Hur fylls det på?">
              {SOURCE_CHOICES.map((c) => (
                <option key={c.value || "none"} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {hint && <span className="block text-[11px] text-ink-3">{hint}</span>}
          </label>
          {source === "swedbank" && (
            <label className="block space-y-1">
              <span className="text-[12px] font-medium text-ink-2">Produkten i Swedbanks fil (valfritt)</span>
              <input className={FIELD} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="till exempel Privatkonto" />
              <span className="block text-[11px] text-ink-3">Kolumnen Produkt i filen. Då är det här kontot förvalt när du importerar en fil med den produkten första gången.</span>
            </label>
          )}
          {kind === "credit_card" && (
            <label className="block space-y-1">
              <span className="text-[12px] font-medium text-ink-2">Så står betalningen av kortets räkning (valfritt)</span>
              <input className={FIELD} value={paymentText} onChange={(e) => setPaymentText(e.target.value)} placeholder="till exempel kortets namn" />
              <span className="block text-[11px] text-ink-3">Texten på raden på kontot som betalar räkningen. Då räknas betalningen som en överföring till kortet och inte som en utgift.</span>
            </label>
          )}
          {error && <p className="text-[12px] text-alarm">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Avbryt
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
              Skapa konto
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
