#!/usr/bin/env bash
#
# start-sim.sh — Launch the Even Hub Simulator for local development.
#
# Starts the pokemon-showdown app through even-dev's unified Vite server
# with the Even Hub Simulator attached. Use this for desktop testing
# without glasses.
#
# Usage:
#   ./scripts/start-sim.sh
#
# Prerequisites:
#   - even-dev must be at ../even-dev (sibling directory)
#   - even-dev/apps.json must reference pokemon-showdown
#   - evenhub-simulator must be installed (npm i in even-dev)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
EVEN_DEV_DIR="$(cd "${PROJECT_DIR}/../even-dev" && pwd 2>/dev/null)" || {
  echo "ERROR: even-dev not found at ${PROJECT_DIR}/../even-dev" >&2
  echo "Clone it as a sibling directory to pokemon-showdown." >&2
  exit 1
}

# Verify even-dev has node_modules
if [ ! -d "${EVEN_DEV_DIR}/node_modules" ]; then
  echo "Installing even-dev dependencies..."
  npm --prefix "${EVEN_DEV_DIR}" install
fi

# Verify pokemon-showdown is registered in apps.json
if ! grep -q '"pokemon-showdown"' "${EVEN_DEV_DIR}/apps.json" 2>/dev/null; then
  echo "ERROR: pokemon-showdown not registered in ${EVEN_DEV_DIR}/apps.json" >&2
  exit 1
fi

# Verify pokemon-showdown has node_modules
if [ ! -d "${PROJECT_DIR}/node_modules" ]; then
  echo "Installing pokemon-showdown dependencies..."
  npm --prefix "${PROJECT_DIR}" install
fi

echo "Starting Even Hub Simulator for pokemon-showdown..."
echo "  Project:  ${PROJECT_DIR}"
echo "  Even-dev: ${EVEN_DEV_DIR}"
echo ""

cd "${EVEN_DEV_DIR}"
exec ./start-even.sh pokemon-showdown
