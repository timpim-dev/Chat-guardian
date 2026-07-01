#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p logs

if [ -f chat-guardian.pid ]; then
    PID=$(cat chat-guardian.pid)
    if kill -0 "$PID" 2>/dev/null; then
        echo "Chat Guardian is already running (PID $PID)"
        exit 1
    fi
    rm chat-guardian.pid
fi

nohup node server/index.js > logs/out.log 2>&1 &
echo $! > chat-guardian.pid
disown

echo "Chat Guardian started (PID $(cat chat-guardian.pid))"
echo "Logs: tail -f logs/out.log"
