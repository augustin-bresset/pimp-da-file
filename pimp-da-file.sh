#!/usr/bin/env bash
# Lance pimp-da-file en local : construit l'app si besoin, sert dist/, ouvre le navigateur.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-4610}"

if [ ! -d dist ]; then
  command -v npm >/dev/null || { echo "npm est requis pour le premier build."; exit 1; }
  npm install --no-audit --no-fund
  npm run build
fi

if ! curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  nohup python3 -m http.server "$PORT" --directory dist >/dev/null 2>&1 &
  sleep 0.5
fi

URL="http://localhost:$PORT"
echo "pimp-da-file → $URL"
xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 || true
