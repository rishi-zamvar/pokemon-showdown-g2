#!/usr/bin/env bash
#
# start-glasses.sh — Serve the app on the local network and generate a QR code
#                     for Even Realities G2 glasses.
#
# Starts a Vite dev server directly from pokemon-showdown (not through even-dev)
# exposed on all network interfaces, then generates an Even Hub QR code.
# Scan the QR from the Even Hub phone app to load the app on your glasses.
#
# This matches the pattern used by working Even apps (epub-reader-g2, EvenChess):
#   vite --host 0.0.0.0 --strictPort & evenhub qr --port 5173 --path / -e
#
# Usage:
#   ./scripts/start-glasses.sh
#   PORT=3000 ./scripts/start-glasses.sh    # override port
#
# Prerequisites:
#   - npm install completed in pokemon-showdown
#   - Phone and computer must be on the same WiFi network
#   - evenhub-cli login completed (run: npx @evenrealities/evenhub-cli login)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORT="${PORT:-5173}"

cd "${PROJECT_DIR}"

# ── Dependency checks ────────────────────────────────────────────────────

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# ── Detect WiFi IP ───────────────────────────────────────────────────────

get_wifi_ip() {
  local ip
  # macOS: en0 is typically WiFi
  ip="$(ipconfig getifaddr en0 2>/dev/null)" || true
  if [ -z "${ip}" ]; then
    # Fallback: first non-loopback IPv4
    ip="$(ifconfig | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}')"
  fi
  echo "${ip}"
}

WIFI_IP="$(get_wifi_ip)"
if [ -z "${WIFI_IP}" ]; then
  echo "ERROR: Could not detect WiFi IP address." >&2
  echo "Make sure you are connected to WiFi." >&2
  exit 1
fi

APP_URL="http://${WIFI_IP}:${PORT}/"

echo "╔══════════════════════════════════════════════════╗"
echo "║  Pokemon Showdown — G2 Glasses Dev Server       ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Local:   http://localhost:${PORT}/"
echo "║  Network: ${APP_URL}"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Kill any existing process on the port ────────────────────────────────

if lsof -ti:"${PORT}" >/dev/null 2>&1; then
  echo "Port ${PORT} in use — killing existing process..."
  lsof -ti:"${PORT}" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# ── Start Vite directly from project directory ───────────────────────────
# Matches epub-reader-g2 pattern: vite --host 0.0.0.0 --strictPort

npx vite --host 0.0.0.0 --port "${PORT}" --strictPort &
VITE_PID=$!

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "${VITE_PID}" 2>/dev/null || true
  wait "${VITE_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── Wait for server ──────────────────────────────────────────────────────

echo "Waiting for Vite..."
for _ in $(seq 1 30); do
  if curl --output /dev/null --silent --head --fail "http://localhost:${PORT}/"; then
    break
  fi
  sleep 1
done

if ! curl --output /dev/null --silent --head --fail "http://localhost:${PORT}/"; then
  echo "ERROR: Vite did not start within 30 seconds." >&2
  exit 1
fi

echo "Vite is ready."
echo ""

# ── Generate QR code ────────────────────────────────────────────────────
# Matches epub-reader-g2 pattern: evenhub qr --port 5173 --path / -e

echo "Generating Even Hub QR code..."
npx @evenrealities/evenhub-cli qr --port "${PORT}" --path / --http -e || {
  echo ""
  echo "QR fallback — use this URL on your phone: ${APP_URL}"
  npx @evenrealities/evenhub-cli qr --url "${APP_URL}" --http || true
}

echo ""
echo "Scan the QR code with the Even Hub app on your phone."
echo "Press Ctrl+C to stop the server."
echo ""

# ── Keep server alive ───────────────────────────────────────────────────

wait "${VITE_PID}"
