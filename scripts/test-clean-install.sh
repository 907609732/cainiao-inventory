#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEMP_HOME="$(mktemp -d "${TMPDIR:-/tmp}/cainiao-codex-home.XXXXXX")"
trap 'rm -rf "$TEMP_HOME"' EXIT
mkdir -p "$TEMP_HOME/.codex"
HOME="$TEMP_HOME" CODEX_HOME="$TEMP_HOME/.codex" codex plugin marketplace add "$ROOT" --json >/dev/null
HOME="$TEMP_HOME" CODEX_HOME="$TEMP_HOME/.codex" codex plugin add cainiao-inventory-codex@cainiao-tools --json >/dev/null
HOME="$TEMP_HOME" CODEX_HOME="$TEMP_HOME/.codex" codex plugin list --json | rg -q 'cainiao-inventory-codex'
echo "Clean Codex plugin install passed."
