#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
npm run validate
rm -rf release
mkdir -p release
npm pack ./packages/core --pack-destination release >/dev/null
/usr/bin/ditto -c -k --sequesterRsrc --keepParent plugins/cainiao-inventory-codex release/cainiao-inventory-codex-v1.0.0.zip
(cd release && /usr/bin/shasum -a 256 *.tgz *.zip > SHA256SUMS)
echo "Release artifacts created in $ROOT/release"
