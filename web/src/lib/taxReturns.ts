import type { TaxReturnBoxes } from "../api";

/** The boxes kept from a tax return, in the form's order, with their numbers and texts as on Skatteverket's receipt. */
export const TAX_BOXES: { key: keyof TaxReturnBoxes; number: string; label: string }[] = [
  { key: "employmentIncome", number: "1.1", label: "Lön, förmåner, sjukpenning m.m." },
  { key: "commuteDeduction", number: "2.1", label: "Resor till och från arbetet" },
  { key: "iskStandardIncome", number: "7.1", label: "Schablonintäkter" },
  { key: "capitalIncome", number: "7.2", label: "Ränteinkomster, utdelningar m.m." },
  { key: "capitalExpenses", number: "8.1", label: "Ränteutgifter m.m." },
];

/** '2025-03-21' → '21/3 2025'. */
export const dayMonthYear = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))} ${iso.slice(0, 4)}`;
