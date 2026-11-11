#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "[1/4] Installing dependencies..."
npm install --no-audit --no-fund

echo "[2/4] Building dist/safebox.js..."
npm run build

echo "[3/4] Running tests..."
npm run test:run

echo "[4/4] Cleaning up node_modules..."
rm -rf node_modules package-lock.json dist-test

echo ""
echo "Done! dist/ is self-contained:"
echo "  dist/safebox.js - bundled CLI, run with: node dist/safebox.js --help"
printf '\a' 2>/dev/null || true
