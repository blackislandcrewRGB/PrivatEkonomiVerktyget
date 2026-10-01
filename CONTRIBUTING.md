# Bidra

Verktyget är byggt för svenska hushåll och på svenska. Bidrag är välkomna: rättelser, fler banker, bättre kategorier.

## Komma igång

```bash
npm ci
npm test                # server och webb, ungefär en minut
npm run typecheck
npm run dev:test        # utveckling mot en testdatabas: API 3101, webb http://localhost:5174
npm run demo            # eller mot påhittad data
```

Node 24. På Windows: kör i WSL (Ubuntu), eftersom skripten är bash och better-sqlite3 byggs som en native-modul.

Läs `SPEC.md` (vad som är byggt) och `UI-SPEC.md` (hur gränssnittet ser ut) innan nytt arbete, och uppdatera dem när du ändrar något de beskriver. `CLAUDE.md` har de arbetsregler som gäller för den som utvecklar med Claude Code, och de är bra regler för alla.

## Kommandon

| Kommando | Vad det gör |
|---|---|
| `npm test` | Alla tester (Vitest, server och webb) |
| `npm run typecheck` | Typkontroll av servern och webben |
| `npm run dev:test` | Utveckling mot en testdatabas (`data/test/finance-test.db`, API 3101, webb 5174) |
| `npm run demo` / `npm run db:demo` | Demodatan (`data/demo/`), med eller utan att starta appen |
| `npm start` | Bygger webben och kör appen på `http://127.0.0.1:3001` |
| `npm run db:migrate` | Kör migreringarna mot databasen (SQL och datamigreringar) |
| `npm run db:seed` | Lägger till grundkategorier och regler som saknas. Ändrar aldrig befintliga rader |
| `npm run db:generate -- --name <namn>` | Skapar en ny migrering efter en ändring i `server/src/db/schema.ts` |
| `npm run db:check -- <fil>` | Kontrollsiffror för en databas (läser bara) |
| `npx tsx server/test/fixtures/generate-bank-fixtures.ts` | Gör om de påhittade bankfilerna i testerna |
| `npm run check:personuppgifter` | Kontrollen före commit (se Regler) |

## Regler

- **Inga personuppgifter i git, aldrig.** Det här är ett öppet repo. Tester och demodata är påhittade: `+46XX5550NNN` som telefonnummer, påhittade namn, vanliga kedjor eller `EXEMPEL…` som handlare. Lägg inte in en riktig export, ett kvitto eller en faktura, inte ens med namnet bortredigerat. Har du ett fall från riktig data som behöver testas: bygg en liten fil för hand med samma form.
- Kör `npm run check:personuppgifter` före varje commit (den letar efter mobilnummer och förbjudna filer, och efter dina egna mönster i `samples/privat/kontrollmonster.txt` om du har skapat den filen).
- **Kod, kommentarer och commit-meddelanden på engelska. Gränssnitt och dokumentation på svenska.**
- Belopp i öre som heltal, datum som `YYYY-MM-DD`, "i dag" i lokal tid (`todayLocal`), aldrig `toISOString()` för ett datum.
- Varje ändring ska ha ett test. Servertester använder `freshDb()` i minnet och rör aldrig en riktig databas. Webbtester mockar API:t med `mockApi` (`web/test/api.ts`).
- Ändrar du schemat: `npm run db:generate -- --name <namn>` och skriv klart SQL-filen. Ändrar du befintlig data i koden: en datamigrering i `server/src/db/dataMigrations.ts`.
- Ändrar du gränssnittet: titta på det i ljust och mörkt tema och i 390, 820 och 1280 px bredd.

## En ny bank

Banker utan egen import läses redan in som CSV (se `docs/BANKER.md`), så en ny bank behöver bara en egen import om dess filformat inte går att beskriva med kolumnmappningen (ett eget filformat, PDF eller XLSX). En egen import är en parser (`server/src/import/<bank>.ts`) och en `import<Bank>.ts` som ger `runImport` (`importCore.ts`) rader med fingeravtryck; ta `swedbank.ts` och `importSwedbank.ts` som mall och lägg till en test med en liten påhittad fil.
