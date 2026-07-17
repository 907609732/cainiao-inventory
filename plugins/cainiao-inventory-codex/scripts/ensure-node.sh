#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${CAINIAO_APP_ROOT:-$HOME/Library/Application Support/Cainiao Inventory Codex}"
RUNTIME_DIR="$APP_ROOT/runtime"
NODE_VERSION="22.23.1"

valid_node() {
  [[ -x "$1" ]] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1
}

candidates=()
if command -v node >/dev/null 2>&1; then candidates+=("$(command -v node)"); fi
candidates+=("$HOME/.local/node/bin/node" "/opt/homebrew/bin/node" "/usr/local/bin/node")
for candidate in "${candidates[@]}"; do
  if valid_node "$candidate"; then
    "$candidate" -e 'process.stdout.write(process.execPath)'
    exit 0
  fi
done

[[ "$(uname -s)" == "Darwin" ]] || { echo "自动隔离运行时目前只支持 macOS。" >&2; exit 1; }
case "$(uname -m)" in
  arm64) arch="arm64"; checksum="ef28d8fab2c0e4314522d4bb1b7173270aa3937e93b92cb7de79c112ac1fa953" ;;
  x86_64) arch="x64"; checksum="b8da981b8a0b1241b70249204916da76c63573ddf5814dbd2d1e41069105cb81" ;;
  *) echo "不支持的 Mac 架构：$(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$RUNTIME_DIR"
chmod 700 "$APP_ROOT" "$RUNTIME_DIR"
archive="node-v${NODE_VERSION}-darwin-${arch}.tar.gz"
install_dir="$RUNTIME_DIR/node-v${NODE_VERSION}-darwin-${arch}"
node_path="$install_dir/bin/node"
if valid_node "$node_path"; then printf '%s' "$node_path"; exit 0; fi

temp="$(mktemp -d "${TMPDIR:-/tmp}/cainiao-node.XXXXXX")"
trap 'rm -rf "$temp"' EXIT
echo "正在下载隔离 Node.js v${NODE_VERSION}..." >&2
/usr/bin/curl -fL --retry 3 --connect-timeout 20 "https://nodejs.org/download/release/v${NODE_VERSION}/${archive}" -o "$temp/$archive"
actual="$(/usr/bin/shasum -a 256 "$temp/$archive" | /usr/bin/awk '{print $1}')"
[[ "$actual" == "$checksum" ]] || { echo "Node.js 下载校验失败。" >&2; exit 1; }
/usr/bin/tar -xzf "$temp/$archive" -C "$RUNTIME_DIR"
valid_node "$node_path" || { echo "隔离 Node.js 安装失败。" >&2; exit 1; }
printf '%s' "$node_path"
