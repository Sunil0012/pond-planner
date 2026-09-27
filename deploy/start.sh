#!/bin/sh
# PondSite production start script
# Runs the TypeScript server directly via tsx — no separate build step needed.
# Serves the pre-built SPA from ./dist on the same port.
cd "$(dirname "$0")/.."
PORT=${PORT:-3205} NODE_ENV=production nohup npx tsx backend/server.ts > "$HOME/pondsite.log" 2>&1 &
echo "PondSite started on port ${PORT:-3205}, pid $!"
echo "Logs: $HOME/pondsite.log"
