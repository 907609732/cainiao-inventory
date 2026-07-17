# Troubleshooting

## Runtime Not Ready

Open the setup page and run the runtime preparation step. It verifies the Node archive checksum and installs the Playwright browser under the application data directory.

## Login Missing Or Expired

Run `cainiao_login`. Let the user finish CAPTCHA, slider, SMS, or account confirmation in the opened browser. Do not request credentials in chat.

## Export Button Missing

Treat this as a probable Cainiao UI change. Do not use an older download. Inspect the newest local screenshot and HTML diagnostic, then update the versioned selectors in the browser worker.

## Validation Failed

Use `cainiao_get_run` and report the first concrete errors. Common causes are a missing or mixed source date, missing columns, duplicate barcodes, invalid numbers, unbalanced stock, or a mismatch with the previous source day's ending stock. A date delay by itself is normal and must not be treated as an error.

## DingTalk Failed

- Explicit HTTP or DingTalk error: fix the Webhook, signing secret, robot security settings, or rate limit, then run again.
- `delivery_unknown`: do not automatically resend. Ask the user whether the group received the report, then use `cainiao_retry_delivery` only when requested.
- `already_sent`: duplicate protection worked; do not force a duplicate unless the user explicitly asks.

## Schedule Did Not Run

Check `cainiao_get_status`, the LaunchAgent file, and local launchd logs. A logged-out or powered-off Mac cannot run browser automation. Within 24 hours, the due checker catches up after the GUI session resumes.
