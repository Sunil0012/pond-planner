#!/bin/bash
# =============================================================================
# PondSite full deploy script (Go LB edition)
# Run this ONCE on the server after uploading the project folder.
#
# What it does:
#   1. npm install + npm run build  (React SPA)
#   2. Build Go load balancer binary
#   3. Create data/ directory for history DB
#   4. Install PM2 globally
#   5. Start Go LB (port 3000) + 4 Node backends (3001-3004) via PM2
#   6. Configure PM2 autostart on reboot
# =============================================================================
set -e

APP_DIR="/home/student/pond-planner-pro"
LB_DIR="$APP_DIR/deploy/lb"
cd "$APP_DIR"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     PondSite Pro — Deployment Script         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Node.js deps + React build ───────────────────────────────────────────
echo "==> [1/5] Installing Node.js dependencies..."
npm ci --omit=dev --include=dev

echo "==> [2/5] Building React SPA..."
npm run build
echo "    SPA built → dist/"

# ── 2. Go load balancer ──────────────────────────────────────────────────────
echo "==> [3/5] Building Go load balancer..."
if command -v go &>/dev/null; then
    cd "$LB_DIR"
    go build -o pondlb main.go
    chmod +x pondlb
    cd "$APP_DIR"
    echo "    Go binary built → deploy/lb/pondlb"
else
    echo "    WARNING: Go not installed — trying to install..."
    # Try apt (Debian/Ubuntu)
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y golang-go 2>/dev/null || true
    fi
    if command -v go &>/dev/null; then
        cd "$LB_DIR"
        go build -o pondlb main.go
        chmod +x pondlb
        cd "$APP_DIR"
        echo "    Go binary built → deploy/lb/pondlb"
    else
        echo "    ERROR: Go not found and could not be installed."
        echo "    Install Go manually: https://go.dev/dl/"
        echo "    Then re-run this script."
        exit 1
    fi
fi

# ── 3. Data directory for history JSON DB ────────────────────────────────────
echo "==> [4/5] Creating data directory for analysis history..."
mkdir -p "$APP_DIR/data"
echo "    History DB → data/history.json"

# ── 4. PM2 setup ─────────────────────────────────────────────────────────────
echo "==> [5/5] Setting up PM2..."

# Install PM2 if not present
if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
fi

# Stop & delete old processes cleanly
pm2 delete pondlb pondsite-1 pondsite-2 pondsite-3 pondsite-4 2>/dev/null || true

# Start all processes from ecosystem file
pm2 start ecosystem.config.cjs

# Persist process list across reboots
pm2 save

# Enable autostart
STARTUP_CMD=$(pm2 startup 2>&1 | grep "sudo" | head -1)
if [ -n "$STARTUP_CMD" ]; then
    echo "    Enabling PM2 autostart..."
    eval "$STARTUP_CMD" 2>/dev/null || echo "    (run manually: $STARTUP_CMD)"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   PondSite deployed successfully!            ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  App URL    : http://10.1.75.51:3205         ║"
echo "║  LB health  : http://10.1.75.51:3205/lb-health ║"
echo "║  API health : http://10.1.75.51:3205/api/health ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  pm2 status              (process list)      ║"
echo "║  pm2 logs                (live logs)         ║"
echo "║  pm2 logs pondlb         (LB logs only)      ║"
echo "║  pm2 restart all         (restart all)       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

pm2 status
