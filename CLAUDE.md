# Privatekonomi – arbetsregler

Ett verktyg för hushållets ekonomi i Sverige: Hono + better-sqlite3 + Drizzle i `server/`, React 19 + Vite + Tailwind v4 i `web/`, Vitest för båda. Läs **SPEC.md** (det som är byggt) och **UI-SPEC.md** (Design v2, en sektion per vy) innan nytt arbete. De ska aldrig säga emot varandra: när något ändras uppdateras de som berörs. Skriv bara in det som är kontrollerat i koden eller uppmätt.

Personliga arbetsregler (en egen server, egna uppgifter) hör hemma i `CLAUDE.local.md`, som inte är i git.

## Arbetssätt

- **Numrerade steg** med en rapport efter varje: vad som är gjort, vad som återstår, frågor. Fråga hellre än gissa.
- **UI-ändringar visas** med skärmdumpar i ljust och mörkt tema, i 390, 820 och 1280 px bredd, innan de committas. Kör mot demodatan (`npm run demo`) eller testinstansen (`npm run dev:test`).
- **Språk:** kod, kommentarer och commit-meddelanden på engelska; allt i gränssnittet och i dokumentationen på svenska.
- **Commit** när det efterfrågas. Kedjan, och commit bara om allt går igenom (`npm run check` kör typkontrollen, personuppgiftskontrollen på det som är stagat och hela testsviten, och säger en rad när allt är grönt):

  ```bash
  git add -A && npm run check && git commit -m "…"
  ```

- **Skriv inte om historiken** (ingen `--amend`, `rebase` eller `reset` av delade commits). Gör en ny commit.

## Personuppgifter

Det här är ett öppet repo. Aldrig i git: riktiga namn, personnummer, kontonummer, e-post, telefonnummer, adresser, riktiga fakturor, kvitton, kontoutdrag, lönespecar eller deklarationer, och inga riktiga belopp ur någons ekonomi.

- **Tester och demodata är påhittade.** Telefonnummer är `+46XX5550NNN` eller `+46701234567`, namn är påhittade ("Kim", "Mio"), handlare är vanliga kedjor eller `EXEMPEL…`. Bankfilerna i `server/test/fixtures/bank/` görs av `server/test/fixtures/generate-bank-fixtures.ts`.
- **Egna filer** att prova med läggs i `samples/` (finns inte i git). Tester som läser dem hoppar över när de saknas (`hasPrivateSample` i `server/test/helpers.ts`).
- `npm run check:personuppgifter` (se kedjan ovan) letar efter mobilnummer och förbjudna filer, och efter dina egna mönster i `samples/privat/kontrollmonster.txt` (en rad per mönster; filen är aldrig i git).
- Skriv aldrig ut värden ur `.env` eller en privat nyckel under `secrets/`.

## Den riktiga datan

- **Tester muterar aldrig en riktig databas.** Servertesterna använder `freshDb()` i minnet.
- **Rör inte `data/finance.db`** under utveckling. Använd testinstansen (`PRIVATEKONOMI_INSTANCE=test`, egen databas under `data/test/` eller `data/demo/`; den vägrar starta mot `data/finance.db`) eller demodatan.
- **Aldrig utan att fråga:** skicka notiser (ntfy), köra en banksynk, eller logga in någonstans.

## Utveckling

- **Stoppa servrar per PID eller port**, aldrig med `pkill -f` på vite- eller tsx-kommandot: samma kommandorader kör andra instanser.
- **Migreringar:** ändra `server/src/db/schema.ts`, kör `npm run db:generate -- --name <namn>` och skriv klart hela SQL-filen innan någon annan server-`.ts` sparas – en körande dev-server startar om vid varje sparning och kör väntande migreringar direkt. Datamigreringar (`server/src/db/dataMigrations.ts`) körs bara på befintliga databaser; en ny databas får det aktuella läget av seeden.
- **Konventioner:** belopp i öre (heltal, negativt = ut), datum som `YYYY-MM-DD`, "i dag" i lokal tid (`todayLocal`, `web/src/lib/today.ts`), aldrig `toISOString()` för ett datum. Skriv som koden runt omkring: samma kommentarstäthet, namn och idiom.
- **Formatering:** projektet har ingen prettier-konfiguration. Formatera bara när det behövs, och då med `npx prettier --print-width 180 --write <fil>`.
- **Design v2:** färger och radier som tokens i `web/src/styles/tokens.css` (`bg-card`, `ink`/`ink-2`/`ink-3`, `accent`, `positive`, `caution`, `alarm`, `rounded-card`, `shadow-card` …), en sektion per vy i UI-SPEC.md.
- **Sparade svar:** GET-anrop under `CACHED_PATHS` i `server/src/responseCache.ts` sparas tills databasen skrivs till, dagen byter eller nattkopians läge ändras, och räknas om i bakgrunden när servern är ledig. Ett nytt anrop där hör bara hemma om svaret räknas fram ur databasen och datumet enbart; följer något annat klockan måste det in i nyckeln (`keyOf`).
- **Moduler:** Lön och Pendling & bränsle är valfria och avstängda i en ny databas (`server/src/settings.ts`, `web/src/lib/modules.ts`). En ny vy som bara passar vissa hushåll görs på samma sätt.
- **UI-tester:** Recharts behöver en fast storlek i jsdom (`vi.mock("recharts", …)` med en `ResponsiveContainer` som ger barnen bredd och höjd), och `matchMedia` med `prefers-reduced-motion` gör att staplar och etiketter ritas direkt. API:t mockas med `mockApi`/`callsTo` från `web/test/api.ts`.
