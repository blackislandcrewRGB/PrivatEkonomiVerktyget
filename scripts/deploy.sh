#!/usr/bin/env bash
# Deploy till din egen server med ett kommando (se docs/DRIFT.md):
#
#   npm run deploy            # kontrollera, pusha, bygg på servern, vänta på hälsan
#   npm run deploy:rollback   # tillbaka till imagen före senaste deploy
#   DRY_RUN=1 npm run deploy  # visa stegen mot servern utan att köra dem
#
# Servern ska ha en utcheckning av det här repot (git-remoten nedan pekar dit),
# Docker och Docker Compose. Inställningarna ligger i deploy.local.env (inte i
# git), eller som miljövariabler:
#
#   DEPLOY_HOST    ssh-värd för servern (krävs)
#   DEPLOY_URL     appens adress, där /api/health svarar (krävs)
#   DEPLOY_REMOTE  git-remote som pekar på servern, standard samma som DEPLOY_HOST
#   DEPLOY_DIR     utcheckningen på servern, standard privatekonomi (~/privatekonomi)
#   DEPLOY_WAIT    sekunder att vänta på hälsan, standard 180
#   DRY_RUN=1      skriv ut kommandona mot servern i stället för att köra dem
#
# 1. Vägrar om arbetskatalogen har ändringar som inte är committade, eller om
#    grenen inte är main.
# 2. Kör typecheck och testerna.
# 3. Pushar main till git-remoten på servern.
# 4. På servern: hämtar koden, taggar den körande imagen som
#    privatekonomi:previous och bygger och startar den nya. Migreringar tar
#    sin egen säkerhetskopia när appen startar (fore-migrering).
# 5. Väntar tills $DEPLOY_URL/api/health svarar med den här commiten.
#    Blir den inte grön inom DEPLOY_WAIT sekunder: de sista raderna ur
#    docker logs, och avslut med fel. Aldrig "klar" utan grön hälsa.
#
# Återgång: `npm run deploy:rollback` startar privatekonomi:previous igen och
# väntar på hälsan. Koden på servern står kvar på den nya commiten tills nästa
# deploy. Har den nya versionen migrerat databasen kan den gamla koden sakna
# stöd för det nya schemat: återställ då också kopian före migreringen (se
# docs/DRIFT.md, Återställa).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Your own server's settings, outside git.
[ -f deploy.local.env ] && . ./deploy.local.env
HOST="${DEPLOY_HOST:-}"
URL="${DEPLOY_URL:-}"
REMOTE="${DEPLOY_REMOTE:-$HOST}"
DIR="${DEPLOY_DIR:-privatekonomi}"
WAIT="${DEPLOY_WAIT:-180}"
DRY="${DRY_RUN:-}"
MODE="${1:-deploy}"

say() { echo "deploy: $*"; }
fail() { echo "deploy: MISSLYCKADES – $*" >&2; exit 1; }

[ -n "$HOST" ] || fail "DEPLOY_HOST saknas. Lägg den i deploy.local.env (se docs/DRIFT.md)."
[ -n "$URL" ] || fail "DEPLOY_URL saknas. Lägg den i deploy.local.env (se docs/DRIFT.md)."

# A command on the server, or only shown in a dry run.
remote() {
  if [ -n "$DRY" ]; then
    echo "  [torrt] ssh $HOST '$1'"
  else
    ssh "$HOST" "$1"
  fi
}

# Waits until /api/health answers ok with this commit (any commit when empty).
wait_healthy() {
  local want="$1" deadline=$((SECONDS + WAIT)) body
  say "väntar på $URL/api/health${want:+ med commit ${want:0:7}} (högst $WAIT s)…"
  while [ $SECONDS -lt $deadline ]; do
    if body="$(curl -fsS --max-time 5 "$URL/api/health" 2>/dev/null)" && echo "$body" | grep -q '"ok":true'; then
      if [ -z "$want" ] || echo "$body" | grep -q "\"commit\":\"$want\""; then
        return 0
      fi
    fi
    sleep 3
  done
  return 1
}

show_logs() {
  echo "--- de sista raderna ur docker logs:" >&2
  remote "docker logs --tail 40 privatekonomi 2>&1" >&2 || echo "(docker logs gick inte att läsa)" >&2
}

if [ "$MODE" = "--rollback" ]; then
  say "återgång till privatekonomi:previous på $HOST"
  remote "docker image inspect privatekonomi:previous >/dev/null 2>&1 || { echo 'Ingen privatekonomi:previous att gå tillbaka till.' >&2; exit 1; }
    cd $DIR && docker tag privatekonomi:previous privatekonomi:local && docker compose up -d --no-build --force-recreate"
  [ -n "$DRY" ] && [ -z "${DEPLOY_URL:-}" ] && { say "torr körning: inget kördes mot $HOST."; exit 0; }
  if wait_healthy ""; then
    say "återgången är klar: $URL svarar."
    exit 0
  fi
  show_logs
  fail "hälsan blev inte grön inom $WAIT s efter återgången."
fi

# 1. Only what is committed, from main.
[ -z "$(git status --porcelain)" ] || fail "det finns ändringar som inte är committade. Committa eller lägg undan dem först."
branch="$(git branch --show-current)"
[ "$branch" = "main" ] || fail "grenen är $branch, inte main."
commit="$(git rev-parse HEAD)"
say "commit ${commit:0:7}: $(git log -1 --format=%s)"

# 2. Types and tests.
say "typecheck…"
npm run --silent typecheck || fail "typkontrollen."
say "tester…"
npm test --silent || fail "testerna."

# 3. Push.
if [ -n "$DRY" ]; then
  echo "  [torrt] git push $REMOTE HEAD:main"
else
  git push "$REMOTE" HEAD:main || fail "git push till $REMOTE."
fi

# 4. Build and start on the server, keeping the running image as :previous.
say "bygger och startar på $HOST…"
remote "set -e; cd $DIR && git pull --ff-only
  if docker image inspect privatekonomi:local >/dev/null 2>&1; then docker tag privatekonomi:local privatekonomi:previous; fi
  GIT_COMMIT=$commit docker compose up -d --build" || { show_logs; fail "bygget eller starten på $HOST."; }

# 5. Green with this commit, or it didn't work.
if [ -n "$DRY" ] && [ -z "${DEPLOY_URL:-}" ]; then
  say "torr körning: inget pushades eller byggdes. Ange DEPLOY_URL för att också prova väntan på hälsan."
  exit 0
fi
if wait_healthy "$commit"; then
  say "klar: ${commit:0:7} svarar på $URL."
  exit 0
fi
show_logs
fail "$URL/api/health blev inte grön med ${commit:0:7} inom $WAIT s. Den gamla imagen finns som privatekonomi:previous: npm run deploy:rollback"
