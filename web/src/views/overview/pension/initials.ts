import { capsWord } from "./split";

/** Providers whose name is one word but two parts. */
const KNOWN: Record<string, string> = {
  pensionsmyndigheten: "PM",
  länsförsäkringar: "LF",
  folksam: "FS",
  skandia: "SK",
  alecta: "AL",
  avanza: "AV",
  nordnet: "NN",
  swedbank: "SB",
  handelsbanken: "HB",
};

/**
 * The provider's badge: a known one's letters, a word in capitals (KPA,
 * AMF), the first letters of two words, or the first two letters.
 */
export function initials(provider: string): string {
  const name = provider.trim();
  const known = KNOWN[name.split(/\s+/)[0].toLocaleLowerCase("sv")];
  if (known) return known;
  const caps = capsWord(name);
  if (caps) return caps.slice(0, 4);
  const words = name.split(/[\s–-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toLocaleUpperCase("sv");
  return (name[0] ?? "?").toLocaleUpperCase("sv") + (name[1] ?? "").toLocaleLowerCase("sv");
}
