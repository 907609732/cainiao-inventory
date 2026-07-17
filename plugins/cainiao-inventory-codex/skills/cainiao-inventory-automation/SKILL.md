---
name: cainiao-inventory-automation
description: Configure, run, validate, schedule, and troubleshoot Cainiao warehouse inventory automation with secure DingTalk delivery on macOS. Use when a user asks to install or set up Cainiao inventory collection, log in to Cainiao, scrape or export daily inventory, validate an inventory Excel file, send an inventory report to DingTalk, create or inspect the 22:00 daily schedule, retry an uncertain delivery, or diagnose a failed Cainiao inventory run.
---

# Cainiao Inventory Automation

Use the `cainiaoInventory` MCP tools. Keep secrets out of chat, shell history, logs, and tool arguments.

## Operating Workflow

1. Call `cainiao_doctor` before any setup, run, schedule, or diagnosis request.
2. If a required check fails, call `cainiao_open_setup`. Tell the user to enter DingTalk credentials only in the localhost page.
3. Use `cainiao_login` only when the runtime is ready and login is missing or expired. Wait for the user to finish any CAPTCHA or SMS verification in the dedicated browser.
4. Use `cainiao_run_inventory` with `mode=validate_only` for setup acceptance or data investigation. This must not send DingTalk or callback traffic.
5. Use `mode=send` only when the user requests a report or the configured schedule invokes it. Never replace a failed export with an old local file.
6. Treat `failed` and `delivery_unknown` as failures. Do not retry `delivery_unknown` automatically; explain the ambiguity and use `cainiao_retry_delivery` only after explicit user direction.
7. Install the schedule only after the setup page reports a successful DingTalk test and real dry-run.
8. Report the task reference date and Excel source date separately. Cainiao normally delays inventory data, so the website's default exported source date is authoritative. Never manipulate date controls or attempt to force current-day data.
9. If the user asks why the report is not current-day data, remind them that Cainiao's normal export mechanism is delayed and that the automation intentionally uses the website default.

## Safety Rules

- Never ask for or echo a Cainiao password, DingTalk Webhook token, signing secret, or callback token.
- Never send when file validation fails, when the workbook has no single valid source date, or when a new export was not downloaded. A source date differing from the task reference date is informational, not a failure by itself.
- Never use `forceSend=true` merely to bypass duplicate protection.
- Never delete saved snapshots, Keychain secrets, or diagnostics when removing the schedule.
- Preserve local diagnostic artifacts; quote only the redacted failure reason to the user.

Read [workflow.md](references/workflow.md) for data and scheduling behavior. Read [troubleshooting.md](references/troubleshooting.md) when a check or run fails. Read [security.md](references/security.md) before handling configuration or delivery problems.
