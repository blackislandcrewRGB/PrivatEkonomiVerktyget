# Säkerhet

Verktyget har ingen inloggning och är byggt för att köras på din egen dator eller bakom en VPN. Det får aldrig nås från internet (se [Drift](docs/DRIFT.md)). Det är den viktigaste säkerhetsregeln, och inget i verktyget ersätter den.

## Rapportera en sårbarhet

Hittar du något som låter någon utanför din egen dator läsa eller ändra data, eller som läcker personuppgifter, rapportera det **privat** (GitHub: fliken *Security* › *Report a vulnerability*) och inte som ett öppet ärende. Skriv med hur det kan upprepas, och med påhittade uppgifter, aldrig riktiga.

## Vad som redan skyddar

- Servern lyssnar på `127.0.0.1` om inget annat sägs, och containerns port publiceras bara där.
- Varje anrop måste vara adresserat till ett av verktygets egna namn (`localhost`, `PUBLIC_BASE_URL`, `ALLOWED_HOSTS`), och ett skrivande anrop från en webbsida måste ha en Origin med ett sådant namn. Det är ett skydd mot att en annan webbplats i din webbläsare når verktyget (DNS-rebinding och förfalskade formulär); det är inget skydd mot någon som kan nå porten.
- Fullständiga konto- och kortnummer sparas aldrig, bara maskerade (`••1234`).
- Hemligheter (Enable Banking-nyckeln, ntfy-topic, Kuma-adressen) ligger i `.env` och `secrets/`, som inte är i git.
