import { useEffect, useState, useSyncExternalStore } from "react";
import { getJson, type Item, type ItemSuggestion, type Settings } from "../../api";
import { notify } from "../../components/Toast";
import { ItemDialog, draftFrom, emptyDraft } from "./ItemDialog";
import { todayIso } from "../../lib/today";

/**
 * One 'Skapa pryl' dialog for the whole app: the transaction's panel opens it,
 * and so does Att göra when Vakt asks whether a purchase was a thing. Both
 * want the same dialog filled in from the same transaction, and neither wants
 * its own copy of the fetching.
 *
 * The same host also opens an empty dialog ('Ny pryl').
 */

let openFor: { transactionId: number | null } | null = null;
const listeners = new Set<() => void>();
const saved = new Set<(item: Item) => void>();
const emit = () => listeners.forEach((l) => l());

/** Opens the dialog filled in from a transaction, from anywhere in the app. */
export function openItemFor(transactionId: number) {
  openFor = { transactionId };
  emit();
}

export function openNewItem() {
  openFor = { transactionId: null };
  emit();
}

/** Closes it from outside, wherever it was opened from. */
export function closeItemDialog() {
  openFor = null;
  emit();
}

/** Runs `fn` when a pryl has been saved, so a view can reload what it shows. */
export function onItemSaved(fn: (item: Item) => void): () => void {
  saved.add(fn);
  return () => {
    saved.delete(fn);
  };
}

const today = todayIso;

export function ItemDialogHost() {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => openFor,
  );
  const [suggestion, setSuggestion] = useState<ItemSuggestion | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [partnerName, setPartnerName] = useState("partnern");
  const transactionId = state?.transactionId ?? null;

  useEffect(() => {
    getJson<Settings>("/settings").then((s) => setPartnerName(s.partnerName), () => {});
  }, []);

  useEffect(() => {
    if (!state) return setSuggestion(null);
    let live = true;
    if (transactionId === null) {
      getJson<{ categoryOptions: string[] }>("/items").then((d) => live && setOptions(d.categoryOptions), () => {});
      return;
    }
    getJson<ItemSuggestion>(`/items/suggest/${transactionId}`).then(
      (s) => {
        if (!live) return;
        setSuggestion(s);
        setOptions(s.categoryOptions);
      },
      (e: Error) => {
        if (!live) return;
        notify({ text: e.message });
        openFor = null;
        emit();
      },
    );
    return () => {
      live = false;
    };
  }, [state, transactionId]);

  // Nothing is drawn until what fills it has landed, so the fields never jump.
  const ready = !!state && (transactionId === null || !!suggestion);

  return (
    <ItemDialog
      open={ready}
      draft={suggestion ? draftFrom(suggestion) : emptyDraft(today())}
      icon={suggestion?.icon}
      bookedDate={suggestion?.bookedDate}
      categoryOptions={options}
      transactionIds={transactionId === null ? [] : [transactionId]}
      partnerName={partnerName}
      onOpenChange={(o) => {
        if (!o) {
          openFor = null;
          emit();
        }
      }}
      onSaved={(item) => {
        openFor = null;
        emit();
        saved.forEach((fn) => fn(item));
      }}
    />
  );
}
