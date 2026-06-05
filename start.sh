#!/bin/sh
set -eu

PORT="${PORT:-10000}"
LANGUAGETOOL_PORT="${LANGUAGETOOL_PORT:-8081}"
LANGUAGETOOL_CONFIG="/tmp/languagetool.properties"

: > "$LANGUAGETOOL_CONFIG"

cd /opt/languagetool

java \
  -Xms128m \
  -Xmx1024m \
  -cp languagetool-server.jar \
  org.languagetool.server.HTTPServer \
  --config "$LANGUAGETOOL_CONFIG" \
  --port "$LANGUAGETOOL_PORT" &

LANGUAGETOOL_PID=$!

cd /app

attempt=1

until curl -fsS \
  -X POST \
  -d "language=en-US" \
  -d "text=health check" \
  "http://127.0.0.1:${LANGUAGETOOL_PORT}/v2/check" \
  >/dev/null
do
  if ! kill -0 "$LANGUAGETOOL_PID" 2>/dev/null; then
    echo "LanguageTool stopped before becoming ready"
    wait "$LANGUAGETOOL_PID" || true
    exit 1
  fi

  if [ "$attempt" -ge 60 ]; then
    echo "LanguageTool did not become ready in time"
    kill "$LANGUAGETOOL_PID" 2>/dev/null || true
    exit 1
  fi

  attempt=$((attempt + 1))
  sleep 2
done

echo "LanguageTool is ready"

exec uvicorn spellcheckAPI:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --proxy-headers \
  --forwarded-allow-ips="*"