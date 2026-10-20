# Använda Privatekonomi

Det här är handboken: hur du importerar, vad varje vy visar och hur du gör månadsavstämningen. Kom igång första gången: [KOMIGANG.md](KOMIGANG.md). Hur man exporterar från olika banker: [BANKER.md](BANKER.md).

## Importera

Under **Importer** kan du släppa in **flera filer på en gång**: Swedbank-CSV, Norwegian-XLSX och Norwegian-fakturor i valfri blandning. Banker utan egen import läses in som CSV med *Läs in en CSV från en annan bank* (se [Banker](BANKER.md)). Konton skapas under Inställningar › Konton och bankkopplingar, eller direkt vid en Swedbank-import ("+ Nytt konto").

**Förhandsgranskningen.** Den visar en rad per fil med källa, konto, period, nya rader, dubbletter, rader utan kategori och eventuella fel. Klicka på en rad för att se detaljer. Siffrorna är exakta även när filerna överlappar varandra, eftersom hela importen körs på prov och rullas tillbaka.

**Kontoval.** Du väljer konto en gång per konto, inte per fil.

**Själva importen.** Filerna importeras i datumordning, och varje fil loggas för sig. En trasig fil stoppar bara sig själv. Filer där allt redan finns markeras *Redan importerad* och skickas inte med.

**Egna exportmappar.** Lägg gärna dina exporter i `exports/` (den finns inte i git), till exempel `exports/swedbank/privatkonto/`, `exports/swedbank/e-sparkonto/`, `exports/norwegian/` och `exports/norwegian/fakturor/`. Verktyget bryr sig inte om mappstrukturen.

## Månadsrutin

Gör detta när månaden är slut, gärna efter den 25:e, när hyran, Norwegian-fakturan och partnerns Swish har gått:

1. **Exportera från Swedbank** (CSV, se nedan): *Privatkonto* och *e-sparkonto*, varsin fil, eller in och ut för sig. Välj en period som överlappar förra exporten, gärna hela förra månaden plus den här. Dubbletter hoppas över automatiskt.
2. **Exportera från Bank Norwegian:** *transaktionerna som XLSX* för förra kalendermånaden (och den här, om du vill ha det senaste). Hämta också *fakturan som PDF* om skulden och förfallodagen ska uppdateras i Översikten.
3. **Lägg filerna** i `exports/`, t.ex. `exports/swedbank/2026-09/` och `exports/norwegian/2026-09/`. Mappen finns inte i git, och strukturen spelar ingen roll.
4. **Importera:** gå till **Importer**, dra in alla filer på en gång, kontrollera förhandsgranskningen och klicka på *Importera*.
5. **Att granska:** sätt kategori på okategoriserade grupper (med *kom ihåg* skapas en regel), eller svara *Vet ej*. Titta på *Möjliga dubbletter*.
6. **Mastercard:** lägg in månadens faktura (belopp och förfallodag) under Översikt → Saldon → *Ny faktura…*. Markera fasta Mastercard-utgifter som betalda om de har dragits.
7. **Uppdatera saldon** för Privatkonto och e-sparkonto i Översikten (klicka på saldot). Då stämmer prognosen.
8. **Stäm av med partnern:** gå till **Delad ekonomi** för förra månaden och gör så här:
   - Lägg in det partnern betalat från sina egna konton.
   - Kontrollera *Vems* på köp som var hennes eller delade. *Vad gällde den?* vid hennes Swish hjälper till.
   - Swisha eller ta emot resultatet. Klicka sedan på *Stäm av: vi är kvitt* om ni är överens (en liten skillnad nollställs och nästa månad börjar på 0), eller *för över* om skillnaden ska följa med.
9. **Titta på Analys** om du vill, till exempel andelen restaurang under **Mat**.

## Exportera från banken

> Menynamnen kan skilja sig lite mellan versioner av internetbanken.

### Swedbank (CSV)

1. Logga in i internetbanken och öppna kontot (Privatkonto eller e-sparkonto).
2. Välj **Transaktioner** och sätt en period. Swedbank exporterar insättningar och uttag var för sig, så ta **båda** exporterna. Verktyget klarar filer med bara insättningar, bara uttag eller båda.
3. Exportera/ladda ner som **CSV**. Filen heter `Transaktioner_<datum>_<tid>.csv`.
4. Dra in filen i verktyget under **Importer**. Du ser först en förhandsgranskning: vilket konto raderna hamnar på och hur många som är nya respektive dubbletter. Tryck sedan på **Importera**.

Det gör inget om perioden överlappar en tidigare export, eller om du exporterar samma period igen. Dubbletter känns igen och hoppas över. Filen kan vara i bankens originalformat (Windows-1252) eller sparad om som UTF-8. Båda ger samma resultat.

**Konto per fil.** Kontot bestäms av kontonumret i filen. Första gången väljer du i förhandsgranskningen vilket av dina konton raderna ska läggas på, eller skapar ett nytt ("+ Nytt konto"). Därefter är kontonumret (maskerat, de fyra sista siffrorna och clearingnumret) kopplat och känns igen automatiskt. Har du angett *Produkten i Swedbanks fil* när du skapade kontot (kolumnen `Produkt`, till exempel "Privatkonto") är det förvalt första gången.

**Överföringar mellan egna konton.** Swedbank anger motkontots nummer i fältet `Referens`. Verktyget jämför clearing och de fyra sista siffrorna med dina konton (hela numret sparas aldrig). Vid träff blir raden en överföring med motkonto.

De två sidorna paras sedan ihop: samma belopp, motsatt tecken, högst en dags skillnad och konton som pekar på varandra. Det fungerar även om kontona importeras vid olika tillfällen.

Överföringar räknas aldrig som utgift eller inkomst. Kortbetalningar blir överföringar till kortets konto när du har angett betalningstexten för kortet (Nytt konto › Kreditkort), och paras med kortets "Inbetalning" när den finns.

**Så fungerar dubblettskyddet.** Varje rad får ett fingeravtryck (sha256 av kontonummer, de tre datumen, referens, beskrivning och belopp). `Radnummer` används inte. Två helt identiska köp samma dag (t.ex. två SL-biljetter) räknas isär med ett löpnummer inom filen. Har filen 3 sådana och databasen redan 2, läggs 1 till. En rad som redan finns ändras aldrig. Kategori, delad-flagga och anteckning som du har satt finns kvar vid omimport. Borttagna rader kommer inte tillbaka.

**Möjliga dubbletter.** Om banken ändrar en redan bokförd rad mellan två exporter ser raden ut som en ny transaktion. Importen flaggar sådana rader som *möjlig dubblett* när transaktionsdag, belopp och beskrivning är samma som för en befintlig rad men bokföringsdagen skiljer sig. De importeras ändå men listas separat i förhandsgranskningen och sammanfattningen, så att du kan ta bort den överflödiga raden för hand (i transaktionsvyn från steg 5).

### Bank Norwegian: transaktioner (XLSX), huvudkällan för kortet

1. Logga in på Bank Norwegian, gå till kortets **transaktioner** och välj en kalendermånad.
2. Exportera till **Excel** (t.ex. `Augusti.xlsx`).
3. Dra in filen under **Importer**.

Exportera helst när månaden är **avslutad**. Rader av typen *Reserverat* (ännu inte bokförda köp) importeras inte. Förhandsgranskningen visar antal och summa, och de kommer med när du exporterar månaden igen.

- Köp markeras som **delade** (gemensamt kort). En regel kan ändra det. *Betalning* (inbetalning på kortet) lagras som överföring.
- Kategori sätts i den här ordningen: **regel**, sedan **bankens handlarkategori** (Merchant Category, t.ex. "Grocery Stores" → Mat › Livsmedel) och sist okategoriserad. Mappningen redigeras under **Kategorier & regler**. Okända handlarkategorier läggs upp där automatiskt.
- Samma köp får samma fingeravtryck i XLSX och PDF. Det spelar alltså ingen roll i vilken ordning du importerar månadsexporter och fakturor, eller om de överlappar. Varje köp finns bara en gång.

### Bank Norwegian: faktura (PDF)

Fakturan används främst för **skulden och förfallodatumet**. Transaktionerna finns oftast redan via XLSX och hoppas då över.

1. Logga in på Bank Norwegian och gå till kreditkortets **fakturor**.
2. Ladda ner månadens faktura som **PDF** (t.ex. `Faktura September.pdf`).
3. Dra in PDF:en under **Importer**. Förhandsgranskningen visar fakturans period, förfallodatum, total skuld och lägsta belopp, och vilka rader som är nya.

- Köp lagras som negativa belopp och markeras som **delade**. Rader med "Inbetalning" lagras som överföring och räknas aldrig som utgift.
- Fakturan sparas i fakturahistoriken. Kontot Bank Norwegian får saldot −(total skuld), men bara om fakturan är nyare än den senaste saldouppdateringen. En äldre faktura eller en senare manuell ändring skrivs alltså inte över.
- Fakturaperioderna överlappar (köp från sista dagen i förra perioden syns igen). Det hanteras med samma dubblettskydd som för Swedbank.
- **Kontrollsumma:** köpen och inbetalningarna i tabellen måste stämma exakt med sammanställningen på sida 1, annars importeras ingenting. Då kan en feltolkad PDF aldrig ge felaktiga siffror.
- Namn, adress och OCR-nummer sparas inte. Långa nummer i beskrivningar maskeras (`Inbetalning från ••7085`). Kortnumret sparas bara maskerat, som på fakturan.

## Översikt (startsidan)

- **Varningar överst:** fasta utgifter som passerat utan att synas i banken, obetald kortfaktura som förfaller inom 5 dagar, bankkontosaldon äldre än 7 dagar, fasta utgifter med ändrat belopp, lön som inte kommit och antal rader att granska.
- **Kvar att leva på till nästa lön:** summan av saldona på Privatkontot och e-sparkontot, minus fasta utgifter på bankkontona med status *kommande* före lönedagen, minus obetalda kortfakturor som förfaller före lönedagen. Visas totalt och per dag.
- **Nästa lön:** uppskattat belopp, eller det *förväntade belopp* du skriver in för månaden, t.ex. från lönespecen. När lönen har importerats visas *lön mottagen* och prognosen räknar mot nästa månads lön.
- **Utgiftstakt:** rörliga utgifter per dag de senaste 30 dagarna, jämfört med det som finns kvar per dag. Den räknar din del (delade köp till hälften). Med *Visa hela hushållet* räknas delade köp fullt. Samma växel gäller *Den här månaden*.
- **Saldon:** klicka på ett saldo för att uppdatera det. Norwegian-saldot kommer från fakturan. För Mastercard lägger du in fakturan (belopp och förfallodatum) under *Ny faktura…*. En faktura räknas som betald när en kortbetalning matchar den, eller när du markerar den som betald.
- **Fasta utgifter den här perioden:** grupperade per konto, med nästa dragning per betalsätt och status per rad (kommande, dragen med länk, förfallen, passerad eller markerad betald). *Markera betald* används för Mastercard-dragningar som inte importeras.
- **Den här månaden:** rörliga utgifter per huvudkategori hittills, jämfört med snittet för samma dagar (1 till idag) de tre föregående månaderna.
- **Engångsinkomst eller -utgift:** registreras längst ner, eventuellt med *uppdatera saldo*.

## Transaktioner och Att granska

- **Filter:** period (månad, eget datumintervall eller en *Bank Norwegian-faktura*, alltså köpen 16:e–15:e som betalas den 25:e), konto, kategori (en huvudkategori tar med sina underkategorier, och det finns ett filter för rader utan kategori), källa, delad/egen, visa överföringar och fritext (text, kontaktnamn, ort, anteckning eller belopp). Filtren finns kvar när du byter flik.
- **Redigering:** klicka på kategori eller anteckning för att ändra, och bocka i eller ur Delad. När du ändrar kategori får du frågan **"Skapa regel för …?"** (förvalt ja). Regeln gäller texten, och för Swish telefonnumret och riktningen. Den kategoriserar direkt andra okategoriserade rader med samma handlare och visar hur många.
- **Returnerad:** klicka på ↩ på ett köp som gick tillbaka. Verktyget föreslår återbetalningarna från samma handlare. Köpet och återbetalningarna syns kvar, överstrukna, men räknas inte någonstans. *Ångra* finns på raden.
- **Ta bort:** importerade rader tas bort med soft delete och kan ångras direkt eller återställas under **Borttagna**. De kommer inte tillbaka vid omimport.
- **Att granska:**
  - *Okategoriserade* grupperas per handlare (Swish per nummer och riktning), med flest rader först, antal och summa. Du sätter kategori på en hel grupp på en gång, och med *kom ihåg* skapas en regel.
  - *Möjliga dubbletter* är rader från olika importer som bara skiljer sig i bokföringsdag. Välj *Ta bort den nyare* eller *Behåll båda*.
- **Vet ej:** på en grupp eller en okategoriserad rad sätts *Övrigt › Okänt* utan regel. Filtret *utan kategori* kan ta med Okänt. När samma nummer finns som två grupper (in och ut) kan båda få samma kategori på en gång.
- **Privata rader:** ögonikonen gör en rad privat. Den räknas i alla summor men visas som en grå rad "Privat" tills du slår på *Visa privata* under Inställningar. Medan de visas finns knappen *dölj* i sidhuvudet, och visningen stängs av när sidan laddas om. Privata rader är aldrig delade.
- **Kopplingar:** rader som hör till en fast utgift har en ↻-markering som öppnar utgiften.
- **Summor:** överföringar och pengar mellan dig och partnern (Till/Från partner) räknas inte.

## Delad ekonomi

Månad för månad efter **betalningsdag**, det vill säga när pengarna lämnar ditt konto (bläddra med ‹ ›). Norwegian-köp räknas när fakturan betalas: köp 16:e–15:e betalas den 25:e. Hyran och kortfakturan den 25:e hamnar alltså i samma månad som partnerns Swish för dem. Det som ska betalas senare i månaden visas som *betalas 25/9*. Rubriken visar vad partnern ska betala den 25:e för hela månaden.

- **Delat som jag betalat:** delade Norwegian-köp, delade fasta utgifter (dragningen, eller det förväntade beloppet om den inte syns, t.ex. Mastercard) och delade Swedbank-rader. Grupperna kan fällas ut.
- **Delat som partnern betalat:** köp hon gjort från sina egna konton. Lägg in beskrivning, belopp och datum. De räknas i hushållet men aldrig i dina saldon eller din prognos.
- **Överföringar mellan er:** Swish i kategorierna *Från partner* och *Till partner*.
- **Resultat:** "partnern ska betala X" eller "du ska betala X". Uträkningen visas rad för rad: hälften av skillnaden mellan det ni lagt ut, minus det hon swishat netto, plus förra månadens resultat (ingående).
- **Stäm av** låser månaden med en anteckning. Ändras något i efterhand visas det som en avvikelse. *Lås upp* för att stämma av igen.
- En notis visas om månaden inte är fullständigt importerad.
- Översikten visar *Väntas från partnern* under prognosen. Det räknas inte in förrän pengarna har kommit.
- **Vems:** i transaktionslistan väljer du för varje rad *Eget*, *Delat* (ni delar lika) eller *partnerns* (något du betalat som var helt hennes, så hon betalar hela). För det partnern betalat finns *Delat* och *Mitt*. Bocka i flera rader för att ändra dem på en gång.
- **Räkna inte:** en Swish som reglerade något för sig, t.ex. din halva av något partnern köpt på sitt kort, kan tas bort ur uträkningen med *räkna inte* i listan Från/Till partnern. Den ligger kvar och kan räknas med igen.
- **Vad gällde Swishen?** Under *Från partnern* föreslås för varje Swish dina köp runt det datumet med ungefär samma belopp (troligen partnerns) eller dubbla beloppet (troligen delat). Ett klick markerar köpet.

## Analys

Periodvalet (senaste 3, 6 eller 12 månaderna, i år, eller anpassat) delas mellan flikarna och sitter kvar. "Senaste 3 månaderna" betyder de tre hela månaderna före den här, plus den här månaden hittills. Växeln *Visa hela hushållet* är samma som i Översikten.

Grundregler i alla vyer:
- Överföringar, avstämning (Till/Från partner) och det partnern betalat ingår aldrig.
- I *din del* räknas delade köp till hälften och partnerns köp inte alls.
- Privata rader ingår i summorna men visas aldrig med namn.
- Övrigt › Okänt är en egen post.

Flikarna:
- **Per kategori:** staplade staplar per huvudkategori, de senaste 12 månaderna, med en linje för totalen. Klicka på en kategori under diagrammet för dess underkategorier. Klicka på en stapel för att öppna transaktionslistan för den månaden och kategorin.
- **Snitt:** per källa (konto) och per kategori, med snitt per vecka och per månad. Bara hela veckor (mån–sön) och hela månader räknas, och antalet visas. Månader som importen inte täcker (före första importen, efter den senaste eller i ett glapp) markeras.
- **Mat:** Livsmedel mot Restaurang & café per månad och andelen restaurang.
- **Fasta mot rörliga:** fasta (dragningar som matchats mot en fast utgift), rörliga, inkomster och netto per månad, och hur stor andel av inkomsten som är fast.
- **Topplista:** handlare efter summa, med antal köp och snitt per köp. Din egen etikett visas om den finns. Klicka för att se raderna.
- **Jämför perioder:** två månader, kvartal, år eller egna perioder, per kategori med differens i kronor och procent.
- **Export:** varje tabell har knappen *CSV*. Filen använder semikolon och decimalkomma, så den öppnas direkt i svenska Excel.

## Referensbudget (Konsumentverket)

**Analys › Konsumentverket** jämför era faktiska utgifter per post med Konsumentverkets beräknade hushållskostnader, som rullande snitt över 12 och 3 hela månader. Referensen täcker ungefär 40 % av ett hushålls utgifter. Boende, transport, restaurang och café, semester och presenter ingår inte.

- **Hushållet** ställs in under **Inställningar › Referensbudget**: personer, åldersgrupp, matvariant och poster som inte gäller er, till exempel el och vatten som ingår i hyran.
- **Vilka kategorier som räknas var** ändras längst ned i fliken. En ny kategori räknas ingenstans förrän den fått en post.
- **KPI-justerad referens** (kryssrutan i fliken, av som standard) flyttar varje post med sin grupp i SCB:s KPI mot gruppens snitt för referensåret. Konsumentverkets siffror är redan en prognos för årets prisnivå, så justeringen rättar bara det prognosen inte såg, till exempel en momssänkning. Justeringen syns i 3-månaderssnittet och i ett nytt år innan nästa års siffror kommit. Grupperna hämtas från SCB med de andra KPI-serierna.

### Lägga in ett nytt år

Konsumentverket publicerar nästa års siffror i mitten av november. Från den 15 november står *Nya referensvärden från Konsumentverket – lägg in <år>* i Att göra, och fliken visar samma steg. Tills det nya året är inlagt jämförs med det senaste året, och fliken säger det.

1. **Hämta PDF:en** *Hushållskostnader <år>* från konsumentverket.se.
2. **Kopiera förra årets fil.** Kopiera `server/reference-budget/<förra året>.json` till `server/reference-budget/<år>.json`. Ändra `year`, `source` (titel och adress) och `note`.
3. **Skriv in beloppen** i hela kronor per månad.
   - En tom cell i PDF:en (–) utelämnas. Skriv aldrig 0 för en tom cell.
   - Nycklarna (`food_home`, `clothing` …) ändras inte, eftersom kategorimappningen hänger på dem.
   - Fotnoterna står under `adjustments`.
   - Varje post har sin KPI-grupp i `kpi` (COICOP 2018, till exempel `03` för kläder). Gruppen måste finnas i `server/src/prices/scb-kpi.json`, annars avvisas filen. Basen för KPI-justeringen är årets KPI-snitt. Ett fält `priceBase` (`ÅÅÅÅ-MM`) låser den i stället till en månad.
   - Har Konsumentverket ändrat åldersgrupper eller poster ändras `ageGroups` och `items`. En ny post behöver en mappning i fliken. En helt ny sorts fotnot kräver en kodändring (`REFERENCE_BUDGET_CONDITIONS`), och filen avvisas tills den finns.
4. **Kontrollera mot PDF:en.** Lägg in årets summarader (*summa kostnader*, individuella utom mat och hushållets gemensamma) i `PUBLISHED_TOTALS` i `server/test/reference-budget.test.ts` och kör:

   ```bash
   npm test -- reference-budget
   ```

   Summorna räknas fram ur posterna, så en felskriven cell syns här. Utan årets rad i `PUBLISHED_TOTALS` fallerar testet med en uppmaning att lägga till den.
5. **Starta om** verktyget. Loggen (`data/logs/server.log`) säger *Referensbudget <år>: inläst*. Påminnelsen försvinner.

**Rätta ett år:** ändra filen och starta om. Filen vinner, och hela året ersätts, i en transaktion. Startkopian i `data/backups/` tas före. En fil som inte går att läsa loggas och hoppas över, och det gamla året ligger kvar.

**Ta inte bort en fil för att ta bort ett år.** Året ligger kvar i databasen, och loggen säger bara att det saknar fil.

## Kategorier & regler

- Klicka på ett namn för att byta namn, och på pricken för att byta färg. Håll musen över en kategori för *flytta* (underkategorier), *slå ihop* och *ta bort*.
- En kategori med rader eller regler tas bort genom att raderna och reglerna först flyttas till en annan kategori.
- Kategorier som verktyget använder (t.ex. Lön, Från partner och Okänt) kan byta namn men inte tas bort.
- *+ Ny kategori…* finns också längst ner i kategoriväljaren i listorna.

## Fasta utgifter

Lägg in dem under **Fasta utgifter › Ny fast utgift**, eller med *Gör till fast utgift…* på en dragning i transaktionslistan. Redan importerade transaktioner kopplas bakåt i tiden när du anger matchningstexten.

- **Koppling till transaktioner:** varje utgift kan ha en *matchningstext*, bankens text för dragningen (t.ex. `TRE KRONOR`). Importerade rader kopplas på konto, text och ±5 dagar från förfallodagen. Det gäller även historik som redan är importerad. Beloppet avgör bara när flera utgifter har samma text. Mastercard-utgifter har ingen text än, eftersom kortet inte importeras.
- **Belopp per månad:** för dragningar som varierar (t.ex. CSN) kan du under ⋯ sätta ett eget belopp för varje månad under året. Bläddra mellan år med ‹ ›. Ett tomt fält betyder standardbeloppet. Tidigare månader visar vad som faktiskt drogs. Månadens belopp används i prognosen, i Fasta utgifter den här perioden, i avstämningen och i kontrollen av ändrat belopp.
- **Byta plan:** byter ett abonnemang plan (Plus till Pro, och tillbaka) ändras priset och ofta dragdagen. På köpet som startade den nya planen finns *Byt plan för …* i Transaktioner: köpet blir första dragningen på den nya planen och utgiften minns den gamla, så månaderna före behåller sitt pris och sin dag. Planens pris går att ändra i formuläret: kostade uppgraderingen bara mellanskillnaden (937 kr ovanpå 249 kr, för en plan på 1 186 kr) fyller en länk i summan. Dragningarna räknas som utgiftens kostnad – 249 kr i september och 937 kr i oktober – och därefter väntas planens pris. I utgiftens panel finns *Byt plan…* för att lägga in ett byte själv, också ett som ska börja nästa månad, och *Planer* visar historiken med *Ångra senaste planbyte*.
- **Beloppet har ändrats:** om senaste dragningen har ett annat belopp än det som väntades för månaden visas den överst med knappen *Uppdatera beloppet*. Inget ändras automatiskt.
- **Vyn:** lista med redigering direkt i tabellen (fler fält under ⋯), summor per betalsätt, per konto och för delat och eget, samt en kalender över månaden.

## Inställningar

- **Återkommande inkomster.** När lön har importerats föreslås "Lön" med snittbelopp och vanligaste dag från de tre senaste lönerna. Du bekräftar förslaget, och sedan kopplas lönerader automatiskt (samma konto, texten innehåller mönstret, ±5 dagar).
- **Kontakter.** Namn på Swish-nummer, som visas i listorna i stället för numret.
- **Partnerns Swish-nummer.** Swish mottagen från numret blir *Inkomst › Från partner* och räknas i den delade ekonomin, inte som vanlig inkomst.
