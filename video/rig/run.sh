#!/usr/bin/env bash
# Nelio video rig: everything the edit needs, from nothing, in one run (about 10 minutes).
#   bash video/rig/run.sh /path/to/output
# Needs: PostgreSQL 16 server binaries, Node 22, Python 3 with playwright, psycopg, pillow, numpy, scipy,
# Google Chrome at /usr/bin/google-chrome, ffmpeg. Reaches only GitHub (the demo-assets branch) and npm.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/../.." && pwd)"
out="$(mkdir -p "${1:?output folder}" && cd "$1" && pwd)"
export NELIO_REPO="$repo" NELIO_PG_PORT="${NELIO_PG_PORT:-54329}"
work="$here/work"; mkdir -p "$work"
(cd "$here" && npm install --silent) && (cd "$repo/demo/fonts" && npm install --silent)
[ -d "$work/demo-assets" ] || git clone -q --depth 1 -b demo-assets https://github.com/shedmi-cpa/nelio "$work/demo-assets"

# A throwaway PostgreSQL, only on this machine.
bin="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -n 1)"
if ! pg_isready -h localhost -p "$NELIO_PG_PORT" -q; then
  run=(); if [ "$(id -u)" = 0 ]; then mkdir -p "$work/pg"; chown postgres "$work/pg"; run=(runuser -u postgres --); fi
  [ -d "$work/pg/data" ] || "${run[@]}" "$bin/initdb" -D "$work/pg/data" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null
  "${run[@]}" "$bin/pg_ctl" -D "$work/pg/data" -o "-c listen_addresses=localhost -p $NELIO_PG_PORT -c timezone=UTC -k $work/pg" -l "$work/pg/log" -w start
fi
python3 "$here/load.py"

# The real server code, on that database. A fresh storage folder for each run.
store="$work/store-$(date +%s)"
NELIO_STORE="$store" node --experimental-transform-types --no-warnings "$here/server.mjs" > "$work/server.log" 2>&1 &
server=$!; trap 'kill $server 2>/dev/null || true' EXIT; sleep 2

cd "$here"
python3 make_docs.py "$work/docs"
python3 story.py "$out"
python3 cards.py "$out"
python3 pile.py "$out/stock/paper_pile.jpg"
python3 sfx.py "$out/sfx"
mkdir -p "$out/docs" && cp "$work/docs/"* "$out/docs/"
echo "done -> $out"
