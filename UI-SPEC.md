# UI-omgörning – Privatekonomi

Det här är en omgörning av gränssnittet, inte av logiken. All funktionalitet som finns i dag ska finnas kvar, API:t ändras bara additivt, och alla befintliga tester ska vara gröna. Målet är ett verktyg som är snabbt att *arbeta i* varje vecka: granska, rätta, stämma av – inte bara titta på.

Förebild: Copilot Money (dashboard med "att granska" som centrum, kategori i raden, tangentbord i alla listor) och Monarch (månadsöversikt, tydlig hierarki). Läs `frontend-design`-skillen om den finns i miljön innan du börjar.

## Principer

1. **Hierarki.** Varje vy har ett svar överst i stor stil, sedan det som kräver handling, sedan detaljer. Ingen vy ska vara en jämntjock vägg.
2. **Läs först, redigera vid behov.** Inga synliga dropdowns i listor. Värden visas som text/chips; klick eller tangent öppnar redigering. Det som redigeras oftast (kategori, delad) går att ändra i raden utan att öppna något.
3. **Tangentbord överallt.** Alla listor navigeras med piltangenter, alla vanliga åtgärder har en bokstav, och `⌘K` öppnar en kommandopalett.
4. **Det som kräver handling är synligt.** Antal att granska visas i sidomenyn. Varningar är klickbara uppgifter, inte text.
5. **Täthet med luft.** Kompakta rader (36–40 px), men tydliga sektioner och max ~1 200 px innehållsbredd. Tabulära siffror överallt (`font-variant-numeric: tabular-nums`), belopp högerställda.

## Designsystem

- **Stack:** behåll React + Tailwind. Lägg till Radix-primitiver via shadcn/ui (Dialog, Sheet, Popover, Command, DropdownMenu, Tooltip, Toast) och lucide-react för ikoner. Inga andra UI-bibliotek.
- **Tokens i CSS-variabler**, ljust och mörkt tema (följ systemet, växel i Inställningar). Definiera semantiska färger, inte bara gråskala:
  - `expense` (neutral mörk text – utgifter är normalläget, inte röda), `income` (grön), `transfer` (dämpad blå), `shared` (lila accent), `warning` (amber), `danger` (röd, bara för förfallet/skuld).
  - Kategorifärger: en palett på 16 färger som är åtskiljbara för röd-grön-färgblinda (t.ex. Okabe–Ito utökad). Samma färg för en kategori i hela appen: chip, stapel, legend.
- **Typografi:** Inter eller systemfont, 14 px bas, 13 px i tabeller. Belopp i 15 px medium. Rubriker max tre nivåer.
- **Belopp:** `−1 234,56 kr`, minus som riktigt minustecken, tusentalsavgränsare tunt mellanslag. Inkomster med `+` och grön färg. Beloppet är alltid den högra kolumnen.
- **Komponenter att bygga en gång och återanvända:** `Amount`, `CategoryChip` (färgprick + namn, klickbar → väljare), `AccountBadge`, `StatusPill` (kommande/dragen/förfallen/betald), `DateGroupHeader`, `SidePanel` (Sheet från höger, 420 px), `FilterBar` (chips + "Fler filter"-popover), `BulkActionBar` (fast nederst när rader är markerade), `EmptyState`, `KeyHint` (visar tangent i tooltip).

## Rörelse

Animation ska visa **vad som hände** — ett värde ändrades, en rad flyttade sig, något togs bort — aldrig dekorera. Inget animerar av sig självt: det krävs att användaren gjort något.

- **Bibliotek:** Motion (paketet `motion`, f.d. framer-motion). Inga andra animationsbibliotek.
- **Tre längder,** alla med ease-out, i `web/src/lib/motion.ts`:

  | Preset | Tid | Används till |
  |---|---|---|
  | `micro` | 180 ms | hover, tryck, färgbyten |
  | `number` | 400 ms | en siffra som räknar till sitt nya värde |
  | `layout` | 300 ms | en rad som glider till sin nya plats, listor som kommer in |

  Listor trappas med 25 ms per rad och högst 15 rader animerade (`STAGGER`, `STAGGER_MAX`); resten kommer direkt.
- **`prefers-reduced-motion` stänger av allt.** CSS:en i `index.css` kortar varje transition och keyframe till 1 ms, och allt som ritas med Motion går via `useTransition(preset)`, som ger `duration: 0` när systemet ber om mindre rörelse. Komponenter som annars tonar in frågar `useMotionOn()` och ritar slutläget direkt.
- **Temabytet** (ljust/mörkt) tonar med 200 ms, men bara på `html`/`body`. En transition på allt skulle göra varje hover i appen seg.
- **Rullande siffror.** `AnimatedNumber` (och `AnimatedAmount`, som är `Amount` fast räknande) tweenar från det gamla värdet till det nya på `number`-tiden. Den **animerar aldrig vid första render** — bara när värdet ändras av något du gjort: byte av *Min del | Hushållet*, ny månad, en ändring som räknas om. Ett belopp i hela kronor räknar i hela kronor och landar på det exakta värdet, så formateringen är densamma som i `Amount`.
  - Används bara för de stora talen en vy handlar om: Översiktens *Kvar att leva på* och *Utgiftstakt*, Delad ekonomis resultat, Fasta utgifters tre summakort, Pendlings *Kvar att tanka* och Lönesidans nettolön. Aldrig för belopp i listor — då skulle varje omladdning bli en ljusshow.
- **Listor kommer in trappvis.** Raderna tonar in och stiger 4 px, 25 ms mellan varje och högst 15 rader — resten är på plats direkt. Det händer när listan visas första gången och när **det den visar** ändras: ny period eller nytt filter i Transaktioner, *Min del | Hushållet* i Fasta utgifter, nya månader på Lönesidan. Gäller Transaktioner (rader och dagrubriker), Fasta utgifter (tabellen och kortlistan på telefon) och *Inlagda månader* under Lön.
  - **Aldrig vid scroll.** Transaktionslistan är virtualiserad, så rader monteras hela tiden medan man rullar. Två saker hindrar det: entrén gäller bara en kort stund (900 ms) efter att listan bytt innehåll, och varje rad **låser sina entré-props när den monteras** (`useEntrance`/`Entering`). Det andra är viktigare än det låter — utan det kunde en rad som råkade renderas om mitt i intoningen bli stående halvtonad.
- **Rader glider till sin nya plats** (`layout`) i Fasta utgifter och i *Att göra*, så att en omsortering — en utgift vars dag ändras, en post som försvinner — syns som en rörelse i stället för ett hopp. **Transaktionslistan har det inte:** den är virtualiserad och positionerar varje rad med en egen `transform`, som en layout-animation skulle slåss med. Där gör kollapsen samma jobb: raden som lämnar krymper och de under glider upp.
- **Status-chips byter färg mjukt** (kommande → dragen, öppen/kvitt/avviker) med en CSS-övergång på `micro`-tiden. Färgerna bor i Tailwind-klasser, och att flytta dem till JS bara för att animera dem vore fel affär; `prefers-reduced-motion` stänger av dem ändå.
- **En post i Att göra bockas av.** När den lämnar listan — avfärdad för dagen, avfärdad för gott, eller klar och borta efter en omladdning — ritas en bock ut över raden på 250 ms, och först därefter kollapsar raden. Ordningen är själva poängen: man ser *att* det blev gjort innan det försvinner.
- **En rad som tas bort kollapsar** i höjd och tonar bort på `layout`-tiden i stället för att bara försvinna; listan laddas om när den är borta, så raderna under glider upp en gång. Gäller både soft delete och riktig borttagning, en rad som flera.
- **Diagrammen i Analys** ritar sin egen rörelse: staplarna växer från noll och totallinjen ritas ut när data byts (ny period, drill-down). Recharts gör det själv — att styra dess staplar med Motion går inte — men tiderna är appens: `number` och ease-out, i stället för bibliotekets 1,5 s. `useChartAnimation()` stänger av alltihop vid `prefers-reduced-motion`. Referenslinjer som medvetet står stilla (l/100 km, sparkvot, mat-linjerna) är kvar som de var.
  - **Hover på en stapel** dämpar de andra kategorierna och totallinjen till 40 %, så att en färg går att följa månad för månad. Färgbytet stör inte stapelanimationen: Recharts animerar om data ändras, inte när en opacitet gör det.
- **Progressbarer fylls från noll** på `number`-tiden när de visas, och glider till sitt nya värde när det ändras: utgiftstakten i Översikt, förloppet i Att granska och kategoristaplarna i *Den här månaden*.
- **Skelett i stället för snurra.** Översikt, Transaktioner och Fasta utgifter visar, medan de laddar, samma lådor i samma storlekar som det som kommer — inte en spinner. Då hoppar ingenting när data landar. Skelettet pulsar svagt, vilket är det enda i appen som rör sig utan att användaren gjort något; det lever bara så länge något laddar, och `prefers-reduced-motion` stoppar det med allt annat. Skärmläsare får en `role="status"`-rad ("Översikten laddas") i stället för lådorna.
- **Tomma tillstånd** är ikon, en mening och en knapp som tar dig vidare (`EmptyState`), aldrig en streckad ram med grå text. Delad ekonomi hade de två sista: *Inget inlagt för september* leder nu till *Mio har betalat…* och *Inga delade utgifter den här månaden* till månadens transaktioner.
- **Mikrointeraktioner.** Ett kort som *gör* något lyfter 2 px med en mjuk skugga under pekaren och sjunker tillbaka vid tryck (`.card-click`): avstämningsmånaderna, granskningskorten och dubblettparen. Kort som bara visar något — saldon, summakort — får det inte, för lyftet är ett löfte om att det går att klicka. Knappar ger efter till 0,97 vid tryck, och dialoger (⌘K bland dem) växer in från 0,95 med en toning på 150 ms. Hover, tryck och färg är CSS-övergångar på `micro`-tiden; Motion används där ett tillstånd driver rörelsen (siffror, listor, layout, utgångar), inte för att ersätta `:hover`.
- **Handlarikonens platta** har handlarens egen färg — samma stabila färg som monogrammet skulle ha fått — tunt lagd över den neutrala brickan (16 % i ljust tema, 26 % i mörkt). Formen är kvar rund. Varumärkesfärgen mäts nu mot den tonade plattan, så kontrastregeln (3:1) gäller fortfarande; ett Swish-nummer utan kontakt har ingen handlare att ta färg av och är kvar grått.
- **Tabulära siffror** gäller hela appen: `font-variant-numeric: tabular-nums` på `body` (systemfonten valdes delvis för det, se tokens.css), och dessutom uttryckligen i de komponenter som visar belopp — `Amount`, `Money` och tabellcellerna i Analys — så att en framtida container inte kan slå ut dem.

## Skal och navigation

- **Sidomeny till vänster** (240 px, kollapsbar till 64 px med bara ikoner): Översikt, Transaktioner (badge: antal att granska), Fasta utgifter, Delad ekonomi, Analys, Importer, Kategorier & regler, Inställningar. Kortkommandon `⌘1`–`⌘8`.
- **Kommandopalett `⌘K`**: sök transaktioner (text, belopp, kontakt), hoppa till vy, åtgärder ("Importera fil", "Uppdatera saldo …", "Ny fast utgift", "Registrera inkomst", "Visa privata"). Bygg på cmdk/Command.
- **Sidhuvud** per vy: rubrik, eventuell periodväljare (`←` `→` och `T` för nu), och primär åtgärd till höger.
- **Sidfoten** med databassökväg flyttas till Inställningar.
- Toasts nere till höger med Ångra där det går (ta bort, kategoriändring på flera rader, regel skapad).

## Översikt

Ordning uppifrån:

1. **Svaret.** Ett stort kort över hela bredden: "Kvar att leva på till lönen 24/9" i 40 px, "2 057 kr/dag i 6 dagar" under. Till höger i samma kort en liten stapel som visar hur "kvar" relaterar till utgiftstakten (ryms / ryms inte). Klick fäller ut uträkningen (saldon − fasta − fakturor) som i dag.
2. **Att göra.** En lista med klickbara uppgifter i stället för varningstext: "Bank Norwegian: saldo inte ifyllt → uppdatera", "12 att granska → öppna", "3 fasta utgifter passerade utan matchning → visa", "Mastercard-faktura 8 215 kr förfaller 30/9 → markera betald". Visas bara när det finns något. Var och en går att avfärda för dagen.
3. **Kommande 14 dagar.** En horisontell tidslinje med dagens datum markerat: lön (grön), fasta utgifter (prickar med namn vid hover, grupperade per dag), kortfakturors förfallodag (röd). Ersätter de fyra kontokorten med fasta utgifter, som flyttas till fliken Fasta utgifter. Under tidslinjen en rad per konto: "e-sparkonto: 12 084 kr dras före lönen · 9 st". Klick öppnar listan.
4. **Saldon** som fyra kompakta kort på en rad: namn, belopp, "uppdaterat för 0 d sedan". Klick → inline-redigering. Kreditkort visar skuld och nästa förfallodatum i kortet, med "Ny faktura…" och "markera betald" i en meny.
5. **Den här månaden, din del**: behåll staplarna men gör dem till en komponent med kategori-chip, belopp och snittmarkör; en rad per kategori, sorterad på belopp, dölj kategorier som är 0 både i år och i snitt bakom "visa alla". Växeln "Visa hela hushållet" är en segmenterad kontroll (Min del | Hushållet) som är global och minns sitt läge.
6. **Registrera engångsinkomst/utgift** flyttas till kommandopaletten och en `+`-knapp i sidhuvudet.

Nästa lön (uppskattning, förväntat belopp) blir en rad i kort 1, inte ett eget kort.

## Transaktioner

Det här är vyn som används mest – lägg mest tid här.

> Utseendet (sidhuvud, summakort, filterchips och rader) följer sedan 25/9 *Design v2: Transaktioner* längre ned. Funktionerna här gäller fortfarande.

**Lista**
- Grupperad per dag med `DateGroupHeader` ("Onsdag 16 september · −652 kr"). Sticky headers.
- Kolumner: beskrivning (etikett i medium, bankens text i grå 12 px under om etikett finns; ort/kontakt som liten text), kategori-chip, konto-badge, belopp. Delad visas som en liten lila ikon (två personer) framför beloppet, privat som öga-ikon, koppling till fast utgift som `↻`-ikon med tooltip. Anteckning visas som en rad i grått under om den finns.
- Ingen "Vems"-dropdown. Delad/eget växlas med klick på ikonen eller tangent `S`.
- Överföringar visas parade som en rad ("e-sparkonto → Privatkonto, 3 000 kr") i dämpad stil när filtret "Visa överföringar" är på.
- Ogranskade/okategoriserade rader har en liten blå prick till vänster.
- Virtualiserad lista (t.ex. `@tanstack/react-virtual`) så att 2 000+ rader är snabba. Ladda per månad; "Visa äldre" nederst.
- Summeringsrad överst: "29 transaktioner · in +500 kr · ut −4 569 kr", uppdateras med filter.

**Detaljpanel** (`SidePanel`, öppnas med klick eller `Enter`)
- Alla fält redigerbara: etikett, kategori, delad, privat, anteckning; belopp/datum bara för manuella.
- Bankens råtext, källa, import (länk), fingerprint-info bakom "Tekniskt".
- "Samma handlare": antal köp, summa och snitt senaste 12 månaderna, med länk till filtrerad lista.
- Regler som träffar raden, med möjlighet att skapa/ändra regel.
- Knappar: Ta bort (soft), Duplicera som manuell.

**Filter**
- `FilterBar` med aktiva filter som chips (`Period: sep 2026 ×`, `Konto: Norwegian ×`). "Fler filter" öppnar popover med konto, kategori (träd med kryssrutor), källa, delad/egen/alla, utan kategori (inkl. Okänt), överföringar, privata, belopp från–till.
- Sök i sidhuvudet, fokus med `/`. Söker text, etikett, kontakt, anteckning, belopp.
- Filtren sparas i URL:en så att bakåt fungerar och vyer kan länkas (Analys → stapel → lista).

**Tangentbord**
- `↑`/`↓` eller `J`/`K` flytta, `Enter` öppna panel, `Esc` stäng.
- `X` markera, `⇧X` markera intervall, `⌘A` alla synliga.
- `C` kategori (öppnar väljare med sök, senaste fem kategorierna först, `1`–`9` för de föreslagna), `S` delad, `P` privat, `N` anteckning, `L` etikett, `D` ta bort (med Ångra-toast), `U` "Vet ej".
- Alla tangenter fungerar på markerade rader om flera är markerade.
- `?` visar en ruta med alla kortkommandon.

**Kategoriväljaren** (används överallt): popover med sökfält, föreslagna kategorier överst (regelträff, bankens handlarkategori, de senaste för samma handlare), sedan trädet. `+ Ny kategori` längst ned. Efter val visas en icke-blockerande rad under: "Skapa regel för LIDL → Mat › Livsmedel? Påverkar 12 rader · [Skapa] [Nej]" som försvinner efter 8 s.

**Bulk**
- `BulkActionBar` när ≥1 rad är markerad: antal, summa, knappar Kategori / Delad / Egen / Privat / Vet ej / Ta bort.

## Att granska

Gör om till ett inbox-flöde:
- Överst en progress: "112 rader i 72 grupper · 3 gjorda i dag".
- En kolumn med kort, ett per handlare/motpart, flest rader först. Kortet visar namn, antal, summa, datumintervall, exempelrader (max 3, fäll ut för alla) och **snabbval**: sex kategoriknappar (föreslagna utifrån handlarkategori, regler och liknande handlare), knappen "Annan…" som öppnar väljaren, och "Vet ej".
- Tangentbord: `1`–`6` snabbval, `C` annan, `U` vet ej, `⇧K/⇧J` föregående/nästa kort, `R` "kom ihåg"-växeln. Efter val glider kortet ut och nästa får fokus.
- "Kom ihåg" som växel per kort med regelmönstret redigerbart bakom en liten penna.
- Möjliga dubbletter som egen flik med raderna sida vid sida och knapparna "Ta bort den nyare" / "Behåll båda".
- Swish in/ut för samma nummer visas i ett kort med två sektioner och en knapp "Samma kategori för båda".

## Fasta utgifter

> Utseendet (sidhuvud, hero, gruppkort, rader, Uppskattat och kalenderns färger) följer sedan 25/9 *Design v2: Fasta utgifter* längre ned.

- Sammanfattningskorten överst blir en rad med tre kompakta kort (Per månad totalt, Min del, Nästa 7 dagar).
- **Tabellen är en läsvy**: namn, belopp, dag, konto-badge, kategori-chip, delad-ikon, status för innevarande månad (`StatusPill`) och "senast dragen". Inga dropdowns. Klick eller `Enter` öppnar `SidePanel` med alla fält (namn, belopp, dag, betalsätt, konto, kategori, delad, match_pattern, bindningstid, länk, anteckning, paus) och historiken över dragningar med belopp per månad som små staplar.
- "Beloppet har ändrats 1 200 → 1 250" visas som en amber-rad i panelen med knapp "Uppdatera".
- **Byta plan:** under beloppet i panelen en länk *Byt plan…* som öppnar ett litet formulär (månad, nytt pris, namn på planen och, när planen redan börjat, dragdag). Sektionen *Planer* längre ned listar planerna, den nuvarande överst: namn (eller "Nuvarande plan"), pris, "dag 6" och "från oktober 2026" / "till och med september 2026" i höger kant, med en liten länk *Ångra senaste planbyte*. I historikens staplar får månaden en ny plan börjar blå stapel och tooltippen "ny plan"; har den två dragningar (den gamla planens och den nya) varnar den inte. Ett väntande byte visas som den blå raden "Från oktober 2026: Plus · 259 kr" med *Ta bort*.
- I Transaktioner, på ett köp som ser ut som en ny plan för en fast utgift, står *Byt plan för <namn>…* bland köpets åtgärder (över *Påminn innan nästa dragning…*). Formuläret är en liten ruta med en mening ("ChatGPT kostade 249 kr. Det här köpet, 937 kr, blir första dragningen på den nya planen: från oktober 2026, dragen den 6:e …"), fältet *Planens pris per månad* (förvalt köpets belopp; en länk "Köpet är bara mellanskillnaden: 249 kr + 937 kr = 1 186 kr per månad" fyller i summan, och en rad förklarar att första månaden väntas på det som drogs och de följande på planens pris), ett namnfält och *Byt plan* / *Avbryt*. Toasten har *Ångra*.
- Gruppera tabellen per konto med delsummor, kollapsbara grupper.
- **Kalendern** som riktig månadsvy (7 kolumner) med chip per dragning, färg per konto, och lönedagen markerad. Klick på en dag visar dagens poster.
- `+ Ny fast utgift` öppnar samma panel tom.

## Delad ekonomi

> Utseendet (sidhuvud, notiser, resultatkort, kvitto, avstämningskort och listkort) följer sedan 25/9 *Design v2: Delad ekonomi* längre ned.

Vyn fungerar bra i sak – behåll strukturen, förbättra formen:
- Resultatet som ett stort kort med riktningspil och belopp; uträkningen till höger som i dag men med ikoner och lite mer luft.
- Sektionerna "Delat som jag betalat" och "Mio har betalat" som två kolumner med kollapsbara grupper; radnivån visar kategori-chip och belopp.
- En liten tidslinje över de senaste sex månadernas avstämningar (kvitt / fört över X) med status.
- Knapp **"Kopiera sammanfattning"** som lägger en kort text i urklipp att skicka i Swish/Messenger: "September: Norwegian 6 514 + fasta 9 725 = 16 239 delat, hälften 8 119. Du swishar 8 119 kr."
- Formuläret "Mio har betalat" som `SidePanel`, inte inline.

## Analys

Ramen och Per kategori följer sedan 26/9 *Design v2: Analys – ram och Per kategori* nedan, Snitt *Design v2: Analys – Snitt*, Mat *Design v2: Analys – Mat*, Matvaror *Design v2: Analys – Matvaror*, Fasta mot rörliga *Design v2: Analys – Fasta mot rörliga*, Bränsle *Design v2: Analys – Bränsle*, Sparande *Design v2: Analys – Sparande*, Priser *Design v2: Analys – Priser*, Konsumentverket *Design v2: Analys – Konsumentverket* och Jämför perioder *Design v2: Analys – Jämför perioder*; de övriga flikarna har fått tokens men inte ny struktur.

- Behåll diagrammen men byt till den färgblindssäkra paletten och samma kategorifärger som i resten av appen.
- Tooltip på staplar visar alla kategorier för månaden sorterade på belopp.
- Tabellen: första kolumnen sticky, siffror tabulära, summeringsrad fetstil, negativa tal (återbetalningar) i grönt med `+`.
- Periodväljaren som segmenterad kontroll (3 mån | 6 mån | 12 mån | I år | Anpassat) i sidhuvudet, delad mellan flikarna.
- Mat-fliken: andelen ute och hämtmat överst, som en ring, med jämförelse mot förra året (klart, se *Design v2: Analys – Mat*).
- Jämför perioder: två periodkort med snabbval och en tabell med A, B och Δ som pill (klart, se *Design v2: Analys – Jämför perioder*).

## Kategorier & regler

Två paneler:
- **Vänster: kategoriträd** med antal rader och summa senaste 12 mån per kategori, färgprick, drag-and-drop för att flytta underkategorier, högerklick/`…`-meny för byt namn, färg, slå ihop, ta bort. Klick på en kategori filtrerar reglerna till höger.
- **Höger: regler** som tabell med sökfält (`/`), filter på källa (grund/manuell) och kategori, sortering på träffar. Kolumner: mönster (monospace), typ, riktning, kategori-chip, träffar. Inline-redigering av mönster och kategori. Regler utan träffar på 12 månader i en kollapsad grupp "Oanvända (23)".
- **Testa mönster**: ett fält där jag skriver ett mönster och direkt ser vilka transaktioner som skulle träffas, innan regeln sparas.
- Handlarkategorierna från Norwegian som egen flik i högerpanelen med samma layout; omappade överst i amber.

## Importer

- En alltid synlig släppyta överst ("Släpp filer här eller klicka").
- Under den ett kort per konto: "Privatkonto · senast importerad t.o.m. 18/9 · 0 dagars glapp", med amber när glappet är > 35 dagar. Det gör det uppenbart vad som saknas. *(Ersatt av statusprickarna i Design v2: Importer.)*
- Förhandsgranskningen som en tabell per fil (källa, konto, period, nya, dubbletter, fel) med en gemensam "Importera N filer"-knapp.
- Historiken som en lista med datum, fil, resultat och "Ångra" där det är möjligt.

## Inställningar

Sedan 25/9 i Design v2, se *Design v2: Inställningar* nedan.

## Responsivt

- Under 900 px: sidomenyn blir en nedre flikrad (5 ikoner + "Mer"), tabeller blir kortlistor, `SidePanel` blir fullskärm. Tidslinjen scrollar horisontellt.
- Allt ska gå att använda på en iPhone i Safari, i första hand Översikt, Transaktioner och Att granska.

## Arbetssätt

Bygg i den här ordningen och stanna efter varje steg med skärmbilder före/efter:

1. Designsystem, tokens, tema, skal med sidomeny, kommandopalett, återanvändbara komponenter. Alla befintliga vyer ska fungera i det nya skalet innan något annat rörs.
2. Transaktioner (lista, panel, filter, tangentbord, bulk, kategoriväljare).
3. Att granska.
4. Översikt.
5. Fasta utgifter.
6. Kategorier & regler.
7. Delad ekonomi, Analys, Importer, Inställningar.
8. Responsivt och genomgång av alla vyer i mörkt tema.

Skriv komponenttester (Vitest + Testing Library) för tangentbordsnavigering, kategoriväljaren, filter i URL och `BulkActionBar`. Alla befintliga servertester ska vara gröna genom hela arbetet. Committa efter varje steg.

## Design v2 (Apple-inspirerad)

**Läget 26/9: hela verktyget följer Design v2.** Vyerna och flikarna, med avsnittet som beskriver var och en:

- **Översikt** (flikar): Översikt, Kassaflöde 90 dagar, Ekonomisk situation, Pension, Att fylla i.
- **Transaktioner** (med flikarna Alla / Att granska / Borttagna), **Fasta utgifter**, **Delad ekonomi**, **Importer**, **Kategorier & regler** (Regler / Namnregler / Handlarkategorier), **Pendling & bränsle**, **Lön**, **Prylar** (Galleri / Lista / Kalender), **Inställningar**.
- **Analys** (ramen och flikarna): Per kategori, Snitt, Mat, Matvaror, Fasta mot rörliga, Topplista, Bränsle, Sparande, Priser, Konsumentverket, Jämför perioder. Fliken Prylar är borttagen (26/9).

Varje vy har sitt avsnitt *Design v2: <vy>* nedan.

En andra omgång, en vy i taget. **Översikt-fliken görs först**, övriga vyer behåller tills vidare det gamla utseendet. **Läget 25/9:** alla fem flikar i Översikt följer Design v2 (Översikt, Kassaflöde 90 dagar, Ekonomisk situation, Pension och Att fylla i), och i sidomenyn är Transaktioner, Fasta utgifter, Delad ekonomi, Importer, Kategorier & regler, Pendling & bränsle, Lön, Prylar och Inställningar omgjorda, och i Analys ramen och Per kategori. Kvar är Analys övriga flikar, och de har fortfarande det gamla utseendet (fliken Prylar är borttagen 26/9). Ren presentation: data, beräkningar och API är desamma, och ingen siffra som visas i dag får försvinna.

**Tokens.** De ligger i `web/src/styles/tokens.css` *bredvid* de gamla (`--v2-*`, mappade till Tailwind i `@theme inline`), så att en vy byter till dem när den görs om. Två saker gäller redan hela appen: sidbakgrunden (`#f5f5f7` i ljust tema) och typsnittet.

| Token (Tailwind) | Ljust | Mörkt | Används till |
|---|---|---|---|
| `canvas` | `#f5f5f7` | `#000000` | sidbakgrund |
| `card` | `#ffffff` | `#1c1c1e` | kort |
| `card-inset` | `#f5f5f7` | `#2c2c2e` | inre rutor i kort |
| `hairline` | `#f2f2f4` | `#38383a` | avdelare inne i kort |
| `track` | `#f2f2f4` | `#2c2c2e` | spår under staplar |
| `ink` / `ink-2` / `ink-3` | `#1d1d1f` / `#6e6e73` / `#86868b` | `#f5f5f7` / `#98989d` / `#8e8e93` | text primär, sekundär, tertiär |
| `accent` (`accent-hover`, `accent-soft`) | `#0071e3` (`#0077ed`, `#e5f1fc`) | `#0a84ff` (`#409cff`, `#0f2a47`) | interaktion, länkar, Köp-ringen, Safe to spend |
| `positive` / `positive-text` / `positive-soft` | `#34c759` / `#248a3d` / `#e3f5e8` | `#30d158` / `#30d158` / `#0f2e18` | under snittet, inkomst, Livsmedel-ringen |
| `caution` / `caution-text` / `caution-soft` | `#ff9500` / `#c93400` / `#fff1e0` | `#ff9f0a` / `#ff9f0a` / `#3a2608` | över snittet |
| `alarm` | `#ff3b30` | `#ff453a` | kortfaktura, "över"-varvet i ringar |
| `alarm-soft` | `#ffe5e3` | `#3d1614` | Nej-rutan i Har jag råd? |
| `eating-out` | `#5e5ce6` | `#5e5ce6` | restaurang och hämtmat |
| `job` | `#5ac8fa` | `#64d2ff` | jobb (schemat) |
| `yellow` | `#ffcc00` | `#ffd60a` | bara för att skilja en sjätte sak åt (providers i API-kostnader); betyder inget |
| `segment` / `segment-on` | `#e8e8ed` / `#ffffff` | `#2c2c2e` / `#636366` | segmenterad kontroll: spår och vald knapp |
| `neutral-bar` | `#d2d2d7` | `#48484a` | det ej placerbara i pensionens stapel |
| `accent-bar` | `#b9d6f3` | `#2b5783` | dagsstaplarna i Transaktioner (dagens dag i `accent`) |
| `purple-soft` / `purple-text` | `#f3e8fb` / `#8e44ad` | `#2e1a38` / `#d19ef0` | taggarna avstämning och "Mio betalade" |
| `band` | `#fafafa` | `#242426` | daghuvud och hovrad i listkort, gruppband i Delad ekonomi |
| `partner` | `#8e44ad` | `#9b59b6` | Mios avatar och prick i Delad ekonomi |
| `wallet-private` / `wallet-savings` / `wallet-gold` / `wallet-isk` | `#1d1d1f` / `#2c5aa0` / `#b8860b` / `#5ac8fa` | `#3a3a3c` / `#2c5aa0` / `#9a7209` / `#64d2ff` | Wallet-korten under Saldon, och samma färger i stapeln under Pengar nu (ISK-likvider) och i Fasta utgifters grupper |
| `wallet-norwegian` | `#9ecbf0` | `#6fa7d6` | Bank Norwegian, ljusblå som kortet; kortet under Saldon har mörk text (`#0f2740`) på den |
| `file-pdf` / `file-xlsx` / `file-csv` / `file-html` | `#8e44ad` / `#2ea043` / `#1d1d1f` / `#0b5fa5` | `#9b59b6` / `#2ea043` / `#636366` / `#2f7fcf` | filtypsbrickorna i Importers historik; CSV och HTML ljusare i mörkt, annars syns de inte mot kortet |
| `row-current` | `#f5f9ff` | `#16202d` | den aktuella månadens rad i en tabell (Pendling & bränsle), den utfällda månaden under Lön |
| `rounded-card` / `rounded-wallet` / `rounded-inset` | 18 / 14 / 12 px | | kort, Wallet-kort, inre rutor |
| `shadow-card` | `0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.04)` | ingen (`0 0 #0000`) | kort (i mörkt lyfter kortet genom att vara ljusare) |
| `shadow-segment` | `0 1px 3px rgba(0,0,0,.12)` | `0 1px 3px rgba(0,0,0,.4)` | vald knapp i segmenterad kontroll |

Mörkt tema är härlett från Apples mörka systemfärger (godkänt 24/9). Sidbakgrunden är `#000` i mörkt tema i hela appen, som `#f5f5f7` i ljust.

**Kontrast.** `ink-3` (`#86868b`) ger 3,6:1 på vitt och är därför bara för det som inte bär betydelse ensamt: datumaxlar, "uppdaterat i dag", kolumnrubriker. Belopp och etiketter står i `ink` eller `ink-2` (5,1:1). Vit text på guldkortet ger 3,3:1 och räcker för det stora beloppet, inte för liten text – den får högre opacitet eller mörkare guld när Saldon görs om.

**Typografi.** Systemstacken `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif` (BlinkMacSystemFont är samma typsnitt i Chrome, som inte känner `-apple-system` och annars hamnar i Helvetica Neue – där syns inte tusentalsavgränsaren), inga webbtypsnitt, `tabular-nums` i hela appen. Etiketter i normal skiftläge: ingen versalisering, ingen spärrning. Kortrubrik 16 px halvfet; stora tal fetstil med negativ spärrning (Pengar nu: 52 px, −0,03em).

**Former.** Alla pluppar, prickar och staplar är rundade. Kort har ingen kantlinje. Grafik bär aldrig betydelse ensam: procent och belopp står alltid som text bredvid, och varje SVG har `aria-label`.

**Komponenter.**
- `Card`, `CardHeader`, `InsetBox` (`web/src/components/Card.tsx`): kortet, dess rubrikrad och de grå inre rutorna.
- `SegmentedControl` med `appearance="v2"`: grått spår, vit vald knapp med lätt skugga. Används för Min del/Hushållet på Översikt; övriga vyer har kvar standardutseendet. Översikts flikrad (Översikt, Kassaflöde 90 dagar, Ekonomisk situation, Pension, Att fylla i) har samma utseende, och de flikarna delar sidhuvudet.
- `Switch` (`web/src/components/Switch.tsx`, Radix Switch): grön när den är på, med etiketten bredvid och klickbar. För val som gäller direkt.
- `PageHeader` med `appearance="v2"` (Översikt, Transaktioner): rubriken i 28 px fetstil, −0,02em. Registrera-knappen är blå (`accent`) med 10 px hörn. `HeaderTabs` lägger en vys flikar direkt efter rubriken, `HeaderActions` knapparna till höger.
- `MerchantIcon` med `shape="square"` och storlek 36: logotypen i Transaktioners rader, 10 px hörn. Monogrammen har sina färger som förut.

**Layout.** Desktop: 12-kolumnsgrid med raderna 7/5. Mobil: en kolumn i samma ordning. Kontrolleras i 390, 820 och 1 280 px, ljust och mörkt.

**Översikt i Design v2** (klar 24/9), uppifrån:
1. *Pengar nu* (7/12): stor siffra; bredvid en 10 px segmentstapel (radie 5, 2 px mellanrum, minst 4 px per segment) i Wallet-färgerna med legend; en grå ruta (radie 14) "Så här blir det den 1 oktober" med uträkningen som vita rutor (radie 10) och + − = mellan, resultatet i `accent-soft` – termerna kommer från servern, en ruta visar sina delar vid hovring/tryck, på telefon en kolumn med tecknen till vänster; hörnpillen "Räkningar till <lönedag>" fäller ut kontoraderna under kortets innehåll (inte en popover: listan är lång och klickbar per konto, och en popover skulle klippas på en telefon); fotraden med lönen och Kassaflöde →.
2. *September så här långt* (5/12): tre ringar (Köp `accent`, Livsmedel `positive`, Restaurang & hämtmat `caution`), full ring = snittet så här långt, överskottet som ett rött varv (högst ett); legenden bredvid eller under beroende på kortets bredd (containerfråga, 26 rem); veckostaplar för livsmedel och pluppar 15 per rad.
3. *Att göra*: en rad med grön bock när inget finns, annars listan i kortet.
4. *Kommande 14 dagar* (7/12): kalenderlista, i dag som blå bricka, tomma dagar ihopslagna; *Saldon* (5/12): Wallet-kort, fakturaraden på ett mörkare band så att vit text går att läsa på guldet.
5. *Ekonomisk situation* (12/12): segmenterad stapel (22 px, 2 px mellanrum) med legend.
6. *Den här månaden* (7/12): treemap där den största tar hela höjden till vänster (`treemap.ts`); *API-kostnader* (5/12): donut, tabell och en stapel per månad. Utan API-kostnader tar månaden hela raden.
7. *Veckan som gick*: fem inre rutor, Safe to spend i `accent-soft`.

Flikraden är en segmenterad kontroll. Min del/Hushållet och den blå Registrera-knappen står i sidhuvudet, som har den större rubriken. Sidomenyn är oförändrad.

### Design v2: Kassaflöde 90 dagar

Klar 25/9. Presentationen är ny, men safe to spend, lägsta punkten, dag för dag och scenarierna räknas som förut. Två saker är nya funktioner: svaret i *Har jag råd?* innan man sparar, och växeln för hur många dagar Dag för dag listar. Koden ligger i `web/src/views/overview/cashflow/`. Korten står med 20 px mellanrum, som på Översikt.

1. **Nyckeltalskortet** (`KeyFigures.tsx`) har ett kort med kurvan.
   - Till vänster står *Safe to spend* med en stor siffra: 52 px, fetstil, −0,03em, röd om den är negativ. Under den står "lägsta punkten minus bufferten", med bufferten som en grå pill (`card-inset`) och *ändra*, som leder till Inställningar som förut.
   - Till höger finns tre rutor med 12 px hörn:
     - *I dag* (grå), med "bank X · Avanza Y" och en title-text som säger var Avanza-delen kommer ifrån;
     - *Lägsta punkt* (`caution-soft`, etiketten i `caution-text`), med "dagen före lönen" när dagen efter har en lön;
     - *Om 90 dagar* (`positive-soft`, etiketten i `positive-text`), med "+X kr från i dag".
   - Under ungefär 52rem kortbredd hamnar rutorna under siffran, och under 34rem staplas de.
   - De två valen är switchar på en rad, med "Rörliga utgifter X kr/dag dras varje dag" längst till höger.
2. **Kurvan** (`CashChart.tsx`, Recharts AreaChart).
   - Grunden:
     - linjen är `accent`, 2,5 px, med en yta i gradient från 18 % till 0;
     - lönedagarna är gröna referenslinjer (`positive`, opacitet 0,25, 4 px) med "lön 23/10" överst;
     - i dag är en svart streckad linje med en svart prick på kurvan;
     - bufferten är streckad bara när den är större än 0;
     - y-axeln står till höger i jämna steg (0, 20k, 40k, 60k via `yTicks`), och x-axeln visar var 15:e dag.
   - Lägsta punkten är en röd prick med ljus glöd och en mörk pratbubbla: "Lägsta punkt · tor 22/10" och beloppet i fetstil. I mörkt tema är bubblan ljus med mörk text.
     - `placeBox` (`chartMarks.ts`) placerar bubblan där den inte täcker kurvan. Den provar i ordning över till vänster, över till höger, under och sedan högre upp. Nära vänsterkanten provas höger sida först, och en tunn linje leder ner till punkten när bubblan har lyfts.
     - På en telefon (plottyta under 480 px) används en mindre bubbla. Den utelämnas om den inte får plats utan att täcka kurvan, eftersom rutan ovanför redan har siffran.
   - Dagar där saldot faller mer än 5 000 kr från dagen före får en ring (`bigDrops`). Högst fyra ringar ritas, de största fallen.
     - Ringen är röd när dagens största post är en kortfaktura och svart annars.
     - Etiketten är till exempel "25/10 hyra + två fakturor" (`dropText`: fasta poster med namn, fakturorna räknade). Den står bara precis bredvid ringen och utelämnas annars, på telefon alltid.
   - Ett tänk om-köp som inte är sparat är en orange streckad linje från dagen före köpet. Den har en orange ring där köpet dras och etiketten "tänk om: Resa i oktober → lägst X kr". Lägsta punkten tas från serverns svar.
   - Tooltipen är vit med 10 px hörn och skugga, och visar dag, saldo och dagens händelser. På en touchskärm drar man längs kurvan.
   - Under kurvan finns en legend (figcaption), och kurvan har en aria-label med i dag, lägst, dag 90, lönerna, de stora fallen och tänk om-köpet.
3. **Har jag råd?** (`AffordCard.tsx`) har fälten Utgift/Inkomst (segmenterad), belopp med "kr" i fältet, datum, beskrivning, *Betalas med* och *Delat med Mio* (switch). *Kopiera läget* står uppe till höger.
   - När belopp och datum finns visas svaret under fälten, innan man sparar. Servern tillfrågas 300 ms efter sista tangenten (`GET /api/afford`).
     - Grön ruta med bock: "Ja. Lägsta punkten blir X kr den 22/10 i stället för Y kr, och du landar på Z kr den 24/12."
     - Orange ruta: "Knappt – lägsta punkten blir X kr den …, under bufferten på B kr."
     - Röd ruta (`alarm-soft`): "Nej – kassan går under noll den … (X kr)."
   - Färgen är serverns dom: grön, gul eller röd. När gult eller rött beror på något annat än bufferten eller noll, som "först efter lönen" eller för få månader med sparandet, står serverns skäl efter "Knappt –" eller "Nej –".
   - *Pengarna tas från* och *Spara som planerad* står till höger i rutan. En inkomst får ingen ruta, bara linjen i kurvan.
   - *Visa uträkningen* fäller ut skälen, tabellen före och efter köpet och *Räkna med pengar från ISK*.
   - Förklaringen är en rad i tertiär färg. De planerade posterna listas sist i kortet.
4. **Dag för dag** (`DayList.tsx`, `dayRows.ts`) har rubriken med en underrubrik och en segmenterad växel: *Till nästa lön* (förval), *30 dagar* eller *90 dagar*.
   - *Till nästa lön* går till och med lönen och räkningarna den betalar, alltså den första dagen med en fast dragning eller faktura inom en vecka efter lönen (23/10 → 25/10). Utan lön inom synhåll gäller 30 dagar.
   - *Visa alla 90 dagar →* står sist när inte alla dagar visas.
   - Varje dag är en rad:
     - till vänster en datumbricka, blå för i dag och orange för den lägsta dagen;
     - i mitten händelserna, med en prick i typens färg (fast `ink`, kortfaktura `alarm`, inkomst `positive`, delad ekonomi `job`, planerad `caution`), typen i tertiär färg och beloppet i en egen kolumn, där inkomster är gröna;
     - till höger saldot efter dagen i fetstil, med en 4 px stapel för nivån i förhållande till periodens högsta saldo (orange för den lägsta dagen).
   - Den lägsta dagen har alltid en rad, "Lägsta punkt · rörliga utgifter X kr/dag har dragits", även när inget annat händer den dagen.

### Design v2: Ekonomisk situation

Klar 25/9. Beräkningarna är oförändrade: pengar totalt, nettoförmögenheten, Framåt, balansräkningen, uthålligheten, flödet, CSN och historiken räknas som förut. Det enda nya är att Framåt-listan är hopfälld. Koden ligger i `web/src/views/overview/situation/`, och korten står med 20 px mellanrum.

1. **Pengar totalt** (`MoneyTotal.tsx`)
   - Stor siffra: 52 px, fetstil, −0,03em. Under den står "bankkontona, värdepapperen och likviderna på ISK · din del, aldrig hushållets".
   - Uppe till höger står switchen *Visa illikvida (bilen)*. Under den finns två pills:
     - *Nettoförmögenhet exkl. CSN*, grå;
     - *med CSN*, som får `alarm-soft` och beloppet i `caution-text` när den är negativ.
   - Under det kommer en 14 px segmentstapel (radie 7, 2 px mellanrum, minst 4 px per segment) och en legend. Stapeln har ett segment per post i siffran (`moneyBar.ts`) i Wallet-färgerna: privatkonto, e-sparkonto, ISK-värdepapper i `accent`, ISK-likvider och, med illikvida på, bilen i `ink-3`.
   - Det Mio är skyldig ingår inte i siffran och därför inte heller i stapeln. Hennes betalning räknas i Framåt, och fordran står under Tillgångar.
2. **Framåt till <dag>** (`AheadCard.tsx`, `ahead.ts`)
   - Rubriken lyder "Framåt till 23/11 · lönen efter kommer 24/11". Till höger står *Visa alla N dagar med händelser ›*, som fäller ut listan: datum till vänster, belopp med tecken (inkomster gröna) och saldot efter dagen i fetstil.
   - Ekvationen lyder "I dag + Lön 23/10 + från Mio − Hyra, fakturor, fasta utgifter = Efter lön och räkningar". Sista rutan är `accent-soft` med 22 px fetstil.
     - Termerna summeras från listans poster: inkomster för sig, utgifter för sig och planerade poster i en egen ruta. Etiketterna byggs av posterna.
     - På en telefon blir ekvationen en kolumn med tecknen till vänster.
   - Under ekvationen visas upp till tre viktiga dagar med kantlinje (`hairline`): dagen då mest dras, lönedagen och dagen då näst mest dras. Varje ruta har datum, saldo efter dagen och posterna ("Norwegian −8 168", avkortat med … efter fyra).
   - Fotnoten om kortfakturorna och Kassaflöde står kvar.
3. **Tillgångar och Skulder** (`Sheet.tsx`) är två lika breda kort, som staplas under 1 024 px.
   - Varje rad har namn, underlaget i tertiär färg, belopp och en 4 px stapel mot den största raden (minst 1 %). Tillgångarna har `accent`, skulderna `alarm`.
   - Ett korts skuld delas efter månaden den betalas: den här månaden `alarm`, senare `alarm` 40 %. Texten är "betalas i september … · i oktober …".
   - Studielånet ligger längst ned i Skulder, i en grå inre ruta med beloppet i sekundär färg och texten om att det står utanför den stora siffran.
4. **Uthållighet** (`EnduranceCard.tsx`)
   - Rubriken har en underrubrik, och till höger står pillen "Nödvändigt per månad … · fasta … + dagligvaror …".
   - Tre rutor med radie 14 px:
     - *Buffert* (`caution-soft`);
     - *Med sparandet* (`accent-soft`);
     - *Med a-kassa* (`positive-soft`).
   - Varje ruta har värdet i 34 px fetstil och enheten i 16 px sekundär färg. Under det finns en 6 px stapel på gemensam skala, där 36 månader är full bredd och den aldrig går förbi (`barShare`), och sist uträkningen i 11 px.
   - Buffertens siffra behåller sin tröskel: röd under 3 månader, orange under 6, annars grön. De andra två är ofärgade.
   - Fotraden har utgifterna (antal, delade till hälften, inget bränsle), a-kassans antaganden med *Ändra* och "Skalan i staplarna är 36 månader".
5. **Flöde per månad** (`FlowCard.tsx`, `flowBars.ts`) ersätter de två tabellerna.
   - Stapel 1 (28 px, radie 8) visar *Fasta* (`ink`), *Rörligt* (`ink-2`) och *Kvar* (`accent`) mot nettoinkomsten. Etiketten står i segmentet när den får plats och annars bara i legenden, som alltid har allt: andelen fasta av nettoinkomsten och rörligt-noten om det som kom tillbaka.
   - Stapel 2, *Vart det som blev över tog vägen*, har samma skala som stapel 1.
     - Portföljen (`positive`) och buffertkontot (`wallet-savings`) ligger i rad, och ett positivt oförklarat belopp blir ett grått segment.
     - Ett negativt oförklarat belopp är en ljusröd remsa under slutet av dem. Den börjar där Kvar slutar, och en streckad linje markerar Kvar, så att man ser 7 000 + 1 000 − 1 500 = 6 500.
   - CSN ligger längst ned i kortet: återstår, betalt i år och slutbetalt, en 8 px stapel och förklaringsraden. Stapeln visar som förut hur mycket som betalats sedan beloppet skrevs in, eftersom lånets ursprungliga belopp inte finns i data. Den börjar alltså tom.
6. **Historik och Hålls för hand** står bredvid varandra.
   - Historik (`HistoryCard.tsx`) har 12 staplar som slutar i dag:
     - `accent` för sparade månader;
     - ljusare för framräknade;
     - `segment` som platshållare där inget finns.
   - Under staplarna står tabellen över månaderna. Utan sparade månader står i stället varför, i en grå ruta med länken *Lägg in månadsvärden* till fliken Att fylla i.
   - Hålls för hand (`ManualCard.tsx`) har CSN och bilen med belopp och en rund pennknapp (`card-inset`, ikonen i `accent`) som öppnar samma redigering som förut. Sidans fotnot om vad som räknas står längst ned i kortet.

### Design v2: Pension

Klar 25/9. Det här är bara presentation: avsättningen per månad, placerbart och ej placerbart, regionfördelningen, årsbeskeden, prognosen och pensionsposterna räknas som förut. Koden ligger i `web/src/views/overview/pension/`. Korten ligger i ett 12-kolumnsgrid med 20 px mellanrum och staplas under 1 024 px.

1. **Låst till 65+** (7/12, `LockedCard.tsx`, `split.ts`)
   - Etiketten har en grå pill bredvid: "räknas aldrig in i nettoförmögenheten eller uthålligheten". Totalen står med 52 px fetstil, −0,03em.
   - Under totalen finns en 14 px stapel i två delar (radie 7, 2 px mellanrum): placerbart i `accent` och ej placerbart i `neutral-bar`.
   - Legenden har belopp och vad som ingår. Namnen tas från posterna: statens två efter slag, andra efter bolagets versalord (KPA) eller första ordet i namnet ("premiepension och avtalspension, du väljer fonder" och "inkomstpension och KPA").
   - Fotnoten lyder "Pensionen går inte att använda på decennier.", följd av hur gammalt det äldsta värdet är och att inget hämtas.
2. **Prognos från minPension** (5/12, `ForecastCard.tsx`)
   - Rubriken står i sekundär färg, med *Lägg in prognos* till höger. Knappen öppnar formuläret i kortet.
   - Varje uttagsålder får en grön ruta (`positive-soft`, radie 14):
     - "Uttag vid 69 år" i `positive-text`, med *Ta bort* i rutan;
     - beloppet i 34 px fetstil med "kr/mån före skatt" i 15 px;
     - datum och antaganden i 11 px.
   - Under rutorna står att siffrorna är minPensions. Utan prognos visas en grå ruta med samma länk.
3. **Det avsätts till din pension** (7/12, `InflowCard.tsx`, `inflowBar.ts`)
   - Rubriken har "~6 531 kr/mån" till höger, i 22 px fetstil med enheten i 13 px.
   - Under den finns en 24 px stapel (radie 8, 2 px mellanrum) med inkomstpension (`ink`), premiepension (`accent`) och SAF-LO (`wallet-isk`).
     - Etiketten "Namn belopp" står i segmentet när den får plats, annars bara beloppet, annars ingenting.
   - Sedan kommer de tre raderna med prick, namn, regel, kreditering, not och belopp.
   - Sist en grå ruta: "Ingen antagen avkastning, bara det som sätts av.", följd av räkneunderlaget.
4. **Placerbart kapital per region** (5/12, `RegionCard.tsx`, `regions.ts`)
   - Kortet har en donut i SVG, 16 px bred, med summan placerbart i mitten. Legenden visar procent och belopp.
   - Färgen följer regionen: USA `caution`, Global `accent`, Sverige `positive` och Annat `eating-out`. En okänd region får nästa reservfärg.
   - Policyavvikelsen står i en orange ruta (`caution-soft`) med ett "!" i `caution-text`. Utan avvikelse visas ingen ruta.
5. **Värden från minpension.se** (`EntriesCard.tsx`, `initials.ts`)
   - Rubriken har *+ Lägg till pensionspost* till höger.
   - Varje post är en rad:
     - en 36 px bricka (radie 10) med bolagets initialer (PM, LF, KPA), `accent-soft` för placerbara och `card-inset` för ej placerbara;
     - namnet med en "avslutad"-pill när det gäller;
     - undertexten;
     - fonderna som punktrader i regionens färg;
     - beloppet i fetstil och en rund pennknapp.
6. **Årsbesked** (`StatementsCard.tsx`)
   - Rubriken har *+ Lägg in årsbesked* till höger.
   - Kolumnerna är:
     - inkomstår, med jämförelsen mot lönespecarna eller "inga lönespecar … att jämföra med";
     - en 8 px stapel för pensionsgrundande inkomst mot taket 7,5 inkomstbasbelopp, det årets när det finns, annars årets;
     - PGI, inkomstpension och premiepension, med "beräknat … (±…)" under när det finns en jämförelse;
     - *Ta bort*.
   - En fotnot förklarar stapeln. På en telefon blir varje år ett litet kort.

### Design v2: Att fylla i

Klar 25/9. Uppgifterna, grupperna, statusreglerna och vart *Fyll i* leder är oförändrade. Nytt är statusfiltret och att grupperna kan fällas ihop. Koden ligger i `web/src/views/overview/manual/`, och korten står med 20 px mellanrum.

1. **Överst** (`StatusFilter.tsx`, `status.ts`)
   - Förklaringen står till vänster i sekundär färg. Är allt aktuellt står "Allt är aktuellt." efter den.
   - Till höger finns statusfiltret som segmented control: *Alla · N*, *Snart dags · N*, *Inaktuell · N* (räknar också Aldrig ifylld), *Aktuell · N* och *Vid behov · N*.
     - Varje val har en färgprick: `positive`, `caution`, `alarm` eller `neutral-bar`.
     - Ett val visar bara matchande rader och döljer grupper som blir tomma. Valet sparas som `?status=soon|late|ok|info` bredvid `flik=`.
     - På en telefon blir filtret en rad chips som skrollar i sidled.
2. **Behöver fyllas i** (`NeedsCard.tsx`, `Row.tsx`)
   - Ett vitt kort med 4 px vänsterkant i `caution`, eller `alarm` när något är inaktuellt eller aldrig ifyllt.
   - Rubriken har antalet i `caution-text` ("1 behöver fyllas i · 2 snart dags").
   - Raderna har fyra kolumner:
     - uppgiften (14 px) med "Från: källa · not" i 11 px tertiär färg;
     - typ och hur ofta;
     - senast: statusprick, datum i fetstil och under det ålder och ifyllt-datum;
     - en blå knapp *Fyll i* (90 px).
   - Kortet döljs helt när inget behöver fyllas i.
3. **Grupperna** (`GroupCard.tsx`) är ett hopfällbart kort per grupp (Radix Collapsible), i samma ordning som förut.
   - Rubrikraden har:
     - gruppnamnet (15 px, 600);
     - en pill: "4 av 4 aktuella" (`positive-soft`), "2 aktuella · 1 vid behov" (grå), eller orange/röd när något är snart dags eller inaktuellt;
     - "äldst …" i tertiär färg, som är den äldsta radens ålder, eller äldsta datumet när ingen rad är äldre än i dag;
     - en chevron.
   - Förvalt är gruppen hopfälld när alla rader är aktuella eller vid behov, och annars utfälld. Ett val gjort för hand sparas per grupp i localStorage (`manual.group.<namn>`).
   - Med ett filter valt är alla grupper med träffar utfällda, och ett val gjort då sparas inte.
   - Raderna har samma kolumner som i punkt 2. Statusordet är ersatt av pricken, med ordet som aria-label och title, och *Fyll i ›* är en textlänk.
4. **Fotnoten** förklarar hopfällningen och prickarnas färger.
5. **På en telefon** blir varje rad ett litet kort: uppgiften överst, typen, senast med pricken och *Fyll i* som knapp längst ned. Gruppens "äldst" hamnar på en egen rad.

### Design v2: Transaktioner

Klar 25/9. Listans innehåll, grupperingen per dag, taggarna, sökningen, tangentbordet, bulkfältet, detaljpanelen och filtrens logik är oförändrade. Nytt är summakorten, att filtren är chips, två nya filter (*Återkommande*, *Med kvitto*) och sorteringen. Koden ligger i `web/src/views/transactions/` (korten i `summary/`).

1. **Sidhuvudet**
   - Rubriken i 28 px fetstil. Direkt efter den flikarna *Alla / Att granska / Borttagna* som segmenterad kontroll (`HeaderTabs`). Att granska har en orange räknare (`caution`, vit text) när det finns något att granska; Borttagna behåller sin siffra i grått.
   - Till höger månadsväljaren som segmenterad kontroll: ‹, månaden som vit knapp (öppnar samma meny som förut), ›. Sökfältet är grått (`segment`, 10 px hörn) med sökikon och "/" som liten vit bricka. Kortkommandon (?) är en ghost-knapp.
   - På en telefon står flikarna under rubriken och sökfältet på en egen rad.
2. **Summakorten** (`SummaryCards.tsx`, `dayBars.ts`), 5/12 + 7/12 när listan är minst 56 rem bred, annars staplade.
   - *September · 55 transaktioner*: In (`positive-soft`, etikett `positive-text`), Ut (`card-inset`) och Netto (`accent-soft`, etikett `accent`) i hela kronor, fetstil 15–18 px (krymper med rutan). Samma summor som den gamla textraden; exakta beloppet vid hovring. Fotnoten "Överföringar, avstämning och returnerade köp räknas inte.", med meningen om uppdelade köp när ett kategorifilter räknar bara delar.
   - *Utgifter per dag* (bara när perioden är en månad): en stapel per dag, skalad mot månadens största dag, dagar utan utgift som grå streck (`segment`), dagens dag i `accent` och övriga i `accent-bar`, etikett den 1:a, var femte dag och sista dagen. Utgift = samma som Ut (serverns `totals.outByDay`, så staplarna summerar till Ut). Hovring visar datum och belopp; klick skrollar listan till dagen och lyser upp daghuvudet en stund.
   - Korten finns bara under Alla. Medan första listan laddas står skelett i samma former.
3. **Filterchips** (`FilterChips` i `TxFilters.tsx`), helrundade, under korten. Aktiva är svarta (`ink`) med vit text, inaktiva vita med lätt skugga.
   - *Utan kategori · N* (N = rader utan kategori i perioden, med övriga filter), *Konto ▾* och *Kategori ▾* (dagens paneler), *Delade med Mio*, *Återkommande*, *Med kvitto* och *Fler ▾* med källa, vems, belopp, inkl. Okänt, överföringar och bara privata. Ett filter från Fler, och sökningen, står som eget svart chip med × som tar bort det. *Rensa* behåller period och sortering.
   - *Sortering: datum ▾* längst till höger: nyast först (standard) eller äldst först.
   - På datorn bryts raden vid behov; på telefon skrollar den i sidled.
4. **Listan** i ett vitt kort (18 px hörn).
   - Daghuvud som ljusgrått band (`band`, 1 px `hairline` ovanför) med veckodag och datum i 12 px 600 sekundär färg och dagssumman till höger (grön om positiv). Det sitter kvar överst när man skrollar.
   - Rad ca 56 px i sex kolumner: logotyp 36 px (10 px hörn; markeringsrutan ovanpå vid hovring, en prick i hörnet när kategori saknas), namn 14 px 500 med anteckningen som litet chip (`card-inset`, 11 px 600) och taggarna efter (avstämning och partner betalade `purple-*`, återbetalning `positive-*`, övriga grå), plats eller kontakt i 11 px tertiär under; kategori med 8 px färgprick; konto i 11 px sekundär; ikonerna i tertiär färg; beloppet 14 px fetstil, inkomster `positive-text`, återbetalningar genomstrukna i grönt och returnerade köp genomstrukna i grått, med namnet dämpat.
   - Hovring ger `band`. Klick öppnar detaljpanelen som förut. *Visa äldre · augusti 2026* är en centrerad länk längst ned i kortet.
5. **Bredder** styrs av listans bredd (containerfrågor), inte fönstrets. Under 860 px flyttar kontot in under namnet; under 560 px (telefon) står taggarna, kategorin, kontot, platsen och ikonerna på en rad under namnet.

### Design v2: Fasta utgifter

Klar 25/9. Beloppen, grupperna, taggarna, statusarna, Min del/Hushållet, Lista/Kalender och Uppskattat-logiken är oförändrade. Nytt är lönestapeln och rutan *Den här månaden*. Koden ligger i `web/src/views/recurring/` (heron i `hero/`).

1. **Sidhuvudet:** rubriken i 28 px fetstil; Min del/Hushållet och Lista/Kalender som två segmenterade kontroller (`appearance="v2"`); *+ Ny fast utgift* som blå fylld knapp.
2. **Hero** (`Hero.tsx`, `salaryBar.ts`, `thisMonth.ts`), 8/12 + 4/12 när listan är minst 56 rem bred, annars staplat.
   - Vänster kort: "Fasta utgifter per månad, min del" (eller "…, hushållet"), summan i 52 px fetstil. Till höger "Med mat och bränsle X kr" och "av snittlönen Y kr" (bara Min del, med snittets månader i tooltip).
   - Lönestapeln: 22 px hög, radie 11, 2 px mellanrum, hela bredden är snittlönen. Segmenten är Fasta (`wallet-private`, vit text), Mat (`positive`) och Bränsle (`caution`), båda med mörk text eftersom vit är för svag i 11 px, och *Kvar av lönen* (`accent-soft`, text `accent`). Ett segment visar namn och belopp om det ryms, annars bara beloppet om det är minst cirka 60 px, annars inget. Det som inte ryms står i raden under med en färgprick. Över lönen försvinner Kvar-segmentet, stapeln får röd kontur (`alarm`) och "X kr över snittlönen". Under Hushållet finns ingen lön: segmenten är delar av summan.
   - Under stapeln: "utan mat och bränsle är X kr kvar av lönen" (eller hur mycket över), under Hushållet uppdelningen per betalsätt. Till höger noten om hur mat (snitt tre månader eller hushållets belopp, din del) och bränsle (Pendling & bränsle) uppskattas.
   - Höger kolumn: *Den här månaden* med kvar att dra i 20 px fetstil, "N av M kommande" och en 6 px stapel (dragna av alla, `positive`). Kvar att dra är allt som inte är draget eller markerat betalt denna månad, också förfallet och passerat, så det är gruppernas "kvar denna månad" tillsammans. Under den två små kort: *Eget* ("per månad · delat Y") och *Årsvis* ("per år · Z kr/mån").
3. **Listan** (`ExpenseTable.tsx`): ett kort per grupp (konto, sist Årsvis) i samma ordning som förut.
   - Huvudet är ett ljusgrått band (`band`) med en 10 px färgruta i kontots Wallet-färg (privatkonto, e-sparkonto, Mastercard, Norwegian, Årsvis `ink-3`; i mörkt med en svag kant), namnet i 14 px 600 och antalet i tertiär färg. Till höger "kvar denna månad · nästa <datum>" (Årsvis också summan per år), kr/mån i fetstil och en chevron. Hela bandet fäller ihop gruppen, och det sparas per grupp i localStorage (`recurring.collapsed`).
   - En rad i sju kolumner:
     - logotyp 32 px (10 px hörn);
     - namn och taggar som pills: bunden och pausad grå, "N avvek" orange (`caution-*`), "+ Mobilabonnemang" och "i Bredbands dragning" blå (`accent-*`), schemaförslaget som lampa;
     - belopp i fetstil, orange med pil när det ökat, med "halva av … · per år" i 10 px under;
     - dag i fetstil med "nästa <datum>" i tertiär färg;
     - kategori med färgprick och delad-ikonen efter;
     - status-pill: dragen `positive-*`, kommande `card-inset`/`ink-2`, förfallen `alarm-*`, passerad `caution-*`, "i år" efter för årsvisa;
     - senast dragen i 11 px tertiär, högerställd.
   - Pausade rader har namnet i tertiär färg. Kontokolumnen är borttagen, eftersom kontot står i huvudet. Klick eller Enter öppnar panelen som förut.
4. **Uppskattat** (`Estimates.tsx`): ett kort med förklaringen inline efter rubriken i sekundär färg. Mat och Bränsle har ikoner i grön och orange bricka, samma texter och hushållets matbelopp i ett Apple-fält (kant `neutral-bar`, radie 8, högerställt). *öppna* och *använd snittet* är blå länkar.
5. **Kalendern** (`MonthCalendar.tsx`): samma layout, men månaden är ett kort med hårlinjer mellan dagarna. Veckodagar och helger ligger på `band`, dagens dag är blå och lönedagen grön. Chipsen och legenden har kontonas Wallet-färger, och daglistan under är ett kort.
6. **Bredder:** listans bredd styr. Under 760 px blir varje rad ett litet kort: belopp och dag under namnet, kategorin under dem, status och senast dragen i en kolumn. Taggarna radbryts i stället för att korta namnet. Gruppens huvud har namn och kr/mån på en rad och kvar och nästa under. Heron staplas och Uppskattats rader lägger fält och belopp under texten.

### Design v2: Delad ekonomi

Klar 25/9. Avstämningslogiken, uträkningen, listorna, knapparna (Stäm av, För över, Mio har betalat, Kopiera sammanfattning) och texterna är oförändrade. Koden ligger i `web/src/views/shared/`: `Hero.tsx`, `Receipt.tsx`, `History.tsx`, `Notices.tsx`, `status.ts` och `SharedLists.tsx`.

1. **Sidhuvudet:** rubriken i 28 px fetstil; månaden som segmenterad kontroll ‹ månad › (*I dag* när en annan månad visas); *Kopiera sammanfattning* som vit knapp med lätt skugga; *+ Mio har betalat* som blå fylld knapp.
2. **Notiserna** (`Notices.tsx`) står i en orange ruta (`caution-soft`, radie 12) med ett "!" i `caution-text` före varje. En import som saknar dagar har *Importera ›* till höger, som leder till Importer. Rutan finns bara när det finns något att säga.
3. **Resultatkortet** (`Hero.tsx`, 7/12): "Att betala den <datum>" eller "Resultat för <månad>".
   - Uppe till höger en statuspill (`status.ts`): "<månad> · öppen" (`accent-soft`/`accent`), "avstämd, kvitt" (`positive-*`), "förd över" (`card-inset`/`ink-2`), "avviker" (`alarm-soft`/`caution-text`).
   - Tre kolumner: *Jag* som 56 px cirkel (`wallet-private`) med initialen från *Ditt namn* (J utan), och "lagt ut X kr" under; i mitten "Mio ska betala dig" / "Du ska betala Mio" / "Ni är jämna", beloppet i 44 px fetstil och en 2 px grön linje (`positive`) med pilspets mot den som får pengarna, med "← pengarna går åt det här hållet" (eller →); *Mio* i `partner`. Vid 0 kr ingen pil, i stället "ni är kvitt". "Lagt ut" är det delade: uträkningens två första rader.
   - Under: förklaringen, sedan anteckningsfältet, *Stäm av: vi är kvitt* (svart fylld) och *För över X kr till <månad>* (grå) på en rad, och hjälptexten i tertiär färg. En låst månad visar avstämningen, en röd ruta om den avviker, och *Lås upp* i samma stil.
   - Under 28 rem kortbredd står avatarerna på en rad över beloppet.
4. **Uträkningen** (`Receipt.tsx`, 5/12) är ett kvitto. Varje rad har en 22 px rund operatorbricka (`card-inset`, − + =), namnet med en not i tertiär färg ("(15 393 − 0) / 2", "avstämd, kvitt") och beloppet högerställt. Sista raden har svart bricka, fetstil och en 1 px svart linje ovanför. Avviker månaden visas avstämt · nu bredvid varandra. Förklaringen står under i tertiär färg. Korten är lika höga.
5. **Senaste avstämningarna** (`History.tsx`): rubriken i 13 px 600 och ett vitt kort per månad (radie 12, lätt skugga, den visade med 2 px blå ring) med månaden, samma statuspill som i punkt 3 och riktning och belopp i 14 px fetstil. På telefon skrollar korten i sidled. Till höger på raden står "Löpande saldo räknas från <månad år> · ändra". *ändra* visar startmånadens fält, och "Månader före det för inget vidare." ligger i tooltip.
6. **Listorna** (`SharedLists.tsx`) står i två kolumner.
   - *Delat som jag betalat*: ett kort med rubrik och summa. Bank Norwegian, Fasta utgifter och Mios köp som jag betalat är ljusgrå band (`band`) med chevron, beskrivning, antal och summa, och fälls ut. Raderna har datum i tertiär färg, namnet med pills (förväntat grå, betalas <datum> blå) som bryts till en egen rad hellre än att klippas, kategori och belopp. Fotnoten om när posterna räknas står under kortet.
   - *Mio har betalat*: ett kort med rubrik och summa. Tomt läge har en lila M-cirkel, rubrik, text och en grå knapp *Mio har betalat…*. Annars rader i samma stil (bara mitt som lila pill), med ta bort.
   - *Överföringar mellan oss*: ett kort med *Från Mio* (grön prick) och *Till Mio* (`partner`-prick, chevron, antal och "varav N räknas inte") som band. Ett tomt håll står som "Från Mio · inget i september · 0 kr". Swish-raderna har ingen kategorikolumn, eftersom den alltid är partnerns. *räkna inte* och *vad gällde den?* finns kvar. Swish-förklaringen står som fotnot i kortet.
7. **Bredder:** under 56 rem listbredd staplas resultatkortet och kvittot, och listorna staplas. På telefon ligger avatarerna på en rad över beloppet, och kategorin göms på raderna.

### Design v2: Importer

Klar 25/9. Importlogiken, dubblettskyddet, förhandsgranskningen, Ångra och kontokortens data är oförändrade. Nytt är historikens gruppering, filter och sidor, och texten om nästa banksynk. Koden ligger i `web/src/views/imports/`: `Header.tsx` och `nextSync.ts`, `DropZone.tsx`, `AccountCards.tsx` och `coverage.ts`, `history/History.tsx` och `history/group.ts`.

1. **Sidhuvudet:** rubriken i 28 px fetstil. Till höger i tertiär färg "Banksynk kl 06, 12 och 18 · nästa i dag 18:00" (eller *i morgon 06:00* efter sista körningen), räknat i svensk tid från timmarna i `GET /api/enable-banking/status` (`syncHours`, samma lista som cron-schemat). Går ett samtycke ut inom 30 dagar står i stället "Bankkopplingen går ut 16 oktober · förnya" i `caution-text`, där *förnya* leder till Inställningar › Bankkopplingar. Utan bankkoppling står inget.
2. **Släppytan** (`DropZone.tsx`): ett vitt kort med 2 px streckad kant (`neutral-bar`), en 48 px blå ikonbricka (`accent-soft`/`accent`), "Släpp filer här eller klicka", filtyperna på en rad med · mellan i sekundär färg, och en blå *Välj filer* till höger (samma filväljare som ett klick på ytan och ⌘K › *Importera fil*). När filer dras över blir kanten `accent` och bakgrunden `accent-soft`. Förhandsgranskningen och resultatet står i v2-kort med v2-färgerna, i övrigt som förut.
3. **Kontokorten** (`AccountCards.tsx`, radie 14): namnet i 13 px 600, en statusprick uppe till höger, "t.o.m. <datum>" i 20 px 600, och under det glappet i färg ("inget glapp" grönt, annars grått, orange eller rött som pricken) och till höger hur kontot får data ("Enable Banking", "faktura-PDF, manuellt", "CSV, manuellt", "XLSX/faktura-PDF, manuellt").
   - **Pricken efter dagar** (bankkonton och allt som synkas): grön vid högst 1 dags glapp, orange 2–7 dagar, röd efter det.
   - **Pricken efter faktura** (kreditkort som importeras för hand, i dag Mastercard): grön tills nästa faktura väntas (där den senaste fakturan säger att nästa slutar, annars en månad efter dess period), orange de 7 dagarna efter, sedan röd. Kortets title säger när nästa faktura väntas.
   - För ett konto som synkas räknas senaste lyckade hämtningen som t.o.m.-datum, även när den inte gav något nytt.
4. **Historiken** (`history/`) i ett kort:
   - Rubriken med en segmenterad kontroll *Alla / Filer / Banksynkar*; filtret sparas i URL:en (`?visa=filer`, `?visa=banksynkar`).
   - Ett dagsband (`band`) per svensk dag: veckodag och datum till vänster, summeringen till höger ("3 filer · 3 banksynkar · 4 nya · 27 dubbletter", det som är noll utelämnas).
   - Filimporter är alltid egna rader: tid, 32 px filtypsbricka (`file-*`: PDF, XLS, CSV, HTML), filnamnet och "källa · period" i tertiär färg (året bara när det inte är i år), pills "N nya" (grön när N > 0, annars grå), "N dubbletter" (grå) eller "hyresavi" (blå), och *↺ Ångra* som länk när det går, annars ett streck i `neutral-bar` med skälet i title.
   - Banksynkar har en grå ⟳-bricka. I dag och i går visas de en och en; äldre dagar samlas på en rad per dag ("N banksynkar · konton", "X nya · Y dubbletter · klicka för att visa") som fälls ut. Flera äldre dagar i rad med bara synkar blir ett band ("Onsdag 23 – måndag 21 september") med en rad; de utfällda raderna har datum vid tiden.
   - *Visa äldre · <datum> och tidigare (N importer)* längst ned laddar nästa sida. En fotnot under kortet förklarar grupperingen och när Ångra finns.
5. **Bredder:** kontokorten står fyra i rad, två och två under 60 rem och i en kolumn under 34 rem. Under 40 rem kortbredd hamnar historikens pills under namnet.
6. **CSV från en annan bank** (`CsvImport.tsx`): under släppytan en rad "Står din bank inte i listan? *Läs in en CSV från en annan bank*" (och, utan konton, *Du har inga konton än: skapa ett*). Länken öppnar en dialog (radie 14, bred, scrollar i höjd): fil och konto överst (kontona är de med källan CSV eller utan källa, *Nytt konto…* öppnar `NewAccount`; ett enda konto är redan valt). När filen är vald visas en rad om var kolumnerna kommer från (kontots sparade, en gissning eller dina ändringar) och formuläret: skiljetecken, rader att hoppa över, *Första raden är rubriker* (switch), datumkolumn och hur datumet skrivs, textkolumn och *Mer text*, beloppet som *En kolumn* / *Uttag och insättning* (segmenterad kontroll) med sina kolumner, *Utgifter har minustecken* (switch) och decimaltecken. Under det en tabell med filens första rader där varje kolumns rubrik har sin roll under sig i blått (Datum, Text, Belopp …), och en rad med resultatet: antal transaktioner och period, hur många som är nya, hur många som finns redan och hur många som saknar kategori, och de första raderna som de läses. Går något inte att läsa visas felet med radnummer i rött. *Importera N nya* (blå) är avstängd tills filen går att läsa och något är nytt. Ändringar frågas om efter 200 ms. På telefon blir formuläret en kolumn.

### Design v2: Kategorier & regler

Klar 25/9. Regelmotorn, namnreglerna, handlarkategorierna, drag-och-släpp i trädet, menyerna och kortkommandona är oförändrade. Nytt är sökning och hopfällning i trädet, chips med antal, *Välj kategori* direkt i raden och *Rensa oanvända*. Koden ligger i `web/src/views/categories/`: `CategoryTree.tsx` och `treeFilter.ts`, `RulesPanel.tsx`, `rulesFilter.ts`, `PatternTester.tsx` och `PruneDialog.tsx`, `NameRules.tsx`, `MerchantMap.tsx`.

1. **Sidhuvudet:** rubriken i 28 px fetstil; *+ Ny huvudkategori* som blå fylld knapp.
2. **Kategoriträdet** (vänster kort, 340 px, klistrat vid skroll):
   - "Kategorier" med en segmenterad kontroll *12 mån / i år* för rader och summa (`GET /api/categories/usage` ger också `countYtd`/`sumYtd`), sparad i localStorage.
   - Ett grått sökfält (`card-inset`, radie 9) som filtrerar på namn och tål å/ä/ö. En huvudkategori som matchar visar alla sina underkategorier, annars bara de som matchar. Under sökning är allt utfällt.
   - *Alla kategorier* är ljusblå (`accent-soft`) när den är vald, med "rader · summa" till höger.
   - Huvudkategorier: chevron, 10 px prick, namnet i 13 px 600, taggar som pills (*avstämning* lila, *överföring* och *Vet ej* grå), antal i tertiär och summan i fetstil (inkomst i `positive-text`). Underkategorier är indragna med en 8 px prick (opacitet .7), antal i tertiär och summa i sekundär. Hopfällningen per huvudkategori sparas i localStorage; allt är utfällt från början.
   - Drag-och-släpp, högerklick och ⋯ som förut; hinten som fotnot i tertiär.
3. **Flikarna** till höger är en segmenterad kontroll: *Regler 220 / Namnregler 18 / Handlarkategorier* med antalen i grått och ett orange märke "N saknar" (bankkategorier där något köp saknar kategori).
4. **Regler:**
   - *Testa mönster* är ett eget kort: 32 px blå ikonbricka, rubrik och förklaring, en monospace-rad och *Testa*. Typ, riktning, kategori, *Spara som regel* och raderna visas under när ett mönster skrivits.
   - Tabellkortet: grått sökfält med "/", chips *Alla / Grund · N / Manuella · N / Saknar ikon* (aktivt chip svart) och sorteringen *Flest träffar ▾* med A–Ö. Ett chips antal är de rader tabellen visar med det valt (använda och oanvända), med övriga filter som de är. *Manuella* tar med LLM:ens.
   - Kolumner: 26 px ikon (en grå bricka med "?" utan varumärke eller bild), mönstret i monospace 12 px, typen som pill (grå, regex blå), riktning, kategori med prick, källa i tertiär och träffar i fetstil ("–" vid noll).
   - 50 rader i taget, med "… N regler till · visa alla".
   - *Oanvända (N) · ingen träff de senaste 12 månaderna* är ett grått band (`band`), hopfällt, med *Rensa oanvända …*. Dialogen listar reglerna med kryssrutor, ingen ikryssad från början, och tar bort de ikryssade (`POST /api/rules/delete`). Toasten har Ångra (`POST /api/rules/restore` med listan).
5. **Namnregler:** "Namnregler 18" med förklaringen på raden i tertiär, formuläret i en grå ruta (`card-inset`, radie 12): mönster i monospace → namn och en blå *Lägg till*. Listan visar "mönster → **namn**", antal rader i tertiär och en papperskorg (Trash2) som frågar först.
6. **Handlarkategorier:** förklaringen i tertiär efter rubriken, chips *Ej kopplade · N* (valt från början när N > 0) och *Alla · M*, sökfältet till höger. Raden har bankens kategori i 500 och vår med prick. En rad utan koppling har *Välj kategori ▾*, som öppnar kategoriväljaren utan att lämna listan; efter valet tonar raden ut ur *Ej kopplade* på 300 ms. Har bankkategorin köp som saknar kategori står "N köp utan kategori" efter namnet i `caution-text`, raden har en 3 px orange vänsterkant (`caution`) och knappen är `caution-soft`/`caution-text`; annars är knappen grå (`card-inset`). Den gula bakgrunden är borta.
7. **Bredder:** under 52 rem vybredd (820 px, eller 1024 med sidomenyn) blir trädet en egen flik, *Kategorier* först (`?flik=kategorier`), och ett val där går vidare till reglerna. På telefon får flikarna korta namn utan antal (*Namn*, *Handlare*). Under 560 px tabellbredd står kategori, typ, riktning och källa på en rad under mönstret.

### Design v2: Pendling & bränsle

Klar 25/9. Alla beräkningar (kvar att tanka, beräknat och tankat per månad, kalibrerad förbrukning, reseavdrag, tröskel, mätarställning) och all inmatning är oförändrade. Koden ligger i `web/src/views/commute/`: `FuelHero.tsx` och `gauge.ts`, `Deduction.tsx` och `threshold.ts`, `ShiftsCard.tsx`, `MonthBars.tsx` och `months.ts`, `Receipts.tsx`, `Odometer.tsx`.

1. **Sidhuvudet:** rubriken i 28 px fetstil; till höger i tertiär "40 km per pass · 200 km övrig körning per månad · ändra" (till Inställningar › Bil).
2. **Heron** (7/12), "September · kvar att tanka":
   - "ca 424 kr" i 52 px fetstil, och till höger två grå pills: "14 pass · 760 km" och "50 kr per pass".
   - **Tankmätaren** (22 px, radie 11): den gröna delen är tankat av beräknat, med "Tankat X kr · <datum> <mack>" (den senaste tankningen, "+N" när fler) i mörk text i stapeln och "kvar Y" i den grå resten. Tankat lika med beräknat (i hela kronor): full stapel och "precis det beräknade". Över: full stapel och "Z kr över beräknat" i orange. Ett klick visar månadens tankningar i en popover, resor överstrukna.
   - Under: "beräknat för månaden X kr · räknas in i Översiktens 'kvar att leva på'" (med trängselskatt och nästa månads pass och belopp när de finns), och dieselpriset med källa (eget med datum och ålder, eller riksnittet med skälet) och *nytt pris*.
   - Tre grå rutor (`card-inset`, radie 10): *Förbrukning, kalibrerad* (l/100 km, månaderna och spridningen, tabellvärdet; förklaringen i en popover på rutan), *Snitt 12 mån* (tankat och beräknat per månad över de avslutade månaderna med pass, högst tolv) och *Mätarställning* (senaste avläsningen och km sedan den första).
3. **Reseavdrag** (5/12, lika högt som heron): året som liten segmenterad kontroll; en grön ruta (`positive-soft`) med "Avdragsgillt hittills" i 34 px och skatteeffekten vid marginalskatten; en tröskelstapel på 8 px där hela bredden är det uträknade beloppet ("172 pass × 4 mil × 25 kr/mil = 17 200 kr", "tröskel 15 000 kr"), grå upp till tröskeln, grön efter och en svart markör vid tröskeln, med förklaringen under. Under tröskeln är stapeln grå och texten "X kr kvar till tröskeln · avdrag först efter N pass, M kvar" orange. Villkoren med grön bock. Längst ned *Underlag per månad ›*, som fäller ut passlistan (månad, pass, datum, totalt) i kortet, och *↓ CSV* och *✎ Ändra* som länkar.
4. **Pass per månad:** rubrik med legenden beräknat (`accent-bar`) / tankat (`positive`); ett stapeldiagram på 90 px med två staplar per månad över samma 13 månader som tabellen (ett år bakåt till i dag, äldst först), den aktuella månadens etikett i blått och beloppen vid hover. Tabellen: pass som en grå pill med värdet och en kalenderikon (samma redigering och kalender), den aktuella månaden med "nu"-pill och `row-current`, osäker l/100 km i orange i stället för "?", "+ resa" i tertiär. De kommande månaderna, där pass fylls i i förväg, fälls ut under "nu" (*Kommande månader (3) ›*). Fotnoten nämner kalenderikonen.
5. **Tankningar med kvitto** (7/12): rubrik med förklaring; tankningar utan kvitto som orange chips (`caution-soft`/`caution-text`) överst med *lägg till*, som öppnar kvittoformuläret; kvittorader med datum, mack, liter, literpris i fetstil, rabatten i grönt och en papperskorg; de 8 senaste och *Visa alla N ›*.
6. **Mätarställning** (5/12): förklaringen (med förslaget på övrig körning och *Använd*), avläsningarna som rader med papperskorg, och datum, km och en blå *Lägg till* i en grå ruta.
7. **Bredder:** under 56 rem vybredd staplas korten i en kolumn. Staplarna skrollar i sidled på smal skärm. Under 560 px kortbredd visar tabellen inte Km och Pris; ett tryck på månaden ("sep 25") fäller ut dem, och resorna.

### Design v2: Lön

Klar 25/9. Löneberäkningen, prognosen, semesterregeln, formuläret och inläsningen av lönespecar är oförändrade; nytt är bara heron, som sammanställer siffror som redan fanns. Koden ligger i `web/src/views/salary/`: `NextSalary.tsx` med `HoursBar.tsx` och `hours.ts`, `Vacation.tsx`, `MonthForm.tsx` med `draft.ts` och `UnitInput.tsx`, `MonthsTable.tsx` med `Payslip.tsx` och `payStatus.ts`, `payMonths.ts` (vilken månad nästa lön gäller, senast utbetald, formulärets startmånad) och `Quarter.tsx` (varningen för kvartalsövertid).

1. **Sidhuvudet:** rubriken i 28 px fetstil; till höger i tertiär "Arbetsmånaden betalas den 25:e månaden efter · mått 140 tim · heltid 173,3 tim" (lönedagen och eftersläpningen ur inställningarna, måttet och heltiden ur de senaste konstanterna).
2. **Heron** (7/12, hela bredden när det inte finns någon semester att visa), "Nästa lön · 23/10 · prognos för september":
   - Arbetsmånaden är den som nästa lön gäller: fram till lönedagen förra månadens (med eftersläpning), efter den den här månadens, och nästa när lönen för den redan har kommit in (Swedbank bokför den dagen före).
   - Nettot i 52 px fetstil; till höger "brutto X kr · skatt tabell 32" och "en timme till är värd 200 kr brutto; från 211,8 tim 300 kr" (samma text som tidigare).
   - **Timstapeln** (12 px, radie 6, spår `segment`): timmarna av heltid i blått, en svart markör vid måttet med "140" under och "173,3" vid högerkanten. Över stapeln "Timmar i september 145 · 14 pass" (passen i Pendling) och "mått 140 · heltid 173,3". Över heltid: full stapel och "+X tim över heltid" i orange. Passerar kvartalet heltid i snitt står varningen under stapeln.
   - Två grå rutor: *Senast utbetalt · 25/9* (grön `positive-soft` när lönen kom in på kronan, annars grå) med beloppet som kom in, månaden, timmarna och status; *Snitt 12 mån*, nettot med bruttot under (samma snitt som Fasta utgifters snittlön men över tolv löner, `average` i `GET /api/salary`; färre än tolv står som "Snitt N mån").
   - **Är specen för månaden inläst** (den kommer några dagar före lönen) står heron "Nästa lön · 23/10 · enligt lönespecen för september" med specens netto, och till höger "brutto X kr · skatt Y kr" (skatten i kronor) och en rad "prognosen ur dina timmar: 24 200 kr (145 tim)". Timstapeln visar specens timmar. Saknas inlagda timmar för månaden står specens netto, brutto, skatt och timmar ändå, med en blå länk "Lägg in september för en prognos ur timmarna ›" till formuläret. Specen är aldrig *nästa lön* när dess lönedag har passerat. Översiktens lönerad säger då "+23 802 kr (enligt lönespecen för september · Lön)", och Kassaflödet "enligt lönespec".
   - **Formuläret *Lägg in arbetsmånad*** har bredvid *OB-timmar per nivå* en länk *Sjuk · 33,5 tim* som viker ut en grå ruta (`card-inset`): månadens sjukdagar som rader (veckodag och datum, timmar i ett fält med "tim", papperskorg), formuläret *Datum* + *Timmar* + *Lägg till* (timmarna tomma = ett pass), en rad per sjukperiod ("Sjukperiod 16/9–21/9 · 33,5 tim · karensavdrag i september") och en förklaring i tertiär. Ändrar man timmarna och lämnar fältet sparas dagen, så prognosen i heron läses om. Raderna *Avdrag sjukfrånvaro*, *Sjuklön 80 %* och *Karensavdrag* står under månaden i listan med "antagen regel".
   - **Medan formuläret fylls i** visar heron den månaden: "Förhandsvisning · 23/10 · prognos för oktober", med nettot och timstapeln för de inskrivna timmarna. *Rensa* tar tillbaka nästa lön.
   - Utan prognos för månaden: "Lägg in augusti för att få en prognos" och *Till formuläret ›*, som väljer månaden i formuläret och flyttar dit.
3. **Semester kvar till 31 mars** (5/12): "antagen regel" som orange pill uppe till höger; timmarna i 34 px fetstil med "timmar · enligt septemberspec 2026" (och inlagd och sparad semester på raden under); en grå ruta "Om inget tas ut: betalas ut med lönen 23/4" (med inlagd eller sparad semester: "Det som blir kvar") med beloppet brutto i 18 px fetstil och "81,7 × 275,21"; förklaringen; längst ned "Spara till nästa år [N tim] Spara · meddela senast 1 april 2027".
4. **Lägg in arbetsmånad:** fälten på en rad med enheten i fältet: *Arbetsmånad* (väljare över ett år bakåt till tre månader fram, inlagda märkta "· inlagd"), *Timmar totalt*, *Varav semester*, *Uttag ATF*, *Övertid pass/vecka*. Formuläret börjar på den första månaden som saknas: en lucka mellan inlagda månader, annars månaden efter den sista, och utan inlagda den som nästa lön gäller. "Timmar från passen i Pendling (14 st, dagarna markerade)" är en switch i rubrikraden; påslagen är *Timmar totalt* (och övertiden, med dagarna markerade) låsta med uträkningen i fotnoten. *› OB-timmar per nivå* fäller ut OB-fälten under raden i en grå ruta. Blå *Spara oktober 2026*, inaktiv tills det finns en prognos. Fotnoten: övertidsregeln, "Prognosen räknas direkt när du skriver" och *Rensa*; på smal skärm, där heron inte syns, också prognosens netto och dag.
5. **Inlagda månader:** en tabell med chevron, månaden i fetstil, timmar (och pass när de kommer från Pendling, och en orange varning vid kvartalsövertid), en stapel på 8 px mot heltid med markör vid måttet (`accent` när lönen kommit in, `accent-bar` medan den är en prognos), lönedagen med statuspill (*kom in exakt* grön, *avvek ±X kr* orange, *prognos* blå; exakt är på kronan), netto i fetstil, brutto i sekundär, *Ändra* · papperskorg. *Ändra* lägger månaden i formuläret. Den utfällda raden (`row-current`): till vänster nettot i 28 px med "landar 25/8", timvärdet, vad som kom in och en tvådelad stapel grundlön (svart) och tillägg (blå) med "grundlön 27 353 · tillägg 4 255 → brutto 31 608 · skatt −6 141"; till höger lönespecen som kvitto: kod, post (med "antagen regel"), uträkning och belopp, *Bruttolön* och *Nettolön* i fetstil under en svart linje, skatten med källan.
6. **Bredder:** under 56 rem vybredd staplas heron och semesterkortet. Formuläret bryter fälten och knapparna till fler rader när de inte ryms. Tabellen har tätare kolumner så att allt ryms vid 820; under 560 px kortbredd visar den inte stapeln och bruttot, timmarna står under månaden och lönedagen över pillen, och *Ändra* och papperskorgen ligger i den utfällda raden, där lönespecen har uträkningen under varje post.
7. **Inställningar › Lön › Avtalet** (`web/src/views/settings/sections/Agreement.tsx`, i Lön-raden mellan *Timmar per pass* och *Skatt*): ett block med OB-nivåerna (en grå ruta `card-inset` per nivå med löneart, namn och en rad per sats: *Gäller från arbetsmånad* ÅÅÅÅ-MM och kronor per timme; *Ny sats från en månad*, *Ta bort sats*, *Ta bort*, *Ny OB-nivå*), tre fält (*Övertid över … timmar per pass*, *… per vecka*, *Schemat klart … dagar före månaden*), en switch för kvartalsövertiden och *Spara avtalet* (grön "Sparat." eller en röd rad med felet). Allt är tomt eller av från början, och ett tomt fält betyder att regeln inte gäller. Formuläret, OB-fälten i *Lägg in arbetsmånad* och kalendrarnas Jobb-händelse följer det som är sparat.

### Design v2: Prylar

Klar 25/9. Data, bilder, detaljpanelen, *Ny pryl* och Per kategori räknas som förut; nytt är filterchipsen och kalenderns stapeldiagram. Koden ligger i `web/src/views/items/`: `ItemsView.tsx`, `ItemFilters.tsx` och `filters.ts`, `ItemCard.tsx`, `ItemRow.tsx`, `parts.tsx` (bild, kategori-pill, status och frister) och `ItemsCalendar.tsx`. Chipet är Transaktioners, delat som `components/FilterChip.tsx`.

1. **Sidhuvudet:** rubriken i 28 px fetstil med "4 prylar · 3 781,99 kr · 2026" direkt efter i sekundär färg (summan för urvalet som förut, fetstil; perioden är månaden, året eller "alla år"; "sålt för X kr" när något är sålt). Till höger sökfältet (`segment`, radie 10, hela bredden på telefon), Galleri/Lista/Kalender som segmenterad kontroll och en blå *+ Ny pryl*.
2. **Filterchips** under sidhuvudet: *År ▾*, *Kategori ▾*, *Handlare ▾* (namnen med antal), *Vems ▾* (Mina, Delade med Mio, Mios) och *Status ▾*. Ett filter som är på är svart med värdet och ✕ ("År: 2026 ✕", "Delade med Mio ✕"), och ett klick tar bort det. En månad från kalendern ("Månad: aug 2026") och sökningen blir egna chips. *Rensa* när något är på; *Sortering: datum ▾* (datum nyast först, pris dyrast först, namn A–Ö) till höger. På telefon skrollar raden i sidled.
3. **Galleri:** kort (radie 18, skugga) med bilden i en 200 px hög platta (`card-inset`, alltså mörkgrå i mörkt tema; hela bilden, `object-contain`), namn och pris i fetstil på samma rad, "19/9 · Amazon" i tertiär (året när det inte är i år) och kategorin som grå pill; utan kategori en orange pill "utan kategori" (`caution-soft`/`caution-text`). Status (när den inte är *ägd*) och en nära ångerrätt eller garanti på en rad under. Kortet lyfter lätt vid hovring. Fyra kolumner på dator, två på surfplatta, en på telefon. En bild som inte laddar ersätts av handlarens ikon.
4. **Lista:** ett kort med rader: miniatyr 44 px (radie 10), namnet med kategori och bankens handlartext under, kategori-pillen i egen kolumn, datum och pris i fetstil. Smalt försvinner pillen (en saknad kategori står i orange i raden under namnet) och datumet flyttar först i den raden. Ett klick öppnar samma detaljpanel som förut.
5. **Kalender** (7/12): årsväljaren *‹ 2026 ›* som segmenterad kontroll och "4 prylar · 3 781,99 kr · snitt 420 kr/mån" (årets summa delad på årets tolv månader, eller på månaderna hittills i år). Tolv staplar, högst 96 px: `accent` för en månad med köp, en grå 4 px linje (`segment`) för en tom; summan ovanför ("330", "3,5k") och en vit prick per pryl inne i stapeln (högst sex, sedan "+N"); en stapel är aldrig lägre än att prickarna ryms. Ett klick på stapeln filtrerar på månaden och visar den i Galleri eller Lista, den som användes senast; ett klick på en prick öppnar prylen. **Per kategori** (5/12) bredvid: namn, "3 203 kr · 2 prylar" och en 6 px stapel mot den största kategorin, *Utan kategori* i orange.
6. **Bredder:** under 56 rem staplas kalenderns kort. Staplarna står kvar i tolv kolumner också på telefon.

### Design v2: Inställningar

Klar 25/9. Alla inställningar, värden, formulär och åtgärder (synk, samtycke, säkerhetskopior, export, lönespecar, dieselpriser) är desamma; nytt är sektionsnavet, sökningen och att de flesta sektioner ligger ett klick bort. Koden ligger i `web/src/views/settings/`: `SettingsView.tsx` (sidan), `sections.ts` (sektionerna, ankarna och de gamla ankarnas alias), `SettingsNav.tsx` och `useSectionHash.ts`, `ui.tsx` (kortet, Apple-raden, knapparna), `Appearance.tsx`, `Accounts.tsx` och `bankSync.ts`, `Watch.tsx`, `compact.tsx` (raderna, utfällningen i adressen, *Ändra*-formen), `summaries.ts` (meningarna), `sections/*.tsx` (de tolv utfällbara), `Data.tsx` och `badges.tsx`.

1. **Sidhuvudet:** rubriken i 28 px fetstil; sökfältet till höger (`segment`, radie 10, hela bredden på telefon). Sökningen visar bara sektioner och rader vars namn, förklaring eller mening innehåller texten (Vakts regler en och en), tonar ner resten i navet och säger "Ingen inställning matchar …" när inget gör det.
2. **Layout:** navet 220 px till vänster, sticky, en rad per sektion i ordningen Utseende, Konton och bankkopplingar, Vakt, Prylar, Kassaflöde, Uthållighet och a-kassa, Pension, Referensbudget, Priser, Veckodigest, Återkommande inkomster, Bil, Lön, Partner, Kontakter, Data. Sektionen i bild är `accent-soft` med `accent`-text; en orange siffra (`caution`) där något väntar (inkomstförslag; ett samtycke som går ut inom 30 dagar eller har gått ut, en synk med fel eller ett bankkonto utan konto här; nya lönevärden som inte är kvitterade; ingen säkerhetskopia på två dygn). Sektionen står i adressen (`#vakt`, också när man skrollar, utan att fylla historiken); ett klick skrollar dit. De gamla ankarna (`#banks`, `#reference-budget`, `bil-title` …) leder rätt. `openSettings(sektion)` i `shell/routes.ts` är vägen in från resten av verktyget och fäller ut sektionen.
3. **Utseende:** kort med Apple-rader: etikett och förklaring till vänster, kontroll till höger (Tema som segmenterad kontroll, Visa privata rader som switch). **Moduler** (`Modules.tsx`) är ett kort på samma sätt direkt under: en rad per valfri del (Lön, Pendling & bränsle) med en förklaring och en switch, avstängda från början; en modul som slås på finns i menyn direkt.
4. **Konton och bankkopplingar:** ett kort. Rubriken med förklaringen om Enable Banking, grå *⟳ Synka nu* och *Ändra*. En rad per konto: bricka 36 px i Wallet-kortets färg (S, MC, BN), namn och kontonummer i monospace tertiär, roll under (kreditkort, anteckningen), kopplingen (grön prick "Enable Banking · aktiv" med "hämtat t.o.m. 25 sep" och reserverade rader; orange "går ut om N dagar" inom 30 dagar; röd när samtycket gått ut eller synken fått fel; grå "manuell" med "faktura-PDF eller för hand" för Mastercard, annars "fil eller för hand") och saldot till höger, en skuld i `caution-text`. Ett bankkonto som inte matar något konto här står alltid med sitt val. *Ändra* byter raderna mot namn, anteckning och *Följ saldot* och visar vilket konto varje bankkonto matar. Foten per bank: samtycket med datum och dagar kvar, senaste synk, *Förnya samtycke* och *Ta bort koppling* (röd, bekräftas), och *Koppla <bank>* för en bank som inte är kopplad. Första synken förhandsvisas som förut. På en smal skärm blir raderna kort: saldot uppe till höger, kopplingen under namnet. *Nytt konto* (grå, med ett plus) öppnar en dialog (`NewAccount.tsx`): namn, sort (*Bankkonto* / *Kreditkort*, segmenterad kontroll), hur det fylls på (CSV-fil, Swedbank, Bank Norwegian, Swedbank Mastercard eller ingen import, med en förklaring under) och, för ett kreditkort, texten på betalningen av räkningen. I *Ändra* har varje rad *Ta bort* (röd länk, med en bekräftelse; det går bara för ett konto utan transaktioner).
5. **Vakt:** kort med förklaringen i rubriken och "N av M på" till höger; alla regler som switchar i två kolumner med namn och förklaring (en kolumn när kortet är smalt); serierna vars pris inte bevakas i foten med *Bevaka igen*.
6. **Kompakt lista:** ett kort med en rad per sektion för Prylar, Kassaflöde, Uthållighet och a-kassa, Pension, Referensbudget, Priser, Veckodigest, Återkommande inkomster, Bil, Lön, Partner och Kontakter: namnet i fetstil (12 rem), vad den står på i en mening (13 px) och förklaringen (11 px, tertiär), chevron. Meningarna (`summaries.ts`), med värdena 25/9: "Fråga vid köp från 500 kr i Prylar & hem › Elektronik", "Buffert 2 000 kr · rött under 3 månader med sparandet", "Buffertkonto Swedbank e-sparkonto · tak 34 000 kr/mån · 80/70/65 % · skatt 19,1 %", "Inkomstbasbelopp 2026: 83 400 kr", "Konsumentverket 2026 · 2 personer", "Startmånad 2025-09 (12 månader bakåt)", "Söndagar 19:00 via ntfy · inte skickad än", "Lön 24 676 kr den 24:e på Swedbank e-sparkonto" (med "· 1 förslag väntar"), "40 km/pass · 200 km/mån · 5,4 l/100 km · diesel 22,58 kr/l (19/9)", "Konstanter från 9 specar · april, maj och juni 2026 · tabell 32" (förklaringen "modellen stämmer på öret för 4 av 5 månadsspecar"), "[numret] · Mio", "Mamma · Mio · Pappa". Ett klick fäller ut sektionen på plats (`band`-bakgrund) med samma innehåll och formulär som förut: *Ändra* till höger byter till formuläret med blå *Spara* och *Avbryt*; prylkategorierna, dieselpriserna, lönekonstanterna med tabellen och backtest, inkomsterna och kontakterna som förut. Det som är utfällt står i adressen (`?oppen=bil,lon`).
7. **Data:** kort med databasens sökväg (monospace) och innehållet i rubriken, *Allt som JSON* och *Transaktioner som CSV* (grå) och *Säkerhetskopiera nu* (blå) uppe till höger; de fem senaste säkerhetskopiorna med datum, typen som pill (vid start grå, före uppdatering orange, manuell blå, natt lila), filnamnet i monospace och storleken; foten med var de ligger, hur de sparas och *Visa alla N*.
8. **Bredder:** under navets brytpunkt (56,25 rem vybredd) är navet en sticky rad chips som skrollar i sidled och tar fram sektionen i bild; en sektion man skrollat till stannar under raden. Vakt blir en kolumn, kontoraderna kort, Data-knapparna radbryts.

### Design v2: Analys – ram och Per kategori

Klar 26/9. Beräkningarna (per kategori, Min del/Hushållet, perioder, CSV) är oförändrade; nytt är nyckeltalen, *Staplar/Andelar* och tonerna i tabellen. Koden: ramen i `web/src/views/analysis/AnalysisView.tsx` och `common.tsx`, Per kategori i `CategoryChart.tsx` och `analysis/categories/` (`figures.ts` och `KeyFigures.tsx`, `bars.ts` och `CategoryBars.tsx`, `heat.ts` och `CategoryTable.tsx`, `colors.ts`).

1. **Sidhuvudet:** rubriken i 28 px fetstil med periodens datum i tertiär direkt efter ("1 sep 2025 – 26 sep 2026"; med *Anpassat* datumfälten där i stället). Till höger perioden (3 mån / 6 mån / 12 mån / I år / Anpassat) och Min del / Hushållet som två segmenterade kontroller. Perioden står i adressen (`?period=6m`, `?period=anpassat&fran=…&till=…`); Min del / Hushållet är appens gemensamma val och står inte där. Förklaringen om vad Min del räknar står längst ned på sidan.
2. **Flikarna** som en segmenterad kontroll; får de inte plats skrollar raden i sidled med vald flik i bild. De övriga flikarna har fått kortstil, typografi och färger från tokens (`Section`, `Stat`, tabellklasserna, diagramfärgerna och tooltipen i `common.tsx`, och de gamla färgklasserna i flikfilerna utbytta), ingen ny struktur.
3. **Nyckeltal** (fyra kort, radie 14, två och två på smal skärm): *Totalt <period>* ("12 mån", "i år", "perioden") över hela perioden med "min del"/"hushållet" och "med sep t.o.m. 26/9" när sista månaden är påbörjad; *Snitt per månad* med median, över de hela månaderna ("utan sep"); *Största kategori* med färgprick, summa och andel av totalen; *Dyraste månad* bland de hela månaderna med summa och kategorin som bidrog mest. Allt ur samma data som tabellen, avrundat till hela kronor som tabellen. En månad är hel om perioden inte slutar inne i den; den första är alltid hel, eftersom månaderna räknas från den 1:a.
4. **Diagramkortet:** rubrik och förklaring; *Staplar / Andelar* (andelar = varje månad som 100 %, `stackOffset="expand"`, en återbetalning räknas som noll). Staplarna i kategoriernas färger (samma som i Kategorier & regler; i mörkt tema lyfts en mörk färg mot vitt tills den syns mot kortet, `chartColor`), 1 px luft mellan segmenten, det översta segmentet med rundade hörn, månadens total ovanför stapeln ("32,1k"). Y-axeln i k, den pågående månadens etikett blå. Tooltip i Apple-stil: varje kategori med belopp och andel av månaden, den under pekaren framhävd. Klick på en stapel öppnar transaktionerna. Legenden är chips (`card-inset`, helt runda) med färgprick, namn, periodens summa i tertiär och chevron; ett klick borrar ned i underkategorierna, och då står *‹ Tillbaka* först. *Totalt* i legenden visar totalen som linje (av från början). På smal skärm var annan månads etikett (var tredje under 400 px) och inga totaler över staplarna.
5. **Tabellkortet:** "Tabell · färgen visar hur månaden ligger mot kategorins snitt", *CSV* till höger (samma fil som förut: månaderna och summan). Första kolumnen sticky, månaderna skrollar i sidled, *snitt* sist (över de hela månaderna). Cellerna tonas mot kategorins snitt: under 80 % `positive-soft`, 120–200 % `caution-soft`, över 200 % `heat-high` med `caution-text` (ny token: `#ffd9d3`, mörkt `#4a1d17`). Tom månad "–" i tertiär, återbetalning grön med "+", den påbörjade månaden (märkt "påbörjad") och återbetalningar tonas inte. Totalt-raden med 1 px linje i `ink` ovanför. Fotraden: hur många hela månader snittet bygger på, tonernas förklaring och växeln *Toner* (sparad i webbläsaren).

**Flikordningen** är sedan 26/9 Per kategori, Snitt, Mat, Matvaror, Fasta mot rörliga, Topplista, Bränsle, Sparande, Priser, Konsumentverket och Jämför perioder. Fliken *Prylar* är borttagen: den var `CategoryChart` begränsad till köp kopplade till en pryl, och Prylar-vyns kalenderläge visar redan samma sak per månad och per kategori. `?flik=prylar` leder till `/prylar?visa=kalender`, som öppnar kalendern (och lämnar adressen ren). I Per kategori står *Visa prylarna ›* sist i legenden när man borrat ned i Prylar & hem.

### Design v2: Analys – Snitt

Klar 26/9. Beräkningarna (hela veckor och månader, snitt per källa och kategori, Min del/Hushållet, CSV) är oförändrade; nytt är nyckeltalskorten, andelsstaplarna och sorteringen. `GET /api/analysis/averages` skickar nu också kontots typ (`kind`, för Wallet-färgen) och kategorins färg (`color`, samma som i Per kategori; en underkategori får en ton av huvudkategorins om den inte har en egen). Koden ligger i `web/src/views/analysis/Averages.tsx` och `analysis/averages/`: `IncompleteImports.tsx`, `AverageFigures.tsx`, `SourceTable.tsx`, `CategoryAverages.tsx` med `sort.ts` (ordningen och staplarnas bredder) och `types.ts`.

1. **Ofullständig import:** en orange rad (`caution-soft`, radie 12) med "!" i `caution-text`, "Perioden innehåller månader med ofullständig import: Mastercard sep 25, sep 26. Snitten kan bli för låga." och *Importera ›* till höger, som leder till Importer. Bara när någon månad i perioden inte täcks.
2. **Tre nyckeltal** (kort, radie 14, beloppet i 24 px fetstil) i stället för förklaringsmeningen: *Snitt per månad* med "12 hela månader · sep 25 – aug 26" (månaderna i en tooltip), *Snitt per vecka* med "55 hela veckor mån–sön · 1 sep 2025 – 20 sep 2026" och *Summa i perioden* med "påbörjade veckor och månader räknas bara här". Samma tal som Totalt-raden, avrundade till hela kronor på samma sätt. Utan hel månad eller vecka "–" och "ingen hel månad i perioden".
3. **Per källa:** rubrik och *CSV*. Källa med en 10 px ruta i kontots Wallet-färg (Privatkonto svart, e-sparkonto blått, Mastercard guld, Norwegian ljusblått, manuella grått; i mörkt tema är Privatkontot `ink-2`, eftersom den nästan svarta färgen inte syns mot kortet) och "ofullständig" som orange pill (månaderna i en tooltip). *Andel av summan* som 8 px stapel i kontots färg, andelen av periodens summa. Summa och Per vecka i sekundär färg, Per månad i fetstil. Totalt-raden med 1 px linje i `ink` ovanför.
4. **Per kategori:** rubrik med "klicka på en huvudkategori för underkategorierna", *Störst först / A–Ö* som segmenterad kontroll (störst först på snitt per månad, sedan namn; A–Ö i svensk ordning; sparat i webbläsaren, `analysis.averages.order`) och *CSV* (samma fil och ordning som förut). Kolumnerna: chevron (bara när det finns underkategorier), 8 px prick i kategorins färg (i mörkt tema lyft som i Per kategori) och namn; en 6 px stapel mot den största huvudkategorins snitt per månad (mot summan när perioden saknar hel månad); Summa och Per vecka i sekundär färg; Per månad i fetstil. Utfällda underkategorier står indragna i sekundär färg, i samma ordning, med staplar mot sin huvudkategori.
5. **Fotnoten** om Din del står under korten som förut.
6. **Bredder:** nyckeltalen i en kolumn under 40 rem vybredd. Under 36 rem kortbredd (telefon) visar tabellerna inte Per vecka, och stapeln flyttar från sin kolumn till under namnet, så att Summa och Per månad ryms utan sidledsskroll. Pillen "ofullständig" bryts till egen rad när namnet inte ger plats. Ett bindestreck i ett kontonamn bryts inte ("e-sparkonto").

### Design v2: Analys – Mat

Klar 26/9. Beräkningarna (andelen ute och hämtmat, jämförelsen med samma period förra året, per månad, CSV) är oförändrade; nytt är ringen, förändrings-pillsen per underkategori och de staplade staplarna i stället för linjediagrammet. Koden ligger i `web/src/views/analysis/Food.tsx` och `analysis/food/`: `ShareCard.tsx` (ringen), `KindCards.tsx`, `FoodBars.tsx`, `FoodTable.tsx`, `tones.ts` (förändringens och andelens toner) och `types.ts`. Färgerna är egna tokens: `food-groceries` #34c759, `food-restaurants` #ff9500 och `food-takeaway` #ffcc00 (i mörkt tema #30d158, #ff9f0a, #ffd60a).

1. **Heron, 5/12:** kortet "Ute och hämtmat, andel av maten". En ring (SVG, 104 px, 16 px bred linje) med livsmedel, restaurang & café och hämtmat medurs från toppen, var och en lika lång som sin andel av all mat; andelen i mitten i 18 px fetstil med "ute + hämtmat". Till höger en pill med förändringen mot samma period förra året i procentenheter, "↗ +2,6 p.e. mot förra året (22,4 %)": orange (`caution-soft`/`caution-text`) vid ökning, grön (`positive-soft`/`positive-text`) vid minskning, grå (`segment`/`ink-2`) inom ±0,5 p.e.; ingen pill utan mat förra året. Pillen bryts aldrig; får den inte plats flyttar texten under ringen. Under den "47 033 kr på mat i perioden · 3 691 kr/mån" (per månad över de hela månaderna, som Snitt) och "Andelen = restaurang, café och hämtmat delat med all mat."
2. **Heron, 7/12:** tre kort, Livsmedel, Restaurang & café och Hämtmat: färgprick och namn, summan i 24 px fetstil, "X kr/mån" över de hela månaderna, och under en avdelare förändringen mot förra året i hela procent som pill (samma färger, grå inom ±0,5 %) med "förra året X kr"; "ingen jämförelse" i tertiär när förra året saknade den sortens mat.
3. **Per månad:** rubrik och "staplarna är kronor; andelen ute och hämtmat står ovanför", förklaringen med de tre färgerna i rubrikraden. Staplade staplar (Recharts) i de tre färgerna, 1 px mellanrum och rundade hörn på det översta segmentet (samma form som Per kategori), y-axeln i kronor ("4,5k"). Ovanför varje stapel andelen ute och hämtmat som en liten pill: grön under 20 %, grå från 20 %, orange från 30 % till och med 40 %, röd (`heat-high`/`caution-text`) över 40 %; tonen följer talet som visas med en decimal. Den aktuella månadens etikett blå. Tooltip med de tre beloppen och andelen. Den gamla andelslinjen finns kvar bakom växeln *Visa andel som linje* (av från början), prickad med en egen axel 0–100 % till höger.
4. **Tabell:** kolumnerna Månad, Fördelning (en 6 px tredelad stapel, lika bred som månadens mat mot den största månadens), Livsmedel, Restaurang & café, Hämtmat ("–" i tertiär för noll) och Ute & hämtmat som samma tonade pill. Aktuell månad `row-current` och fetstil. Totalt-raden med 1 px linje i `ink` ovanför och andelen utan pill. CSV:n är densamma. Fotraden "Andelen tonas: grön under 20 %, grå 20–30 %, orange 30–40 %, röd över 40 %."; Din del står som förut under korten.
5. **Bredder:** under 56 rem vybredd staplas heron (ringkortet överst, sedan de tre korten, en kolumn under 40 rem). Under 520 px diagrambredd visas inte pillsen över staplarna (de skulle krocka) och underrubriken säger "tryck på en stapel för andelen"; var annan månads etikett, var tredje under 400 px. Under 36 rem kortbredd döljer tabellen Fördelning, visar månaden kort ("sep 25"), bryter kolumnrubrikerna och sitter tätare (12 px text, 16 px kant).

### Design v2: Analys – Matvaror

Klar 26/9. Kvittoinläsningen, hyllreglerna, *Föreslå hyllor*, varans dialog, ihopslagningen och CSV:erna är oförändrade; nytt är täckningsstapeln i kronor, butikschipsen, hyllfiltret som chips, sorteringen och att listan visar 50 rader i taget. `GET /api/products/summary` skickar nu också antalet kvitton per månad (`months[].receipts`) och antalet kassar (`extras.bags`, bara när varje kassrad säger antal eller styckpris, annars null). Koden ligger i `web/src/views/analysis/Products.tsx` (data, dialogerna, ihopslagningen) och `analysis/groceries/`: `GroceryOverview.tsx`, `ShelfMonths.tsx` (hyllorna och månaderna), `ProductList.tsx`, `listOrder.ts` (filter, sortering, chips, adressen) och `shelves.ts`.

1. **Vad maten blev:** rubrik och *CSV* (per hylla, som förut).
   - **Täckning:** "Kvitton täcker 52 av 298 matköp · 14 421 kr av 69 488 kr" och till höger "resten av maten vet verktyget bara summan av"; en 10 px grön stapel (`positive`) som är kronorna med kvitto av kronorna på mat; butikerna som grå chips "Lidl 38 kvitton · 11 149 kr" (förut i fotnoten).
   - **Fyra rutor** (`card-inset`, radie 12): *Varor på kvittona* (kronor och rader), *Rabatter* (`positive-soft`, "+715 kr", "medlemspris och kampanjer · 4,7 %" av varusumman), *Pant* ("betald, inte återlämnad") och *Kassar* (beloppet; "ca N kassar" bara när kvittona säger antalet).
   - **Per hylla** till vänster: hyllans färg, en 6 px stapel mot den största hyllan, kronor i fetstil, andel och rader. **Per månad, de månader som har kvitton** till höger: en staplad stapel per hylla för varje månad med minst ett kvitto (den största hyllan underst, rundat överst), totalen ovanför ("5,2k") och "aug 26 · 25 kvitton" under; månaderna utan kvitton visas inte och står under diagrammet ("sep 25 – maj 26 saknar kvitton och visas inte"). Tooltipen listar månadens hyllor, den under pekaren i fetstil.
   - **Hyllfärgerna** är tokens per hylla som verktyget lade upp (`--v2-shelf-…`, efter namnet), skissens färger i ljust tema och ljusare varianter av de mörka (Kaffe & te, Frukt & grönt, Fisk, Kött) i mörkt. En hylla som skapas senare har färgen som sparats med den; Utan hylla är grå. De läses som `--v2-`-variabler, eftersom Tailwind inte tar med en temafärg som ingen klass använder.
2. **Matvaror:** "Matvaror · 293 varor ur kvittona" med förklaringen om namn och hyllor och om Min del och Hushållet, och *CSV* (den filtrerade listan, som förut).
   - **Verktygsraden:** sökfältet (`card-inset`), hyllorna som chips med antal varor (*Alla*, *Utan hylla · N* i orange när N > 0, sedan hyllorna med flest varor först) och *Sortering: totalt ▾* (totalt, gånger, senast, A–Ö). Så många hyllchips som får plats (högst fem, uppskattat från texten och radens bredd), resten under *fler ▾*; en vald hylla står alltid som chip. Hyllan och sorteringen står i adressen (`?hylla=utan`, `?hylla=3`, `?sortering=ganger|senast|a-o`; totalt är förvalt).
   - **Utan hylla:** "! 2 varor väntar på en hylla – reglerna känner inte igen deras namn." som orange rad (`caution-soft`) med *Visa dem* (sätter filtret) och *Föreslå hyllor* (samma funktion som förut).
   - **Raderna:** kryssruta (för ihopslagningen), varunamnet med "N namn" i tertiär när butikerna tryckt fler än ett, hyllan som pill med hyllans prick och ▾ över en vanlig select (orange `caution-soft`/`caution-text` utan hylla), gånger, senast och totalt i fetstil. Sorterat på totalt kommer varorna utan hylla först.
   - **50 rader i taget:** "50 av 293 visas" och *Visa 50 till ›*; ett nytt filter, en ny sortering eller en sökning börjar om från 50. Ihopslagningens rad ligger i kortets fot som förut.
3. **Bredder:** rutorna 2×2 under 44 rem kortbredd, hyllorna och månaderna staplade under 48 rem, och månadernas etikett på två rader ("aug 26" / "25 kvitton") när staplarna är smala. Under 640 px står alla hyllchips på en rad som skrollar i sidled, sorteringen på egen rad. Under 36 rem kortbredd visar listan inte Senast, hyllans pill står under varans namn, och den orange raden har texten på egen rad.

### Design v2: Analys – Fasta mot rörliga

Klar 26/9. Beräkningarna (fasta, rörliga, inkomster och netto per månad, fast andel, CSV) är oförändrade; nytt är inkomststapeln, nyckeltalen per månad och netto-pillsen i diagrammet. Koden ligger i `web/src/views/analysis/FixedVariable.tsx` och `analysis/fixed/`: `figures.ts` (stapeln, snitten och spannen, månadens fördelning, andelens toner), `IncomeHero.tsx`, `FixedBars.tsx` och `FixedTable.tsx`. Fasta är `ink` (svart, i mörkt tema ljus med mörk text), Rörliga `caution` (#ff9500) och inkomsten `positive` (#34c759).

1. **Vart inkomsten tog vägen:** inkomsten i perioden i 40 px fetstil med "in på 13 månader", förklaringen om fasta och rörliga till höger. En 26 px stapel (radie 13, 2 px mellan delarna): Fasta, Rörliga och Netto (`positive-soft` med `positive-text`), var och en så bred som sin del av inkomsten och märkt "Fasta 98 320 kr · 28,3 %". Går mer ut än in finns inget netto: stapeln är utgifterna, får röd kant (`alarm`) och texten "X kr mer ut än in". Under den fyra rutor (`card-inset`, radie 12): *Andel av inkomsten som är fast* (periodens, med lägsta och högsta hela månad), *Fasta per månad* och *Rörliga per månad* (snitt och spann, "snitt · 6 688–11 884"), *Netto per månad* (grön, röd om snittet är negativt; "11 av 12 månader positiva"). Snitt, spann och antal räknar de hela månaderna, som Snitt.
2. **Per månad:** rubrik, "staplarna är utgifter, det gröna strecket är inkomsten – nettot står ovanför" och förklaringen i rubrikraden. Fasta och Rörliga staplade (1 px mellan, rundat överst), inkomsten som ett 3 px grönt streck tvärs över månaden på inkomstens nivå (punkterna på en osynlig linje, ritade som streck så breda som månadens stapel), och ovanför varje stapel nettot som pill: "+9k" grön (`positive-soft`/`positive-text`), "−7k" röd (`alarm-soft`/`alarm`), under 1 000 kr i hela kronor. Ingen y-axel. Tooltip med fasta, rörliga, inkomster och netto. Den aktuella månadens etikett blå.
3. **Tabell:** Månad, *Fördelning av inkomsten* (6 px: fasta, rörliga och nettot; nettot ljusgrönt, eller `alarm` när månaden gick back, och då är stapeln fasta + rörliga + underskottet), Fasta, Rörliga, Inkomster (sekundär), Netto (fetstil, grön eller röd) och *Fast andel* som tonad pill: grön under 25 %, grå 25–40 %, orange över 40 % (efter talet med en decimal; 25,0 och 40,0 % är grå). Aktuell månad `row-current` och fetstil, Totalt med 1 px linje i `ink`. CSV:n som förut. Fotraden förklarar tonerna och den röda stapeln; Din del står under korten.
4. **Bredder:** rutorna 2×2 under 44 rem kortbredd. Under 40 rem kortbredd står stapelns värden i en lista under den i stället för i delarna. Under 520 px diagrambredd inga netto-pills (underrubriken säger "tryck på en stapel för nettot"), var annan månads etikett och mer luft i kanterna. Under 36 rem kortbredd döljer tabellen Fördelning och Inkomster, visar korta månader och sitter tätare.

### Design v2: Analys – Topplista

Klar 26/9. Vad som räknas är detsamma: köp, inte återbetalningar, per handlare (motpart eller bankens text), och privata köp bara i en fotnot när Visa privata är av. Nytt är topp 3-korten, verktygsraden, sammanslagningen per namn och raderna. `GET /api/analysis/merchants` skickar nu köpen i bitar per bankens text, namn (etiketten från namnreglerna), kategori och ort (`pieces`: `key`, `label`, `contactName`, `icon`, `categoryId`, `area`, `count`, `total`, `lastDate`), kategorierna bitarna har med sina huvudkategorier (`categories`) och `private` som förut; sidan slår ihop, filtrerar och sorterar utan att hämta på nytt. Koden ligger i `web/src/views/analysis/Merchants.tsx` och `analysis/merchants/`: `list.ts` (sammanslagningen, sorteringen, sökningen, kategorifiltret och adressen), `TopThree.tsx`, `Toolbar.tsx`, `MerchantName.tsx`, `MerchantTable.tsx` och `types.ts`.

1. **Topp 3:** tre kort (radie 16) med en 48 px logotyp (handlarens ikon, annars initialerna; radie 12) och en svart placeringsbricka i hörnet, namnet, summan i 20 px fetstil och "N köp · X kr per köp". Korten är listans tre första, så de följer sorteringen, kategorin och sammanslagningen men inte sökningen. Ett kort öppnar transaktionerna.
2. **Listkortet:** "Topplista handlare · N handlare", "köp, inte återbetalningar · klicka på en rad för transaktionerna" och *CSV* (samma kolumner som förut; filen följer listan som den står, med platserna). Verktygsraden: sökfältet (namnet och bankens texter), sorteringen *Summa / Antal köp / Snitt per köp* som segmenterad kontroll (fallande; vid Snitt per köp kommer handlare med ett enda köp sist), *Kategori ▾* (filtrerar på köpens kategori; en huvudkategori tar med sina underkategorier) och till höger *Slå ihop samma handlare*. Sökning, sortering och kategori står i adressen: `?sok=lidl&sortera=antal&kategori=12` (Summa och ingen kategori skrivs inte ut). Platserna följer sorteringen och kategorin; sökningen döljer bara rader.
3. **Sammanslagning:** när switchen är på blir köpen med samma namn från namnreglerna en handlare; en bankens text utan namnregel är sin egen. En rad med flera av bankens texter får en blå pill "N namn". Av: en rad per bankens text, med etiketten från den senaste raden som har en, som förut. På från början, sparad i webbläsaren (`analysis.merchants.merge`). Ett klick på en sammanslagen rad öppnar transaktionerna med namnet som sökning; transaktionssökningen träffar redan etiketten, så alla texterna kommer med.
4. **Rader:** placering, 32 px logotyp (radie 9), namnet i 500 med pillen, och under det kategorin (den som mest pengar gick till), "N namn" och orterna banken angav, eller utan orter bankens övriga texter – högst tre, sedan "+N", hela listan i verktygstipset. Orterna skrivs som namn ("Solna"); banken skriver dem utan å, ä och ö, och det går inte att sätta tillbaka. En 6 px stapel mot ettan i det som sorteras på (summa, antal köp eller snitt), svart (`ink`) för ettan och blå för övriga; vid Snitt per köp har ett enda köp ingen stapel. Köp, summan i fetstil och snitt per köp. 15 rader först, *Visa fler · N kvar ›* laddar 25 i taget och börjar om på 15 när ett val eller perioden ändras. Hela raden öppnar transaktionerna.
5. **Fotnoten:** "”Slå ihop” använder namnreglerna: rader med samma namn räknas som en handlare (…)", med de tre största sammanslagna raderna som exempel, eller "”Slå ihop” är av: varje text från banken är en egen handlare.", följd av Din del i samma stycke. Analys gemensamma Din del-rad visas därför inte på den här fliken. Raden om privata köp står kvar i kortet.
6. **Bredder:** topp 3 ligger bredvid varandra från 48 rem och staplas under. Under 40 rem kortbredd döljer listan stapeln och snittet, och namnet och undertexten kortas. Stapeln är 96, 160 eller 208 px bred (från 52 och 64 rem). Ljust och mörkt via tokens.

### Design v2: Analys – Bränsle

Klar 26/9. Beräkningarna (tankat per köpdag, per pass, l/100 km, resor som inte räknas, CSV) är oförändrade; nytt är nyckeltalskorten, förbrukningen som en tonad rad i stället för linjen och kortet för resorna. Koden ligger i `web/src/views/analysis/Fuel.tsx` och `analysis/fuel/`: `figures.ts` (nyckeltalen, mätaren, tonen mot tabellvärdet), `FuelFigures.tsx`, `FuelBars.tsx` och `FuelTable.tsx`. Bränslet är `caution` (#ff9500).

1. **Fyra nyckeltal** (kort, radie 14, beloppet i 24 px fetstil): *Tankat under perioden* med "1 370 kr/mån · 12 månader med tankning" (delat med månaderna som har en tankning); *Per pass* (snittet av månadernas kronor per pass) med "11 månader med pass · 164 pass · 15 436 km" för samma månader; *Snitt l/100 km* med skillnaden mot tabellvärdet i grönt (under), orange (över) eller grått (samma med en decimal) och en 6 px mätare där tabellvärdets svarta markör står vid 75 % och fyllnaden är snitt ÷ tabellvärde × 75 % (full vid en tredjedel över); *Resor, räknas inte* dämpat (`card-inset`, streckad kant, beloppet i sekundär färg) med summan av tankningarna märkta resa och månaderna ("juli och augusti", med år när de spänner över flera).
2. **Tankat per månad:** rubrik, förklaringen (kategorin, köpdag, utan resor, hela beloppet, kronor per pass ovanför) och *Kalibrering i Pendling & bränsle ›* till höger. En stapel per månad (rundad överst, ingen y-axel), en månad utan tankning som en grå 3 px linje (`segment`), kronor per pass ovanför, den aktuella månadens etikett blå; tooltip med kronor, pass, km, per pass och l/100 km. Under en hårlinje raden *Förbrukning l/100 km* med en tonad ruta per månad i staplarnas kolumner (lika bred som stapeln): grön (`positive-soft`/`positive-text`) under tabellvärdet, orange (`caution-soft`/`caution-text`) över, grå när den är lika med en decimal, grå "–" utan värde; förklaringen om att en full tank hamnar i en enda månad. Linjen på höger axel är borta.
3. **Per månad:** nyast överst; Månad, Pass, Km, en 6 px stapel för det tankade mot den största månaden, kronor i fetstil, Per pass, l/100 km som tonad pill (samma toner) och Resor (ej med) i tertiär. Aktuell månad `row-current` och fetstil. CSV:n som förut.
4. **Bredder:** nyckeltalen 2×2 under 48 rem. Under 560 px bredd skrollar diagrammet och förbrukningsraden i sidled tillsammans (minst 36 rem breda), och förklaringen står under dem. Under 36 rem kortbredd döljer tabellen Km och stapeln, visar korta månader och sitter tätare.

### Design v2: Analys – Sparande

Klar 26/9. Innehav, kurshämtning, affärer, likvider, värdeavläsningar, avkastning, sparat per månad, sparkvot och CSV:erna är oförändrade; nytt är fördelningsstapeln mot policyn, värdekurvan och sparkvotens pills. Koden: `web/src/views/analysis/Portfolio.tsx` (innehavet, dialogerna i `PortfolioDialogs.tsx` och `OpeningDialog.tsx`), `Savings.tsx` och `analysis/savings/`: `allocation.ts` (fördelningsstapeln och målmarkören), `ValueCard.tsx`, `ReadingsCard.tsx`, `SavedCard.tsx` och `SavedTable.tsx`, och efter inflation (27/9, utan skiss) `RealCard.tsx`, `RealTable.tsx` och `BufferCard.tsx`. Knapparna är Inställningars (`BUTTON` i `settings/ui.tsx`).

1. **Innehav på ISK:** i rubrikraden kursernas datum och källor ("kurser 23/9 (Avanza), växelkurs från Riksbanken · oberoende av perioden"; en gammal kurs i orange). Totalen, värdepapper plus likvider, i 44 px fetstil med "värdepapper X kr + likvider Y kr · insatt netto Z kr" under. Uppe till höger *Likvider*, *⟳ Hämta kurser*, *+ Instrument* (grå), *Startinnehav* när listan är tom, och *Registrera affär* (blå). En 22 px fördelningsstapel (radie 11, 2 px mellan): Basen `accent` (#0071e3), Bet-zonen `caution` (#ff9500) och Likvider `wallet-isk` (#5ac8fa), så breda som sin del av kontot, zonerna märkta med sin andel av värdepapperen och beloppet ("Basen 64,8 % · 139 918 kr"); en svart markör "mål 80/20" under stapeln där basen skulle sluta på sitt mål. Varningen när bet-zonen är över 25 % som orange ruta (serverns text); annars står policytexten som en vanlig rad. Instrumentlistan: namn med kontot ("ISK") i tertiär, zon med prick, antal, kurs (datumet i tooltip; en gammal kurs "10/9 · gammal" i orange), värde i fetstil, andel som 6 px stapel i zonens färg (mot det största innehavet) och procent. Fotraden: avstämningen och *CSV*.
2. **Värdet på ditt sparande** (7/12): rubrik och förklaringen om avkastningen; fyra rutor: *Värde 22/9*, *Insatt netto sedan start* (med startvärdet), *Avkastning* (grön eller röd ruta, med procent) och *Värdeförändring* (grön eller röd). En kurva (Recharts, `accent`) över alla avläsningar med datum och belopp på axeln; en ring runt en punkt (grön in, röd ut) när pengar satts in eller tagits ut sedan värdet före. Pengar insatta efter senaste värdet nämns för sig.
3. **<Namn> · avläsningar** (5/12): namnet med penna (byt namn) och papperskorg (ta bort innehavet, frågar först), "skrivs av från appen"; datum och värde med *För in* (blå) i en grå ruta; listan nyast först med datum ("start" på det första), värde i fetstil, avkastningen sedan förra (grön eller röd) och papperskorg. Ett klick på en rad lägger datum och värde i rutan; samma datum igen ersätter värdet. Flera innehav får ett kort var.
3b. **Sparandet efter inflation** (7/12, 27/9): rubrik och "hela ISK:t, värdepapper och likvider · sedan 1 jan 2026 · pengarna räknade i dagens penningvärde enligt KPI (augusti 2026)". *Real vinst, i dagens penningvärde* i 40 px fetstil, `positive-text` eller `alarm`, med "real avkastning **+16,1 %** · nominellt +16,5 % · inflation +0,3 %" under; till höger värdet i dag, starten, insatt netto sedan dess och – när ISK-skatten för perioden är mer än noll – den reala vinsten efter skatt. En 24 px stapel (radie 7) av dagens värde: *Insatt* (startvärdet och det insatta netto, grå), *Inflationen* (`caution`, minst 3 px när den finns) och *Real vinst* (`positive`); en real förlust i randigt rött (`alarm`) från värdet och ut. Legend med belopp och förklaringen under. Med kreditkontots besked inlästa står "minus krediten" i underrubriken och *Ränta på krediten, ingår* bland siffrorna. Längst ned, efter en hårlinje, vilka år Avanzas kontobesked täcker ("ISK 2024–2025 · kredit 2024–2025") och vad de används till, eller utan besked vad en inläsning gör, med *Läs in kontobesked* (grå knapp, en eller flera PDF:er).
3c. **Bufferten mot inflationen** (5/12, 27/9): kontots namn; två rutor: *Saldo i dag* och *Räntan som håller köpkraften* (inflationen de senaste tolv KPI-månaderna). Tabell per helt år, nyast först: snittsaldo (dolt under 30 rem), ränta i kronor och procent, inflation december till december och *Köpkraft* som pill: grön "+7 kr" när räntan räckte, orange "−190 kr" när priserna tog mer.
3d. **Per kvartal** (hela bredden, 27/9): värdet på ISK:t (`accent`, med punkter) mot den streckade linjen *för att hålla köpkraften* (`ink-3`), tooltip med båda, skulden på krediten när det fanns någon och skillnaden; axeln visar årtalet på nyårsdagen. Tabell nyast först: varje period mellan två värden (den pågående "1/7–i dag" i `row-current`) med start, insatt netto och slut (dolda under 36 rem), nominell, inflation och real som tonad pill (grön över, röd under, grå 0,0 %); under årets perioder årsraden i `band` och fetstil med "ISK-skatt 1 302 kr" (eller "(beräknad)") och en 1 px linje i `ink`. En period som slutar 1 januari hör till året före.
4. **Sparat per månad:** rubrik, förklaringen, *Visa raderna* och *CSV*. Fyra rutor: *Insatt*, *Uttaget*, *Sparat netto* (grön, röd om negativt; "96 273 kr sedan 23/8 2024") och *Sparkvot* (`accent-soft`, "av X kr i inkomst"). Staplar kring en nollinje: grönt (`positive`) upp, rött (`alarm`) ned, en månad utan netto en grå 2 px linje; sparkvoten som pill i en rad ovanför ("+31 %" grön, "−23 %" röd, "0 %" grå). Den aktuella månadens etikett blå; tooltip med insatt, uttaget, netto, inkomst och sparkvot. En stapel öppnar månadens rader. Linjen på höger axel är borta.
5. **Per månad:** nyast överst; insatt, uttaget, netto i fetstil grönt eller rött, inkomst i sekundär, sparkvot som tonad pill (samma toner, med en decimal). Aktuell månad `row-current` och fetstil, Totalt med 1 px linje i `ink`. En rad öppnar månadens rader.
6. **Bredder:** värdekortet och avläsningarna staplas under 56 rem. Under 40 rem kortbredd visar instrumentlistan inte zon, kurs och andel (zonens prick står före namnet), och stapelns delar visar bara andelen. Under 36 rem kortbredd döljer tabellen Uttaget och Inkomst. Under 520 px diagrambredd inga sparkvot-pills och mer luft i kanterna.

### Design v2: Analys – Priser

Klar 26/9. Hämtningen från SCB och Weekly Oil Bulletin, indexeringen, varugrupperna, dieseljämförelsen och CSV:n är oförändrade; bara presentationen är ny. Koden ligger i `web/src/views/analysis/Prices.tsx` (data och *Hämta nu*) och `analysis/prices/`: `types.tsx` (typerna, formateringen, källraden, `fillMarks` och varugruppernas ton), `FoodIndexCard.tsx`, `SubgroupsCard.tsx` och `DieselCard.tsx`.

1. **Mat mot konsumentprisindex:** rubrik, förklaringen ("båda linjerna står i 100 i september 2025 · din linje är vad du handlade för, SCB:s är vad maten kostade …") och *⟳ Hämta nu* som grå knapp. Tre rutor: *Din matkostnad* (`positive-soft`, en liten grön linje som ikon, "september 2025 → augusti 2026"), *KPI livsmedel och alkoholfria drycker* (grå, streckad grå linje som ikon, "samma månader") och *Din matkostnad augusti 2026* med startmånadens belopp. Diagrammet: din linje `positive` 2,5 px, KPI `ink-2` streckad, en prickad linje vid 100 märkt "100", slutpunkterna markerade (din fylld, KPI:s som ring), axeln till höger; tooltip med båda index och vad du handlade för. Fotnoten om hela hushållet och hela månader, sedan källan.
2. **Varugrupper hos SCB:** rubrik och förklaringen (utan din egen linje). En grå ruta (`card-inset`, radie 12) per grupp: namnet, förändringen som pill (grön `positive-soft`/`positive-text` vid minskning, orange `caution-soft`/`caution-text` vid ökning, grå inom ±0,2 %, på kortets bakgrund så att den syns i mörkt tema) och en sparkline i samma färg över en prickad 100-linje. Fyra kolumner, två på smal skärm.
3. **Diesel mot rikssnittet:** rubrik, förklaring och *CSV*. Tre rutor: *Du betalar* (orange när över rikssnittet, grön när under), *Vid nuvarande passtakt* och *Pumppriset på din mack* (eller *Senaste rikssnitt* utan kvitton). Diagrammet (Recharts ComposedChart, tidsaxel i dagar): rikssnittet som `accent`-linje med en svag yta under; varje tankning med kvitto som fylld prick vid det du betalade, grön (`positive`) under veckans rikssnitt och röd (`alarm`) över; pumppriset som tom grå ring med ett tunt grått streck ner till pricken (rabatten); en tankning utan kvitto bara som ring. Tooltip: datum, mack, ditt pris, pumppris, rikssnitt och skillnad. Legenden i en rad under med *Så läser du diagrammet ›* till höger, som öppnar den långa förklaringen i en popover. Tabellen: datum, tankning, liter, ditt pris i fetstil ("≈" för ett inlagt pris), pumppris, rikssnitt och skillnaden som pill (grön under, orange över); de 8 senaste, nyast först, och *Visa alla 16 tankningar ›*; källan i fotraden.
4. **Bredder:** rutorna i en kolumn under 40 rem kortbredd, varugrupperna två och två under 48 rem. Under 36 rem kortbredd döljer dieseltabellen Liter och Pumppris, priserna står utan "kr/l" (rubrikerna säger det) och mackens namn kortas.

### Design v2: Analys – Konsumentverket

Klar 26/9. Referensdata, hushållsinställningen, rullande snitt, KPI-justeringen, CSV:n och kategorimappningen är oförändrade; nytt är färgerna (orange över referensen, grön under; förut medvetet neutralt, ändrat på ditt val), sorteringen på avvikelse, *Koppla kategori* i raden och täckningsstapeln. Koden ligger i `web/src/views/analysis/Reference.tsx` (verktygsraden, heron, *Rullande snitt*, *Utanför jämförelsen*, noterna) och `analysis/reference/`: `ItemsCard.tsx` (Per post, ordningen och stapeln), `tone.ts` och `format.ts`.

1. **Verktygsraden:** "Rullande snitt till och med" med månaden som segmenterad kontroll (‹ augusti 2026 ›; framåt tar slut vid senaste hela månaden) och *KPI-justerad referens* som switch till höger (sparad för sessionen).
2. **Heron:** "Jämfört med Konsumentverket · referensår 2026 · Jag 25–50 år, Mio 25–50 år"; skillnaden för 12-månaderssnittet i procent, 40 px fetstil, `caution-text` över och `positive-text` under, med "över/under referensen, snitt 12 månader"; till höger brasklappen om att referensen täcker ungefär 40 % och vad som inte ingår. Tre rutor: *Referens per månad* (grå), *Snitt 12 månader · sep 25–aug 26* och *Snitt 3 månader · juni 26–aug 26* (`caution-soft` över, `positive-soft` under, grå vid noll) med belopp och "+1 920 kr · +29,2 %".
3. **Per post:** rubrik, förklaringen, *Avvikelse / Konsumentverkets ordning* (största skillnad i kronor åt något håll först; sparad i webbläsaren, `reference.order`) och *CSV*. Posten med varifrån pengarna kommer (underkategorier samlade under sin huvudkategori, "Nöje › Film, Musik, Spel, Streaming") och referensregeln i tertiär, KPI-justeringen när den är på, och för en post utan kopplad kategori "ingen kategori kopplad, faktiskt = 0" med *Koppla kategori ›*, som fäller ut *Vilka kategorier räknas var* i Utanför jämförelsen, skrollar dit och säger vilken post det gäller. *Mot referensen*: en 8 px stapel för 12-månaderssnittet (grön under, orange över, grå på den) och en svart 2 px markör vid referensen, skalan per rad max(referens, snitt) × 1,15. Referens, Snitt 12 mån i fetstil, skillnaden som pill, Snitt 3 mån (med sin egen referens när KPI är på) och skillnaden som pill. *Mat, förbrukningsvaror och hygien* som grå rad (`band`) före totalen; totalen med 1 px linje i `ink` och skillnaderna som färgad text.
4. **Rullande snitt, totalt** (7/12): 12 månader svart 2,5 px, 3 månader orange 2 px, referensen streckad med "referens 6 580 kr" (med KPI en egen linje, eftersom den rör sig); tooltip med alla tre; förklaringen under. **Utanför jämförelsen** (5/12): beloppet i 28 px fetstil "i månaden, snitt 12 mån", vad det går till, en tvådelad stapel *jämförs* (svart) / *utanför* (grå) med kronor, kategorier som saknar mappning och köp utan kategori, och *Vilka kategorier räknas var*, som fäller ut listan där en kategori flyttas till en post.
5. **Noterna** som en text under korten: riksgenomsnittet, KPI-justeringen när den är på, vad Din del eller Hela hushållet räknar, vad som inte räknas för er, *Ändra hushållet* och källan som länkar.
6. **Bredder:** trenden och Utanför staplas under 56 rem. Under 56 rem kortbredd visar totalens skillnad bara procenten. Under 44 rem visar Per post inte 3-månaderskolumnerna; ett tryck på postens namn fäller ut dem i en rad under. Under 36 rem döljs också stapeln och referensen (referensen står i utfällningen).

### Design v2: Analys – Jämför perioder

Klar 26/9. Beräkningen (A − B per kategori och underkategori, CSV) är oförändrad; nytt är snabbvalen för perioderna, heron, de parvisa staplarna och sorteringen. `GET /api/analysis/compare` tar nu också `bScale` (0–1), som B:s summor multipliceras med för *Snitt 12 mån*. Koden ligger i `web/src/views/analysis/Compare.tsx` och `analysis/compare/`: `periods.ts` (perioderna, snabbvalen, ⇄ och adressen), `PeriodCards.tsx`, `delta.ts` (tonen, de största skillnaderna, ordningen), `CompareHero.tsx` och `CompareTable.tsx`.

1. **Perioderna:** två kort, A med blå bricka (`accent`) och B med grå (`ink-2`). Namnet är en väljare (Månad / Kvartal / År / Anpassat, sedan listan eller två datum) med datumintervallet och antalet dagar under. A:s chips *Månad / Kvartal / År / Anpassat* byter längd till den period av den sorten som innehåller A:s start. B:s chips är relativa till A: *Månaden före* (texten följer A: Kvartalet/Året/Perioden före; förvalt), *Samma förra året* (29 februari blir 28) och *Snitt 12 mån* (de tolv hela månaderna före A, skalade till A:s längd: en månad 1/12, ett kvartal 3/12, ett år 1, ett intervall efter dagarna). B:s egna längdval finns i väljaren bakom namnet. ⇄ mellan korten byter A och B (inte med snittet). Valen står i adressen: `?a=2026-08`, `2026-K3`, `2026` eller `2026-08-03_2026-09-10`; `&b=ifjol`, `snitt12` eller en period (Månaden före skrivs inte ut).
2. **Heron:** "augusti 2026 mot juli 2026"; totalens Δ i kronor, 40 px fetstil, `caution-text` när A är större och `positive-text` när mindre, med "mer/mindre i augusti · +39,1 %"; A (`accent-soft`) och B (grå) totalt i två rutor; *Störst skillnad* med de fyra huvudkategorierna med störst |Δ| som pills (orange/grön). Månaden står utan år när A och B är samma år.
3. **Per kategori:** rubrik och förklaringen (A = blå, B = grå, Δ = A − B), *Störst skillnad / Kategoriordning* (sparad i webbläsaren, `analysis.compare.order`) och *CSV* (som förut). Raden: chevron (när det finns underkategorier), kategorins prick (samma färger som Per kategori, lyfta i mörkt tema) och namn; två 6 px staplar, A blå över B grå, mot det största värdet i tabellen; A och B (återbetalningar gröna med "+"); Δ som pill med kronor och procent (orange mer i A, grön mindre, grå ±0; procent utelämnas när B är 0). Underkategorierna fälls ut i samma form. Rader där A och B båda är 0 visas inte. Totalt i en grå rad (`band`) i fetstil. Fotnoten om pillens färger, sedan Din del.
4. **Bredder:** periodkorten staplas under 56 rem med ⇄ (vänd lodrätt) emellan. Under 40 rem kortbredd döljer tabellen staplarna, Δ-pillen visar bara kronor och kategorinamnet kortas.
