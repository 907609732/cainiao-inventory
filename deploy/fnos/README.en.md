# Cainiao Cloud Warehouse · fnOS

[简体中文（默认）](README.md) | **English** · [Home](../../README.en.md)

Stable version **0.10.17** targets **x86-64 fnOS with Docker enabled**. App ID: `cainiao-warehouse`. The application, collection browser and schedules run on the NAS independently of ERP; the Windows client does not need to stay open.

[Download the FPK, matching image and checksums](https://github.com/907609732/cainiao-inventory/releases/tag/v0.10.17)

## Install or update

1. Download `cainiao-warehouse-0.10.17-x86.fpk`, `cainiao-warehouse-0.10.17-image.tar.gz` and `SHA256SUMS.txt`. Verify SHA-256 and keep the installer/image versions matched.
2. Import the image in fnOS Docker. CLI: `docker load --input cainiao-warehouse-0.10.17-image.tar.gz`. If the GUI only accepts `.tar`, decompress the archive to `.tar` first.
3. Check that web port `18761` and host-loopback API port `18762` are available. Investigate conflicts without stopping unrelated services.
4. Manually install the FPK in App Center. For an existing installation, update it while preserving its application data directory. Take a complete offline backup before upgrading.
5. Confirm the access address in the wizard. Additional domains must be complete `https://` or `http://` origins without paths, separated by commas. Leaving this field blank during an upgrade preserves existing aliases.
6. Open the fnOS desktop icon to use the embedded window, or visit `http://<NAS-address>:18761/`. Configure the Cainiao account, notification targets and browser login before enabling schedules.

All signed-in fnOS users can access the shared warehouse. No separate warehouse administrator password is required. Exact Host/Origin checks, browser sessions and CSRF checks remain in place. Use a trusted LAN or an existing controlled fnOS entry. An allowed domain does not replace fnOS authentication or configure public routing, DNS or TLS.

## Mobile remote access

Open the warehouse from the fnOS app. If diagnostics report INVALID_ORIGIN, copy originHost and add its full origin in the application wizard, for example https://nas-app.example.net:12345. Separate multiple origins with commas and retain existing entries. Configured external origins are checked even when the forwarded Host is localhost. Update the configuration if the mobile entry address changes.

Diagnostics support clipboard copying with a selectable text fallback. The yellow banner is hidden after a successful connection.

## Background jobs and notifications

- Daily inventory and monthly sales jobs default to disabled on a fresh installation. Once enabled, they require the NAS, application and network to remain available.
- Multiple notification channels can be enabled. Saving settings does not send messages. Eye buttons reveal individual stored secrets on demand.
- Windows and NAS datasets are separate and do not automatically replicate. Enable the same business schedule on only one instance to avoid duplicate reports.
- Inspect logs and per-channel receipts. Do not repeat a send whose outcome is unknown.

## Data and access boundaries

| Item | Behavior |
| --- | --- |
| Data | fnOS-assigned `TRIM_PKGVAR`, mounted as `/data` |
| Persistent files | dataset.json, master.key, secrets.bin, settings, receipts, inventory/sales databases and browser login state |
| Web | LAN port `18761`, embedded desktop window and configured application origins |
| Independent API | Host binding `127.0.0.1:18762` only, with separate credentials; not automatically exposed to the LAN |
| Visual browser | Xvfb, x11vnc and noVNC stay inside the container; browser HTTP/WebSocket traffic is proxied through the gateway |

The container runs under a dedicated UID/GID with a read-only root filesystem, `cap_drop: ALL` and `no-new-privileges`. It mounts neither ERP directories nor the Docker socket. Browser writable files stay under its own `/data/home`. tini reaps child processes; Docker uses `unless-stopped`. A deliberate application stop should keep it stopped. A healthy endpoint does not prove Cainiao login.

Do not bypass installation problems by granting root access or sharing an ERP browser profile. Remote ERP/AI access to the loopback API needs a separately verified access path.

## Offline backup and restore

Stop this application in App Center and confirm its container has stopped; leave ERP running. Back up the complete actual application data directory, including `dataset.json`, `master.key`, `secrets.bin` and `workspace`. Backups contain login state and recovery keys: store them in a restricted location, encrypt separately and never upload them to a public repository.

From the repository root in an offline environment with Node.js 24:

```bash
node scripts/fnos-backup.mjs backup /absolute/app/data /absolute/private/backup --service-stopped
node scripts/fnos-backup.mjs restore /absolute/private/backup /absolute/app/data-restored --service-stopped
```

The script checks file SHA-256, sizes, dataset identity and keys, and rejects existing destination directories, symbolic links and corrupt backups. `--service-stopped` is the operator's assertion; it does not stop services. Copying live SQLite files is not a consistent backup.

Restore into a new directory, retain the original for rollback, verify the dedicated UID/GID and only then switch directories. Check dataset identity, secret decryption and schedules after startup. Containerized offline restore is covered by CI; a manual directory-switch restore on the real NAS has not completed end-to-end acceptance.

Upgrade only this application's image/FPK and preserve `TRIM_PKGVAR`. Do not use `docker compose down --volumes`. A rollback after a data migration requires the matching old application and consistent backup, not just an older executable.

## Uninstall

Project uninstall hooks do not proactively delete data, backups, images or ERP files. If fnOS offers to delete application data, retain it and verify an external backup first. Platform behavior controls its private-directory removal; this project cannot override a platform deletion. Historical image/data cleanup needs a separately defined scope.

## Build and verification

Version 0.10.17 builds Windows and Linux from the same source commit and provides a complete FPK and matching image. Build and installer acceptance results and file digests are recorded in the Release acceptance.json and SHA256SUMS.txt. Upgrades retain the original data directory, configured access origins and automatic-send settings.

Actions artifacts include build.json, image-inspect.json and checksums. The [deployment record](../../docs/fnos-deployment.md) preserves historical evidence.
