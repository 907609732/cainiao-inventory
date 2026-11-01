# Date-mismatch exceptional send implementation plan

Goal: show a date-exception send button only after the latest date-only inventory validation failure; require a detailed confirmation before sending that exact file, without importing it or marking normal validation successful.

Implementation: add a focused service reading the latest validation and file hashes; revalidate all checks at preview and confirmation, bind a short-lived single-use token to file/baseline/config/validation, and audit attempts separately. Reuse existing inventory Markdown and notification delivery. UI adds a hidden button and native confirmation dialog; independent app only, existing task lock and sender checks remain active.

- [x] Unit tests first: date-only older file eligible; missing/changed file, non-date errors, future dates, superseded validation, changed targets, expired/absent confirmation denied; no inventory/validation mutation; duplicate uncertain send denied.
- [x] Implement isolated preview/send service and record source hashes during sync validation.
- [x] Wire sender-restricted IPC, job locking and confirmation dialog; test cancel and actual mock dispatch with synthetic XLSX.
- [ ] Run regression/UI, update developer documentation, verify packaged dependency integration, commit source. No formal data, actual sends or installed applications are changed during development.

Review: fixed download-directory alignment and final synchronous evidence/expiry checks after asynchronous credential reads. Reproduced concurrency and secret-read mutation cases with failing tests, then passed. Eight focused tests, real Electron/local HTTP mock UI, and 163 regression tests passed. No formal-data writes or live provider sends.
