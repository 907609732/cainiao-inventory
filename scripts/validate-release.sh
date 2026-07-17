#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
node scripts/validate-manifests.mjs
for script in plugins/cainiao-inventory-codex/scripts/*.sh scripts/*.sh; do /bin/bash -n "$script"; done
if rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' --glob '!release/**' --glob '!scripts/validate-release.sh' '(chenyuecai|aliyun-erp|lttlt\.top|/www/wwwroot|cyc1314520)' .; then
  echo "发现个人环境或旧服务器内容，拒绝发布。" >&2
  exit 1
fi
if rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' --glob '!release/**' --glob '!scripts/validate-release.sh' '(access_token=[A-Za-z0-9_-]{20,}|DINGTALK_SECRET=[^[:space:]]{8,}|CAINIAO_PASSWORD=[^[:space:]]{4,})' .; then
  echo "发现疑似敏感值，拒绝发布。" >&2
  exit 1
fi
echo "Release safety validation passed."
