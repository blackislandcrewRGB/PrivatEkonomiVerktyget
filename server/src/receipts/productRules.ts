/**
 * Which shelf a grocery belongs on, guessed from what the receipt calls it.
 *
 * The guess is only ever a start: the group is stored on the product, so the
 * moment it is put right by hand the rules are out of the picture for that one
 * — and for every future receipt printing the same name.
 *
 * The rows are tried in order and the first hit wins, so a word that would be
 * swallowed by a wider one below it goes first: 'havredryck' before coffee
 * ('iKaffe havredryck' is oat milk), 'korvbröd' before sausage, 'tomatpuré'
 * before tomatoes, 'dressing' before chips, 'glass' before strawberries.
 */

export interface ProductGroupSeed {
  name: string;
  color: string;
}

/** The shelves, in the order they are shown. Editable afterwards — this is only where they start. */
export const PRODUCT_GROUPS: ProductGroupSeed[] = [
  { name: "Mejeri & ägg", color: "#56B4E9" },
  { name: "Kött & chark", color: "#CC6677" },
  { name: "Fisk & skaldjur", color: "#0072B2" },
  { name: "Frukt & grönt", color: "#117733" },
  { name: "Bröd", color: "#DDCC77" },
  { name: "Skafferi", color: "#E69F00" },
  { name: "Fryst & färdigmat", color: "#88CCEE" },
  { name: "Snacks & godis", color: "#CC79A7" },
  { name: "Dryck", color: "#44AA99" },
  { name: "Kaffe & te", color: "#882255" },
  { name: "Hem & hushåll", color: "#999933" },
  { name: "Hygien", color: "#AA4499" },
  { name: "Övrigt", color: "#94a3b8" },
];

interface Rule {
  group: string;
  /** Found anywhere in the name: 'korv' also catches 'ölkorv' and 'grillkorv'. */
  words: string[];
  /** Only as a word of its own, because they hide inside other groceries: 'ost' in 'ostar', 'mjöl' in 'mjölk', 'öl' in 'vetemjöl'. */
  whole?: string[];
}

const RULES: Rule[] = [
  {
    group: "Hygien",
    words: ["tandtråd", "tandkräm", "tandborste", "munskölj", "schampo", "hårbalsam", "tvål", "duschgel", "handsprit", "bomullsrondell", "bomullspinn", "blöj", "binda", "tampong", "deodorant", "rakblad", "hudkräm", "bodylotion", "solkräm"],
  },
  {
    group: "Hem & hushåll",
    words: ["diskmedel", "diskborste", "disktrasa", "maskindisk", "tvättmedel", "sköljmedel", "hushållspapper", "toalettpapper", "servett", "sopsäck", "soppåse", "plastfilm", "aluminiumfolie", "bakplåtspapper", "glödlampa", "batteri", "tändstick", "värmeljus", "kylskåpslista", "blomjord", "fryspåsar", "isbitsform", "såpa"],
  },
  {
    group: "Dryck",
    words: ["havredryck", "oatly", "ikaffe", "barista", "sojadryck", "mandeldryck", "juice", "apelsinj", "äppeljuice", "tropicana", "smoothie", "pepsi", "coca-cola", "fanta", "sprite", "ramlösa", "läsk", "kombucha", "red bull", "energidryck", "cider", "staropramen", "pilsner", "mousserande", "mineralvatten", "nocco", "tuborg", "carlsberg", "norrlands guld"],
    whole: ["cola", "öl", "lager", "ipa", "vin", "rödvin"],
  },
  { group: "Kaffe & te", words: ["kaffe", "espresso", "kaffekapsl", "rooibos"], whole: ["te", "tepåsar"] },
  {
    group: "Bröd",
    words: ["bröd", "knäckebröd", "tunnbröd", "korvbröd", "rågbröd", "levain", "frallor", "baguette", "bagel", "tortilla", "wraps", "pitabröd", "skorpor"],
    whole: ["wasa"],
  },
  {
    group: "Fisk & skaldjur",
    words: ["laxfilé", "tonfisk", "torsk", "makrill", "räkor", "musslor", "krabba", "skaldjur", "fiskpinn", "fiskbullar"],
    // 'sill' hides in 'fusilli', 'lax' in 'relax'.
    whole: ["lax", "fisk", "sill", "msc", "räk"],
  },
  {
    group: "Skafferi",
    words: ["krossade tomat", "finkrossade", "tomatpuré", "ketchup", "soltorkade", "passerade tomater", "jordnötsmör", "dressing", "dress mix", "dippmix", "ranch", "tacosås", "sweet chilli", "remoulade", "majonnäs", "senap", "sylt", "marmelad", "honung", "buljong", "kanel", "lökpulver", "chili flakes", "curry", "oregano", "paprikapulver", "vinäger", "olivolja", "rapsolja", "matolja", "kapris", "oliver", "pasta", "spaghetti", "fusilli", "makaron", "nudlar", "jasminris", "basmati", "quinoa", "bulgur", "couscous", "linser", "bönor", "kikärt", "vetemjöl", "rågmjöl", "mandelmjöl", "maizena", "havregryn", "müsli", "flingor", "branflakes", "smördeg", "tårtbotten", "sesamfrö", "linfrö", "solroskärnor", "chiafrö", "bakpulver", "kokosmjölk", "sojasås", "tofu", "kimchi", "sojabönor", "filodeg", "kebabsås", "svartpeppar", "vitpeppar", "vaniljsocker"],
    whole: ["dip", "sås", "olja", "ris", "mjöl", "socker", "jäst"],
  },
  {
    group: "Kött & chark",
    words: ["kycklin", "kalkon", "nötfärs", "fläskfärs", "blandfärs", "biff", "entrecote", "köttfärs", "korv", "salami", "skinka", "bacon", "leverpastej", "pastrami", "hamburgare", "kotlett", "revben", "lamm", "fläskkarré", "prosciutto"],
    whole: ["färs", "kött"],
  },
  {
    group: "Mejeri & ägg",
    words: ["mjölk", "grädde", "gräddfil", "a-fil", "yoghurt", "cottage cheese", "ostar", "fetaost", "mozzarel", "halloumi", "vitost", "färskost", "västerbotten", "hushållsost", "cheddar", "chedd", "margarin", "bregott", "creme fraiche", "crème fraiche", "cremé fraiche", "kvarg", "protein fruch", "brie", "camembert", "parmesan", "grillost", "grilloumi"],
    whole: ["fil", "kefir", "keso", "ost", "feta", "smör", "ägg"],
  },
  { group: "Fryst & färdigmat", words: ["fryst", "frysta", "djupfrys", "findus", "glass", "pizza", "grandiosa", "köttbull", "pommes", "lasagne", "färdigrätt", "piroger", "våffelstrut"] },
  {
    group: "Snacks & godis",
    words: ["chips", "ostbågar", "cheez", "doodles", "olw", "pringles", "popcorn", "nötter", "nötbland", "cashew", "mandlar", "godis", "choklad", "marabou", "daim", "twix", "tupla", "kex", "cookies", "ballerina", "delicatoboll", "chokladboll", "nappar", "lakrits", "snacks", "majskorn", "rostad majs", "salty", "crunch", "grillax", "swebar", "caramba", "hot amigo", "dadlar", "ahlgrens", "estrella", "malaco", "gott & blandat", "pepparkak"],
    whole: ["lion", "tuc", "kola"],
  },
  {
    group: "Frukt & grönt",
    words: ["banan", "äpple", "päron", "apelsin", "citron", "lime", "clementin", "gurka", "tomat", "sallad", "isbergs", "spenat", "rödlök", "vitlök", "purjo", "ingefära", "morot", "morötter", "potatis", "paprika", "melon", "druvor", "jordgubb", "blåbär", "hallon", "körsbär", "rödkål", "broccoli", "blomkål", "zucchini", "aubergine", "avokado", "champinjon", "persilja", "koriander", "basilika", "timjan", "rosmarin", "mynta", "selleri", "majskolv", "rädisor", "nektarin", "ruccola", "rucola", "frukt", "grönsak"],
    whole: ["lök", "kål", "dill", "svamp"],
  },
];

/** A word on its own. JavaScript's \b can't be used: it counts å, ä and ö as punctuation. */
const wholeWord = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "u");

const COMPILED = RULES.map((r) => ({ group: r.group, words: r.words, whole: (r.whole ?? []).map(wholeWord) }));

/** The group a receipt's name lands in, or null when no rule says. */
export function groupForName(name: string): string | null {
  const n = name.toLocaleLowerCase("sv");
  for (const rule of COMPILED) {
    if (rule.words.some((w) => n.includes(w))) return rule.group;
    if (rule.whole.some((re) => re.test(n))) return rule.group;
  }
  return null;
}
