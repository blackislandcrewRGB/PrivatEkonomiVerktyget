import type { IconRef } from "../../../api";

/** GET /api/analysis/merchants: purchases per bank text, name, category and town, in öre. */
export interface Piece {
  /** The bank's text (the counterparty, else the cleaned description). */
  key: string;
  /** The name the name rules gave the rows, if any. */
  label: string | null;
  contactName: string | null;
  icon?: IconRef;
  categoryId: number | null;
  area: string | null;
  count: number;
  total: number;
  lastDate: string;
}
export interface MerchantCategory {
  id: number;
  name: string;
  parentId: number | null;
}
export interface MerchantData {
  pieces: Piece[];
  categories: MerchantCategory[];
  private: { count: number; total: number };
}

/** One row of the list: a bank text, or with 'Slå ihop' every bank text with the same name. */
export interface Merchant {
  /** What a click searches the transactions for: the name when merged, else the bank text. */
  key: string;
  /** The contact's name, else the bank text. */
  name: string;
  label: string | null;
  contactName: string | null;
  icon?: IconRef;
  /** The bank texts in the row, largest sum first; one unless merged. */
  texts: string[];
  /** The towns the bank gave ('Exempelstad'), largest sum first. */
  areas: string[];
  /** The category most of the row's money went to. */
  categoryId: number | null;
  count: number;
  total: number;
  avg: number;
}

/** The name a merchant is shown by: its label, else the name. */
export const merchantName = (m: Merchant) => m.label ?? m.name;
