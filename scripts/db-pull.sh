#!/usr/bin/env bash
# Hämtar senaste nattkopian från din server till testinstansen, för att prova
# mot riktig data (bara om du kör verktyget på en server, se docs/DRIFT.md):
#
#   npm run db:pull                      # till data/test/finance-test.db
#   npm run db:pull -- data/test/x.db    # en annan fil under data/test/
#   npm run dev:test                     # och kör mot den
#
# Skriver bara under data/test/, aldrig till data/finance.db. Vägrar om målet
# är den riktiga databasen eller ligger utanför data/test/, och om
# testinstansen kör (den har filen öppen). Filen byts i ett steg, och en
# gammal -wal/-shm tas bort först: en ny databas med en gammal WAL-fil
# bredvid blir en trasig databas.
#
# Inställningarna ligger i deploy.local.env (inte i git), eller som miljövariabler:
#
#   DB_PULL_HOST   ssh-värd, standard DEPLOY_HOST
#   DB_PULL_DIR    kopiornas katalog på värden (krävs), till exempel /srv/privatekonomi/data/backups
#   DB_PULL_FROM   en lokal katalog att hämta från i stället (för att prova skriptet)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f deploy.local.env ] && . ./deploy.local.env
HOST="${DB_PULL_HOST:-${DEPLOY_HOST:-}}"
DIR="${DB_PULL_DIR:-}"
TARGET="${1:-data/test/finance-test.db}"

fail() { echo "db:pull: $*" >&2; exit 1; }

if [ -z "${DB_PULL_FROM:-}" ]; then
  [ -n "$HOST" ] || fail "DB_PULL_HOST (eller DEPLOY_HOST) saknas. Lägg den i deploy.local.env."
  [ -n "$DIR" ] || fail "DB_PULL_DIR saknas: katalogen med nattkopiorna på servern. Lägg den i deploy.local.env."
fi

# The target, resolved, must be a file under data/test/ and never the real database.
mkdir -p data/test
target_dir="$(cd "$(dirname "$TARGET")" 2>/dev/null && pwd -P)" || fail "Katalogen för $TARGET finns inte."
target="$target_dir/$(basename "$TARGET")"
real="$(cd data && pwd -P)/finance.db"
test_dir="$(cd data/test && pwd -P)"
[ "$target" != "$real" ] || fail "Målet är den riktiga databasen ($real). Avbryter."
case "$target" in
  "$test_dir"/*) ;;
  *) fail "Målet måste ligga under data/test/, inte $TARGET." ;;
esac
case "$target" in
  *.db) ;;
  *) fail "Målet ska vara en .db-fil." ;;
esac

# The test instance holds the file open: replacing it under a running server breaks both.
if curl -fsS --max-time 2 http://127.0.0.1:3101/api/health 2>/dev/null | grep -q '"instance":"test"'; then
  fail "Testinstansen kör. Stoppa den först, så att filen inte byts under den."
fi

tmp="$target.hamtas"
# The check opens the copy, which can leave a -wal/-shm of its own beside it.
clean_tmp() { rm -f "$tmp" "$tmp-wal" "$tmp-shm"; }
clean_tmp
trap clean_tmp EXIT

if [ -n "${DB_PULL_FROM:-}" ]; then
  latest="$(ls -1 "$DB_PULL_FROM"/*-natt.db 2>/dev/null | sort | tail -1 || true)"
  [ -n "$latest" ] || fail "Ingen nattkopia i $DB_PULL_FROM."
  echo "Hämtar $(basename "$latest") från $DB_PULL_FROM"
  cp "$latest" "$tmp"
else
  latest="$(ssh "$HOST" "ls -1 '$DIR'/*-natt.db 2>/dev/null | sort | tail -1" || true)"
  [ -n "$latest" ] || fail "Ingen nattkopia hittades i $HOST:$DIR."
  echo "Hämtar $(basename "$latest") från $HOST"
  scp -q "$HOST:$latest" "$tmp"
fi

# A whole copy, or nothing is replaced.
npx tsx scripts/db-check.ts "$tmp" > /dev/null || fail "Kopian klarade inte integrity_check. Inget byttes ut."

rm -f "$target-wal" "$target-shm" "$tmp-wal" "$tmp-shm"
mv "$tmp" "$target"
trap - EXIT
echo "Klar: ${target#"$ROOT"/}. Kör testinstansen med npm run dev:test."
