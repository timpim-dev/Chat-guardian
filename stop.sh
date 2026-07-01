#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f chat-guardian.pid ]; then
    echo "No PID file found. Chat Guardian may not be running."
    exit 1
fi

PID=$(cat chat-guardian.pid)
if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Chat Guardian stopped (PID $PID)"
else
    echo "Process $PID is not running. Cleaning up PID file."
fi

rm -f chat-guardian.pid
