#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PLUGIN_ROOT="$ROOT/plugins/cainiao-inventory-codex"
OWN_TEMP=0
if [[ -z "${CAINIAO_TEST_APP_ROOT:-}" ]]; then
  CAINIAO_TEST_APP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cainiao-runtime-test.XXXXXX")"
  OWN_TEMP=1
fi
cleanup() { if [[ "$OWN_TEMP" == "1" ]]; then rm -rf "$CAINIAO_TEST_APP_ROOT"; fi; }
trap cleanup EXIT

CAINIAO_APP_ROOT="$CAINIAO_TEST_APP_ROOT" CAINIAO_PLUGIN_ROOT="$PLUGIN_ROOT" /bin/bash "$PLUGIN_ROOT/scripts/install-runtime.sh"
PLAYWRIGHT_BROWSERS_PATH="$CAINIAO_TEST_APP_ROOT/browsers" CAINIAO_RUN_BROWSER_FIXTURES=1 \
  "$ROOT/node_modules/.bin/tsx" --test "$ROOT/packages/core/test/browser-fixtures.test.ts"
CAINIAO_APP_ROOT="$CAINIAO_TEST_APP_ROOT" \
  "$(CAINIAO_APP_ROOT="$CAINIAO_TEST_APP_ROOT" /bin/bash "$PLUGIN_ROOT/scripts/ensure-node.sh")" \
  "$CAINIAO_TEST_APP_ROOT/runtime/cli.cjs" doctor >/dev/null
echo "Isolated Node, Playwright, Chromium, CLI, and page fixture validation passed."
