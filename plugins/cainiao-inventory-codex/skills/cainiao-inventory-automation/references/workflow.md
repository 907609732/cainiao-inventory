# Workflow Reference

## Setup

1. `cainiao_doctor` checks macOS, runtime, dedicated browser login, report policy, DingTalk Keychain entry, and launchd.
2. `cainiao_open_setup` opens a random localhost port with a random session token.
3. The setup page prepares pinned Node and Playwright versions, opens the login profile, saves DingTalk secrets to Keychain, sends a no-data test message, runs a real dry-run, and enables launchd.

## Daily Run

Cainiao inventory data normally arrives with a delay. Use the website's default export without changing date controls. The workbook must contain one valid source date, which is recorded separately from the task reference date and is authoritative for snapshots, reports, continuity, and duplicate delivery protection.

The run order is fixed:

1. Acquire the exclusive run lock.
2. Export a new Excel file using Cainiao's default date selection.
3. Calculate its SHA-256.
4. Validate columns, row count, unique SKU, nonnegative numbers, stock arithmetic, source date, and adjacent-day continuity.
5. Save an immutable normalized snapshot and run manifest.
6. Build the Markdown report and report hash.
7. Apply the configured `always` or `critical_only` policy.
8. Check the delivery ledger and send at most once for the source date, report hash, and destination.
9. Optionally POST the validated result to the configured HMAC callback.
10. Save final status and apply local retention.

Any failure before delivery stops the run. A timeout during DingTalk delivery becomes `delivery_unknown`, because the remote service may have accepted the message.

## Scheduling

The LaunchAgent label is `com.907609732.cainiao-inventory`. It runs a lightweight due check every 15 minutes. The due checker uses `Asia/Shanghai`, targets 22:00, allows a 24-hour catch-up window, and skips a query date already marked successful.
