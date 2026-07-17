#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${CAINIAO_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
APP_ROOT="${CAINIAO_APP_ROOT:-$HOME/Library/Application Support/Cainiao Inventory Codex}"
RUNTIME_DIR="$APP_ROOT/runtime"
BROWSERS_DIR="$APP_ROOT/browsers"
NODE_PATH_BIN="$(CAINIAO_APP_ROOT="$APP_ROOT" /bin/bash "$PLUGIN_ROOT/scripts/ensure-node.sh")"
NPM_PATH="$(dirname "$NODE_PATH_BIN")/npm"

mkdir -p "$RUNTIME_DIR" "$BROWSERS_DIR"
chmod 700 "$APP_ROOT" "$RUNTIME_DIR" "$BROWSERS_DIR"
cp "$PLUGIN_ROOT/runtime/browser-package.json" "$RUNTIME_DIR/package.json"
cp "$PLUGIN_ROOT/runtime/browser-package-lock.json" "$RUNTIME_DIR/package-lock.json"
cp "$PLUGIN_ROOT/runtime/browser-worker.js" "$RUNTIME_DIR/browser-worker.js"
cp "$PLUGIN_ROOT/runtime/cli.cjs" "$RUNTIME_DIR/cli.cjs"

echo "正在安装固定版本的 Playwright 运行库..."
(cd "$RUNTIME_DIR" && "$NPM_PATH" ci --omit=dev --ignore-scripts --registry=https://registry.npmjs.org)
echo "正在安装匹配的 Chromium..."
PLAYWRIGHT_BROWSERS_PATH="$BROWSERS_DIR" "$NODE_PATH_BIN" "$RUNTIME_DIR/node_modules/playwright/cli.js" install --no-shell chromium

NODE_PATH_BIN="$NODE_PATH_BIN" RUNTIME_DIR="$RUNTIME_DIR" BROWSERS_DIR="$BROWSERS_DIR" "$NODE_PATH_BIN" -e '
  const fs = require("fs");
  const path = require("path");
  const value = {
    nodePath: process.env.NODE_PATH_BIN,
    workerPath: path.join(process.env.RUNTIME_DIR, "browser-worker.js"),
    browsersPath: process.env.BROWSERS_DIR,
    cliPath: path.join(process.env.RUNTIME_DIR, "cli.cjs"),
    installedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(process.env.RUNTIME_DIR, "runtime.json"), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
'
echo "隔离运行环境已准备完成。"
