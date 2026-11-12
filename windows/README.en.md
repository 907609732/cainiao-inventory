# Cainiao Cloud Warehouse for Windows

[简体中文（默认）](README.md) | **English** · [Home](../README.en.md)

Stable version: **0.10.5**. [Installer and verification files](https://github.com/907609732/cainiao-inventory/releases/tag/v0.10.5). The standalone application does not require ERP. APP, browser and AI access share one backend. Prefer Node.js 24, matching release CI.

Versions 0.9.3 and 0.9.4 were withdrawn because of installation-identity conflicts. If the old workbench was overwritten, restore it before installing a corrected version; do not run the withdrawn uninstallers.

## Develop from source

From the repository root:

```powershell
npm --prefix windows/workbench ci --workspaces=false
node windows/workbench/node_modules/electron/install.js
npm run dev
```

Alternatively, run `npm run dev` inside `windows/workbench`. This opens the independent warehouse app. Its default profile is `%APPDATA%\cainiao-cloud-warehouse`; it does not read the workbench's default ledger-location record. Tests use temporary ledgers.

## Tests and installer

Inside `windows/workbench`:

```powershell
npm test
npm run test:ui
npm run warehouse:build -- --publish never
```

Output: `dist/CainiaoWarehouse-Setup-0.10.5-x64.exe`, with `latest.yml` and the differential-update index. The update repository is `907609732/cainiao-inventory`. Building does not publish automatically. Do not inject personal GitHub credentials. Check the version, file hashes, update source and source commit before publication.

[Windows CI](https://github.com/907609732/cainiao-inventory/actions/runs/43225609395) and [same-run installer acceptance](https://github.com/907609732/cainiao-inventory/actions/runs/43225618054) passed. Checks cover fresh installation, upgrade from 0.9.7, reinstall, separate uninstall identity, synthetic inventory/settings preservation and shared APP/web backend. The old workbench baseline download was unavailable; coexistence was not retested for this release. Real platform collection, delivery and ledger migration are outside this release test. The installer is not Authenticode-signed.

## Source and data boundaries

The application has four views: overview, inventory, sales trends and settings. Windows source is under `windows/workbench`; fnOS packaging is under `deploy/fnos`. Standalone data is separate from ERP. Only explicitly hosted components use a host-supplied location. Do not use the source checkout as a production ledger directory; stop the relevant service and back up before data maintenance.

Use `npm run web` from the root to open the Windows browser entry. For isolated development, supply a separate profile, for example:

```powershell
npm --prefix windows/workbench run web -- --user-data-dir=C:\Temp\CainiaoWebDemo
```

See the [local web/API reference (Chinese)](../docs/local-web.md).

## Optional ERP extension integration

These retained adapters are for existing ERP build tooling; independent installation and development do not require them. Signed extensions require external Ed25519 keys and a compatible host. Never commit signing keys.

```powershell
node scripts/build-windows.mjs
node scripts/build-windows.mjs --from-receipt
```

The repositories are expected side by side; use `--erp=<absolute-ERP-path>` for another location. `workbench/scripts/workbench-build.mjs` and `legacy-suite-build.mjs` remain referenced integration adapters.

Extension artifacts are written to `release/windows/<tag>/`. Tags use `warehouse-<host-version>-<manifest-digest>`, separate from standalone `v0.10.5` releases. Confirm host scope and manifest digest from the actual build receipt. A successful extension build does not prove installation or business-data migration.

## Public UI demo

[UI examples](../docs/ui-guide.en.md) use an isolated synthetic ledger. Run `npm run docs:screenshots` from the root to regenerate them. Do not change the script to read production databases or account profiles.
