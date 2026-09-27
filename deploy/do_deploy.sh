#!/bin/bash
# do_deploy.sh — runs fully in background, survives SSH drops
LOG=/tmp/deploy.log
exec > "$LOG" 2>&1

set -e
echo "=== DEPLOY START $(date) ==="

echo "=== CLEANUP OLD ==="
pkill -f 'pondsite_keeper' 2>/dev/null || true
pkill -f 'node server.mjs' 2>/dev/null || true
pkill -f 'npm ci' 2>/dev/null || true
pkill -f 'socat' 2>/dev/null || true
crontab -l 2>/dev/null | grep -v pondsite_keeper | crontab - 2>/dev/null || true
rm -rf /home/student/pond-planner-pro

echo "=== EXTRACTING ==="
cd /home/student
tar -xzf pondsite_upload.tar.gz
echo "dist contents:"
ls pond-planner-pro/dist/

echo "=== MKDIR DATA ==="
mkdir -p /home/student/pond-planner-pro/data

echo "=== CHECK GO ==="
go version

echo "=== BUILD GO LB ==="
cd /home/student/pond-planner-pro/deploy/lb
go build -o pondlb main.go && echo "LB_BUILT"
cp pondlb ../../

echo "=== PM2 SETUP ==="
cd /home/student/pond-planner-pro
which pm2 || npm install -g pm2
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

echo "=== VERIFY ==="
sleep 4
pm2 list
curl -s http://localhost:3000/api/health && echo "" || echo "HEALTH_CHECK_PENDING"

echo "=== DONE $(date) ==="
