#!/usr/bin/env bash
# Personuppgiftskontrollen före varje commit: inga personuppgifter på en
# tillagd rad i det som ska committas.
#
#   git add -A && npm run check:personuppgifter
#
# Allmänna regler, här i skriptet:
#   - ett svenskt mobilnummer (+46 följt av minst åtta siffror), utom de påhittade
#     numren i testerna (+46XX5550NNN) och exempelnumret +46701234567;
#   - filer under data/, exports/ eller secrets/, .env-filer och .pem-nycklar;
#   - något under samples/privat/.
# De personliga mönstren (namn, personnummer, kontonummer, e-post) är själva
# uppgifterna och kan inte stå här: de läses ur samples/privat/kontrollmonster.txt,
# som aldrig är i git (en rad per mönster, utökade reguljära uttryck). Saknas filen
# kontrolleras bara de allmänna reglerna, och skriptet säger det. Den som utvecklar
# med sina egna uppgifter i närheten bör skapa filen.
#
# Avslutar med 0 när inget hittas, annars 1 och raderna i diffen.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERNS="samples/privat/kontrollmonster.txt"
private=""
if [ -s "$PATTERNS" ]; then
  private="$(grep -vE '^\s*(#|$)' "$PATTERNS" | paste -sd'|' -)"
else
  echo "personuppgifter: $PATTERNS saknas: bara de allmänna reglerna kontrolleras (mobilnummer, data/, .env, nycklar)." >&2
fi
# A pattern that matches nothing at all when there are no personal patterns.
[ -n "$private" ] || private='\b\B'


# Made-up numbers are fine: take them off the line before looking for +46.
FAKE='\+46[0-9]{2}5550[0-9]{3}|\+46701234567'

diff="$(git diff --cached --no-color)"
hits="$(printf '%s\n' "$diff" | grep -nE '^\+' | grep -vE '^[0-9]+:\+\+\+ ' | sed -E "s/$FAKE//g" | grep -E "\+46[ 0-9-]{8,}|$private" || true)"
paths="$(printf '%s\n' "$diff" | grep -nE '^\+\+\+ b/((data|exports|secrets)/|samples/privat/|.*(\.env(\..*)?|\.pem)$)' | grep -vE '\.env\.example$' || true)"

if [ -z "$hits" ] && [ -z "$paths" ]; then
  echo "personuppgifter: inget hittat i $(git diff --cached --name-only | wc -l | tr -d ' ') filer."
  exit 0
fi
echo "personuppgifter: HITTADE i det som ska committas:" >&2
[ -n "$paths" ] && printf '  fil som inte får committas: %s\n' "$paths" >&2
[ -n "$hits" ] && printf '%s\n' "$hits" | sed 's/^/  diffrad /' >&2
exit 1
