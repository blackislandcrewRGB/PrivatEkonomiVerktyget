/** Bank Norwegian's card is light blue, like the card itself. */
const isNorwegian = (a: { name: string; kind?: "bank" | "credit_card" }) => a.kind === "credit_card" && /norwegian/i.test(a.name);

/**
 * Wallet colours from the tokens, one per kind of account: a card gold (Bank
 * Norwegian's light blue, as the card is), a savings account blue, the
 * everyday account dark, the cash on ISK light blue. Saldon's cards, the bar
 * under Pengar nu and Fasta utgifter's groups use the same ones.
 */
export const walletColour = (a: { name: string; kind?: "bank" | "credit_card" }) =>
  a.kind === "credit_card" ? (isNorwegian(a) ? "bg-wallet-norwegian" : "bg-wallet-gold") : /spar/i.test(a.name) ? "bg-wallet-savings" : "bg-wallet-private";

/**
 * The text on a wallet card, as CSS variables: white, and a dark band under
 * the small print; on Norwegian's light blue dark text and a light band,
 * since white would not read there.
 */
export const walletInk = (a: { name: string; kind?: "bank" | "credit_card" }) =>
  isNorwegian(a) ? "[--wallet-fg:#0f2740] [--wallet-band:rgb(255_255_255/0.45)]" : "[--wallet-fg:#ffffff] [--wallet-band:rgb(0_0_0/0.25)]";

export const ISK_COLOUR = "bg-wallet-isk";
