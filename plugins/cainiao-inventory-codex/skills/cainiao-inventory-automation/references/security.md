# Security Reference

- Store DingTalk Webhook, signing secret, callback URL, and callback token in macOS Keychain service `cainiao-inventory-codex`.
- Store non-secret configuration and business artifacts under `~/Library/Application Support/Cainiao Inventory Codex` with private permissions.
- Use a dedicated persistent browser profile. Do not copy a personal Chrome profile and do not store the Cainiao password.
- Bind the setup server only to `127.0.0.1`, require its random session token, reject bodies over 64 KiB, and close it after inactivity.
- Redact `access_token` values from logs and never include credentials in run manifests, MCP results, callback payloads, fixtures, releases, or Git history.
- Keep diagnostics local. They may contain inventory page content and must follow the configured retention window.
