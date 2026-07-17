#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
export CAINIAO_PLUGIN_ROOT="$PLUGIN_ROOT"
export CAINIAO_APP_ROOT="${CAINIAO_APP_ROOT:-$HOME/Library/Application Support/Cainiao Inventory Codex}"
NODE_PATH_BIN="$(/bin/bash "$PLUGIN_ROOT/scripts/ensure-node.sh")"
exec "$NODE_PATH_BIN" "$PLUGIN_ROOT/runtime/mcp-server.cjs"
