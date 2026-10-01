# Drift

Hur du kör Privatekonomi, håller det uppdaterat, når det från andra enheter och tar vara på datan. Allt här är valfritt: `npm start` på din egen dator räcker.

## Köra på den egna datorn

```bash
npm ci
npm start        # bygger webbappen och startar den på http://127.0.0.1:3001
```

Databasen skapas i `data/finance.db`. Verktyget lyssnar bara på `127.0.0.1`, så ingenting utanför datorn når det. Stoppa det med Ctrl+C.

För utveckling finns `npm run dev:test` (egen databas, portarna 3101 och 5174) och `npm run demo` (påhittad data). Båda vägrar röra `data/finance.db`.

## Docker

```bash
docker compose up -d --build         # http://127.0.0.1:3001
```

`compose.yml` publicerar porten bara på värdens `127.0.0.1` och lägger data i `./data` (ändra med `DATA_DIR` och `SECRETS_DIR` i miljön). Hemligheter läses ur `.env` (kopiera `.env.example`). Containern kör som användaren `node` (UID 1000), så katalogen för data måste vara skrivbar för den.

Egna inställningar för en server, som en annan datakatalog eller ett nät, läggs i `compose.override.yml`, som Docker Compose läser av sig själv och som inte ligger i git.

## Nå verktyget från mobilen

Det finns **ingen inloggning**, så verktyget får aldrig nås från internet. Vill du använda det från andra enheter, lägg det bakom en VPN, till exempel [Tailscale](https://tailscale.com) eller WireGuard, så att bara dina egna enheter når det.

Med Tailscale kan du till exempel låta `tailscale serve` peka en HTTPS-adress i ditt tailnet mot `127.0.0.1:3001`. Sätt sedan adressen som `PUBLIC_BASE_URL` i `.env`, så att verktyget tar emot anrop till det namnet (annars svarar det 403). `ALLOWED_HOSTS` tar fler namn, kommaseparerade.

Kör du containern på en server utan att publicera porten på värden kan en `compose.override.yml` ersätta portarna och sätta de etiketter eller nät din proxy behöver. Använd `ports: !reset []` i den för att ta bort portpubliceringen (kräver Docker Compose 2.24 eller nyare).

## Data och säkerhetskopior

Databasen är `data/finance.db`, en vanlig SQLite-fil. Belopp lagras i **öre** som heltal (−129,90 kr är `-12990`).

- **Vid varje start** kopieras databasen till `data/backups/finance-<datum och tid>-start.db`, och de 14 senaste sparas. Före varje migrering (när en ny version ändrar databasen) sparas dessutom `…-fore-migrering.db`, som aldrig rensas.
- **Nattkopia:** varje natt kl. 03:45 UTC tas en kopia, `…-natt.db`, och de 7 senaste sparas. Den är gjord för att en säkerhetskopia av disken (Restic, Borg, Time Machine eller något annat) kan ta med den: filen är hel, till skillnad från en databas som används. Misslyckas den, eller har ingen tagits på två dygn, står det i Att göra.
- **Varje kopia är hel.** Den skrivs först som `….db.part`, kontrolleras med `integrity_check` och görs till en enda fil utan `-wal`. Först därefter får den sitt namn.
- **Egen kopia:** kopiera gärna `data/backups/` till en annan disk då och då. Mappen finns inte i git.
- **Återställa:** stoppa verktyget, kopiera den säkerhetskopia du vill ha till `data/finance.db` och ta bort `finance.db-wal` och `finance.db-shm` om de finns. Starta sedan igen.
- **Börja om från noll:** stoppa verktyget och flytta undan `data/finance.db`. Nästa start skapar en ny databas.
- **Kontrollsiffror** för en databas (rader per tabell, summor, `integrity_check`): `npm run db:check -- data/finance.db`. Samma utdata var du än kör det, så två databaser kan jämföras med `diff`.

## Uppdatera

```bash
git pull
npm ci
npm start               # eller: docker compose up -d --build
```

Nya versioner kan ändra databasen. Det görs vid start, med en kopia (`…-fore-migrering.db`) före.

### Egen server med deploy-skript

`npm run deploy` är till för dig som kör verktyget på en server du når med ssh: det vägrar vid ändringar som inte är committade, kör typkontroll och tester, pushar till servern, bygger och startar där och väntar på `/api/health` med rätt commit. `npm run deploy:rollback` startar den förra imagen igen.

1. Servern behöver Docker och ett tomt git-repo att pusha till:

   ```bash
   # på servern
   git init --bare ~/git/privatekonomi.git
   ```

2. Lägg en git-remote hos dig som pekar dit och gör första pushen. Klona sedan repot på servern, dit bygget och `.env` hör hemma:

   ```bash
   git remote add server <ssh-värd>:git/privatekonomi.git
   git push server HEAD:main
   ssh <ssh-värd> 'git clone ~/git/privatekonomi.git ~/privatekonomi'
   ```

   Lägg `.env` (och eventuell `compose.override.yml`) i klonen på servern. De följer inte med i git.
3. Skapa `deploy.local.env` (inte i git):

   ```bash
   DEPLOY_HOST=min-server
   DEPLOY_URL=https://ekonomi.example.net
   DEPLOY_REMOTE=server
   DEPLOY_DIR=privatekonomi
   ```

4. `npm run deploy`. `DRY_RUN=1 npm run deploy` visar stegen utan att köra dem.

`npm run db:pull` hämtar den senaste nattkopian från servern till `data/test/finance-test.db`, för att prova ändringar mot riktig data med `npm run dev:test`. Den kräver `DB_PULL_DIR` (katalogen med kopiorna på servern) i `deploy.local.env`.

## Enable Banking (valfritt)

[Enable Banking](https://enablebanking.com) är en tjänst som hämtar kontoinformation från banker med ditt godkännande (PSD2). Verktyget kan använda den för Swedbank och Bank Norwegian, så att transaktionerna kommer av sig själva kl. 06, 12 och 18. Det kräver ett eget konto där; villkor och kostnader bestämmer de, så läs dem först.

1. Registrera ett program hos Enable Banking och ladda ner den privata nyckeln. Lägg den i `secrets/` (aldrig i git).
2. Registrera en omdirigerings-adress: `<PUBLIC_BASE_URL>/api/enable-banking/callback`. Den måste kunna nås från din webbläsare, och bankens inloggning (BankID) görs där.
3. Sätt `EB_APP_ID`, `EB_PRIVATE_KEY_PATH`, `EB_REDIRECT_URL` och `PUBLIC_BASE_URL` i `.env` och starta om.
4. Öppna **Inställningar › Konton och bankkopplingar** och koppla banken. Första hämtningen för varje konto förhandsgranskas innan den görs.

Samtycket gäller i högst 180 dagar och förnyas i Inställningar. Utgångna samtycken och fel syns i Att göra. Banken hämtas bara från den riktiga instansen, aldrig från testinstansen eller demon.

## Notiser och övervakning (valfritt)

- **ntfy:** med `NTFY_TOPIC` skickas en veckosammanfattning (söndagar 19:00) och varningar (utebliven dragning, ovanligt belopp, samtycke som går ut). Vem som helst som känner till topic-namnet kan läsa meddelandena, så välj något som inte går att gissa. Inget skickas utan `NTFY_TOPIC`.
- **Uptime Kuma:** med `KUMA_PUSH_URL` skickas ett hjärtslag var femte minut: `down` med orsak om databasen inte svarar eller nattkopian saknas, annars `up`. Adressen innehåller Kumas token och är en hemlighet.

## Miljövariabler

| Variabel | Standard | Vad |
|---|---|---|
| `API_PORT` | 3001 | Porten servern lyssnar på |
| `DATABASE_PATH` | `data/finance.db` | Databasfilen |
| `HOST` | `127.0.0.1` | Adressen servern lyssnar på (`0.0.0.0` i containern) |
| `SERVE_WEB` | av (på i containern och med `npm start`) | Servera den byggda webbappen från API-porten |
| `PUBLIC_BASE_URL`, `ALLOWED_HOSTS` | | Namn, utöver localhost, som verktyget tar emot anrop till |
| `EB_APP_ID`, `EB_PRIVATE_KEY_PATH`, `EB_REDIRECT_URL` | | Enable Banking |
| `NTFY_TOPIC` | | ntfy |
| `KUMA_PUSH_URL` | | Uptime Kuma |
| `TZ` | `Europe/Stockholm` | Tidszon för kalender och schemalagda jobb |
