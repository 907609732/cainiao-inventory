# Multi-channel Notifications Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Configure and deliver cloud inventory reports to multiple enabled notification channels.
**Architecture:** Preserve legacy DingTalk settings. Add normalized channel settings and secret fields, use push-all-in-one provider classes, aggregate sanitized per-channel receipts, and keep unsafe retries blocked.
**Tech Stack:** Electron, Node.js, SQLite, push-all-in-one 4.6.0 (MIT).
**Spec:** docs/superpowers/specs/2026-11-01-multi-channel-notifications.md

## Global Constraints
- No installed application, formal data, credentials or automatic schedules may be changed.
- No real provider message during development/tests. Never log raw SDK errors or responses containing credentials.
- Legacy DingTalk config remains usable without user migration.

## Review Focus
- Partial success and uncertain network outcome must not be reported as complete success.
- Disabled channels never send; empty/invalid target configuration fails before any dispatch.
- Telegram numeric IDs retain precision and long reports are split within provider limits.
- Saved secrets stay encrypted and diagnostic output does not include them.
- Monthly retries must not resend channels already accepted.

## Tasks
- [x] Add failing settings, fan-out, receipt and SDK adapter tests; observe failure, implement normalized settings and shared delivery.
  Files: desktop/shared/notification-settings.mjs, core/notifications.js, tests/notifications.test.mjs, desktop/shared/settings.mjs.
- [x] Add channel controls and encrypted saving; preserve old account/robot saves; prove with isolated Electron UI.
  Files: desktop/renderer/index.html, desktop/renderer/renderer.js, desktop/main.mjs, tests/warehouse-ui.mjs.
- [x] Integrate inventory and monthly reports, receipt classification and retry guards; run focused and full regression tests.
  Files: core/sync-cainiao-inventory.js, core/erp/warehouse-monthly-sales.js, desktop/main.mjs.
- [ ] Update synthetic documentation/screenshots and attribution; verify packaging dependency collection and perform final review.

## Rulings
- SMTP uses the public Nodemailer API directly so TLS/STARTTLS can be required; no custom SMTP implementation.
- SDK HTTP rejection logging is suppressed via an Axios response interceptor scoped with AsyncLocalStorage, preserving legacy callers outside that scope.
- Independent review found unknown-receipt retry, proxy clearing, and webhook mention regressions; each was reproduced with a failing test and fixed.

- SMTP authentication/envelope rejection is classified as pre-delivery failure and can retry after correcting credentials; DATA/network uncertainty stays unknown.
