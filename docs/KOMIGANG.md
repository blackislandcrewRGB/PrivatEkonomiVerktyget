# Kom igång

De första tio minuterna med ett tomt verktyg. Vill du bara titta runt först: `npm run demo` ger en databas med ett påhittat hushåll (se [README](../README.md)).

Du behöver: Node 24, och en export av transaktioner från din bank (se [Banker](BANKER.md) för hur man gör).

```bash
npm ci
npm start
```

Öppna <http://127.0.0.1:3001>. Första gången skapas databasen i `data/finance.db`, och Översikten visar *Välkommen* med stegen nedan. Den försvinner när du har läst in den första exporten.

## 1. Skapa dina konton

**Inställningar › Konton och bankkopplingar › Nytt konto.** Skapa ett konto för varje bankkonto och kreditkort du vill följa. Du väljer:

- **Sort:** bankkonto eller kreditkort. Ett kreditkort är en skuld, och räkningen betalas från ett bankkonto.
- **Hur det fylls på:**
  - *CSV-fil från banken* fungerar för vilken bank som helst. Du pekar ut kolumnerna första gången (steg 2).
  - *Swedbank*, *Bank Norwegian* och *Swedbank Mastercard* har egna importer som känner igen filerna av sig själva. Swedbank känner också igen överföringar mellan dina egna konton.
  - *Ingen import* om du bara vill föra in saldo och rader för hand.
- **För ett kreditkort:** texten som betalningen av räkningen har på kontot den dras från (kortets namn brukar räcka). Då räknas betalningen som en överföring till kortet och inte som en utgift.

Namnen är dina egna ("Lönekonto", "Sparkonto", "Visa"). Du kan byta namn och ta bort ett konto utan transaktioner under *Ändra*.

## 2. Läs in en export

Logga in hos banken som vanligt och exportera transaktionerna som CSV. Välj en lång period, gärna hela året: dubbletter hoppas över, så det gör inget att filer överlappar.

Gå till **Importer**:

- **Swedbank, Bank Norwegian och Mastercard:** släpp filerna där. Du ser en förhandsgranskning med vad som är nytt innan något sparas.
- **Vilken annan bank som helst:** *Läs in en CSV från en annan bank*. Välj filen och kontot. Verktyget gissar kolumnerna (datum, text, belopp, och hur siffrorna skrivs) och visar de första raderna med varje kolumns roll. Ändra det som är fel: rader att hoppa över överst, skiljetecknet, datumformatet, om beloppet är en kolumn eller två (uttag och insättning), decimaltecknet. Raderna som blir fel visas med radnummer, och **inget importeras** förrän allt går att läsa. När du importerar sparas inställningarna för kontot, så nästa fil från samma bank läses utan att du frågas.

Filen sparas inte, bara raderna ur den.

## 3. Sätt kategori på det som blir över

Reglerna som följer med kategoriserar vanliga svenska handlare (ICA, Lidl, Systembolaget, Circle K, Spotify, Tele2 och många fler). Resten hamnar under **Transaktioner › Att granska**, grupperat per handlare med flest rader först. Välj en kategori för hela gruppen, och bocka i *kom ihåg* så görs en regel som kategoriserar nästa import själv. Några minuter här ger mest.

## 4. Fasta utgifter och inkomster

- **Fasta utgifter › Ny fast utgift:** hyra, försäkringar, abonnemang. Skriv *matchningstexten*, bankens text för dragningen (till exempel `TELE2`), så kopplas dragningarna i banken till utgiften, också bakåt i tiden. Då vet Översikten vad som är kvar att leva på till nästa lön.
- **Lön:** när lönen har kommit med i en import föreslås den under **Inställningar › Återkommande inkomster**, med snittbelopp och vanligaste dag från de tre senaste. Bekräfta förslaget, så kopplas lönerna automatiskt.

## 5. Delar ni ekonomi?

Under **Inställningar › Partner** anger du partnerns Swish-nummer (och ditt eget namn). Swish från partnern räknas då i **Delad ekonomi** och inte som vanlig inkomst. Markera delade köp med *Delat* i transaktionslistan (eller sätt en regel som gör det), så räknar verktyget ut vad som ska swishas varje månad, med avstämning. Se [Använda verktyget](ANVANDNING.md#delad-ekonomi).

## 6. Fortsätt

- **Saldon:** klicka på ett saldo i Översikten och skriv in det som står i banken, så stämmer prognosen.
- **Månadsrutinen:** exportera, importera, granska, stäm av. Se [Använda verktyget](ANVANDNING.md#månadsrutin).
- **Direkt från banken:** [Drift](DRIFT.md#enable-banking-valfritt).
- **Sparande, pension och skatt:** Översikt › Pension och Ekonomisk situation, och Analys › Sparande.
- **Valfria moduler:** *Lön* (löneprognos för timlön och månadslön, med OB, mertid och övertid) och *Pendling & bränsle* är avstängda tills du slår på dem under **Inställningar › Moduler**. De passar inte alla. Lön läser Hogias lönespecar (webbspec eller PDF) och kan också fyllas i för hand; avtalets OB-satser och gränser för övertid lägger du själv in under **Inställningar › Lön › Avtalet**, så räknas bara det du fyllt i.
