# Banker

Så får du in transaktionerna från din bank. Det finns tre vägar:

1. **Bankens egen import:** Swedbank, Bank Norwegian och Swedbank Mastercard känns igen av sig själva.
2. **Allmän CSV-import:** vilken annan bank som helst, med en kolumnmappning du gör en gång.
3. **Direkt från banken** med Enable Banking (valfritt): Swedbank och Bank Norwegian, se [Drift](DRIFT.md#enable-banking-valfritt).

Menynamnen i internetbankerna ändras ibland, så följ stegen i sak snarare än efter ordalydelsen. Verktyget loggar aldrig in hos din bank åt dig.

## Vilken annan bank som helst: CSV

De flesta banker låter dig ladda ner transaktionerna som en CSV-fil (ibland som Excel eller "kommaseparerad"). Sök efter *exportera*, *ladda ner* eller *transaktioner som fil* i internetbanken, och välj CSV eller textfil. Välj en lång period.

1. Skapa ett konto under **Inställningar › Konton och bankkopplingar › Nytt konto**, med *CSV-fil från banken* som källa.
2. **Importer › Läs in en CSV från en annan bank.** Välj filen och kontot.
3. Kontrollera kolumnerna. Verktyget gissar på skiljetecken, rubrikrad, datumkolumn, textkolumn och belopp, och visar de första raderna med vad varje kolumn läses som. Det som kan behöva ändras:

   | Inställning | När |
   |---|---|
   | **Rader att hoppa över överst** | Filen börjar med en rubrik eller en rad med kontonummer och period före tabellen |
   | **Första raden är rubriker** | Av om filen inte har kolumnnamn |
   | **Skiljetecken** | Semikolon i de flesta svenska banker, komma eller tabb i andra |
   | **Datum** | Kolumnen med bokföringsdagen (inte räntedagen om det finns båda) |
   | **Så skrivs datumet** | `2026-09-03`, `20260903`, `3/9/2026`, `03.09.2026` eller `03-09-2026` |
   | **Text** | Handlaren eller bankens text. *Mer text* lägger till en andra kolumn, till exempel ett meddelande |
   | **Beloppet** | *En kolumn* med tecken (minus för utgift), eller *Uttag och insättning* i två kolumner skrivna utan tecken |
   | **Decimaltecken** | Komma (`12,50`) eller punkt (`12.50`). Tusentalsavgränsare (mellanslag, punkt eller komma) hanteras |
   | **Utgifter har minustecken** | Av för ett kreditkort som skriver köp som positiva tal |

4. Raden under tabellen säger hur många transaktioner som läses, vilken period de täcker och hur många som är nya. Går någon rad inte att läsa visas den med radnummer och **inget importeras** (så en felaktig mappning aldrig ger en halv import).
5. **Importera.** Inställningarna sparas för kontot. Nästa fil från samma bank läses utan att du frågas; passar de inte (en annan sorts export) gissar verktyget på nytt.

**Att tänka på med CSV:**

- **Dubbletter** känns igen på konto, dag, text och belopp. Två helt likadana köp samma dag räknas som två, och en ny export av samma period lägger inte till något. Ändrar banken texten på en rad mellan två exporter ser den ut som en ny rad.
- **Överföringar mellan dina egna konton** känns inte igen på en CSV (bara Swedbanks filer har motkontots nummer). Sätt en regel på texten (Kategorier & regler) med kategorin *Egna överföringar*, så räknas de inte som utgift och inkomst.
- **Kortbetalningar:** har du angett betalningstexten när du skapade kreditkortskontot räknas betalningen av räkningen som en överföring till kortet.
- **Täckningen** per konto syns på Importer: hur långt det är importerat.

## Swedbank (CSV)

1. Logga in i internetbanken och öppna kontot (Privatkonto eller e-sparkonto).
2. Välj **Transaktioner** och en period. Swedbank exporterar insättningar och uttag var för sig, så ta **båda** exporterna. Verktyget klarar filer med bara insättningar, bara uttag eller båda.
3. Exportera som **CSV**. Filen heter `Transaktioner_<datum>_<tid>.csv`.
4. Släpp filerna under **Importer**. Du ser en förhandsgranskning: vilket konto raderna hamnar på och hur många som är nya. Första gången väljer du konto för varje kontonummer (eller skapar ett nytt); numret binds sedan och känns igen.

Det gör inget om perioden överlappar en tidigare export. Filen kan vara i bankens originalformat (Windows-1252) eller sparad om som UTF-8. Överföringar mellan dina egna konton känns igen på motkontots nummer och paras ihop, och kortbetalningar blir överföringar till kortet. Detaljerna står i [Använda verktyget](ANVANDNING.md#swedbank-csv).

## Bank Norwegian

- **Transaktioner (XLSX), huvudkällan:** logga in på Bank Norwegian, gå till kortets transaktioner, välj en kalendermånad och exportera till Excel. Exportera helst när månaden är avslutad. Reserverade köp importeras inte.
- **Faktura (PDF):** används främst för skulden och förfallodagen. Köpen finns oftast redan via XLSX och hoppas över.

Se [Använda verktyget](ANVANDNING.md#bank-norwegian-transaktioner-xlsx-huvudkällan-för-kortet).

## Swedbank Mastercard

Fakturan som PDF, och transaktionslistan i internetbanken sparad som PDF. Se [Använda verktyget](ANVANDNING.md#importera).

## En bank som saknas, och som inte går att läsa som CSV

Då behövs en egen import: se [CONTRIBUTING.md](../CONTRIBUTING.md#en-ny-bank). Öppna gärna ett ärende med ett exempel på filen, med alla personuppgifter och riktiga belopp utbytta mot påhittade.
