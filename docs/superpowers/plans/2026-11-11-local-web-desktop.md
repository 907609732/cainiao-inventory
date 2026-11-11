# Local Web and Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Windows application, local browser and AI share one warehouse backend.
**Architecture:** Retain Electron owner and safeStorage. Add explicit operation dispatcher, authenticated Fastify transport and browser adapter. Profile-scoped discovery coordinates CLI/MCP with the owner; tray controls lifetime.
**Tech Stack:** Electron 44, Fastify 5.12.7, official @fastify/static 10.1.10, existing MCP SDK, Node test runner and Playwright.
**Spec:** `docs/superpowers/specs/2026-11-11-local-web-desktop-design.md` (approved in conversation).

## Global Constraints

- Bind only 127.0.0.1; development uses temporary profiles and synthetic data.
- Preserve independent install identity, encrypted secrets, existing task lock and date-exception evidence rules.
- No source-root static serving, arbitrary IPC forwarding, plaintext secret readback to browsers, automatic real messages, installation or publication.
- Existing feature checkout is clean and dedicated; branch `codex/local-web-desktop` isolates this work without copying installed dependencies.

## Review Focus

- Port belongs to another app: fail without connecting or leaking credentials.
- HTTP timeout/retry and concurrent writes: durable task receipt/idempotency, no duplicate send.
- Browser reload loses token fragment: cookie session resumes and CSRF can be rediscovered.
- Old CLI/MCP spawns a second scheduler: route standalone operations to the owner.
- Assets and update actions: explicit asset whitelist and desktop confirmation.

### Task 1: Authenticated HTTP service
Files: `desktop/local-web/server.mjs`, `tests/local-web-server.test.mjs`, dependency lockfile.
Interface: `createLocalWebServer({version,host='127.0.0.1',port,dispatch,assets,verifyBearer})` returns `{start(),stop(),openUrl(),address}`. `dispatch(operation,payload,context)` uses explicit operation names; `context={kind:'browser'|'ai'|'owner',id,write:boolean}`. Browser gets HttpOnly cookie/CSRF from short-lived fragment exchange, AI uses Bearer. Explicit `operations` definitions govern reads/writes, schemas, confirmations and owner-only operations. Task receipts stored through injected state path.
- [x] Write failing tests for Host/Origin, unauthenticated reads, one-use exchange/CSRF, asset confinement, AI readonly, idempotent side effects and error redaction.
- [x] Implement with Fastify and official static plugin; run targeted tests and commit.

### Task 2: Browser adapter and credentials UX
Files: `desktop/renderer/web-adapter.js`, `renderer.js`, `index.html`, `styles.css`, preload as needed; tests browser fixture.
Interface: HTTP `/api/v1/session` POST exchanges `{token}` and returns `{csrf}`; GET resumes. `/api/v1/call/:operation` POST receives operation payload; `/api/v1/events?after=N` GET returns `{cursor,events:[{type,data}]}`. Adapter implements current preload methods, polls events, provides actionable offline status and never reads plaintext secrets. AI local settings card offers create/revoke with write opt-in; secret display one-time only on explicit action.
- [x] Failing browser tests for session reload, all four pages, blank preserved secrets, offline state and event delivery.
- [x] Implement adapter and minimal settings controls without redesign; verify desktop unchanged and commit.

### Task 3: Owner coordination and integration
Files: `desktop/local-web/client.mjs`, `main.mjs`, `mcp-server.mjs`, `mcp-stdio-entry.mjs`, `shared/ai-interface.mjs`, relevant tests.
Interface: profile `workspace/state/local-web.json` discovery stores PID, origin, instanceId, ownerToken with Windows user-only ACL; never served over HTTP. Client verifies live PID, brand, instance identity and protocol before sending owner credential. CLI process starts `--background` owner as needed; task calls use owner API and receipt polling. Backend operation table explicitly maps existing functionality. Default port 17891 (test port 0 explicitly allowed).
- [x] Failing tests for profile-specific owner discovery, stale/foreign owner, competing starts and CLI inventory/sales queries.
- [x] Implement owner lock/HTTP, tray/open-web/background, shared command dispatch, browser-session bound date confirmation, AI encrypted credentials and strict schemas. Reject managed web mode without changing managed compatibility.
- [x] Validate CLI/MCP connect to same backend, close browser/app retains owner, tray exit cleans service and discovery. Commit.

### Task 4: Packaging and end-to-end acceptance
Files: NSIS include, builder config, package scripts, `tests/local-web-ui.mjs`, docs and CI.
- [x] Test packaged dual startup, native browser fixture, HTTP auth, synthetic inventory/sales/settings consistency, two-mode owner PID, no real sends.
- [x] Add NSIS start-menu web shortcut carrying `--web`, preserve current app identity/shortcuts.
- [x] Run full regression, source/packaged UI, MCP, Windows unpacked build; document exact evidence and remaining installer boundary.
- [x] Whole-branch fresh review, resolve important findings, commit verified source; do not release/install unless requested.

## Progress

2026-11-11: Design approved. Environment Node 24.18.0, Electron and dependencies already present; working tree clean at beba82b. Existing dedicated checkout verified via `git worktree list`; new branch used. Technical execution uses scoped agents for independent transport/adapter tasks with root integration; no further scope approval needed.

Ruling: dependency audit identified path guard advisories in static8.3.0; official10.1.10 metadata still supports Fastify5.x, so use patched10.1.10 and Fastify5.12.7 after targeted integration tests. Do not broadly update unrelated dependencies.

2026-11-11 source verification: 189/189 regression, actual Electron HTTP renderer with synthetic inventory/sales/settings and shared CLI owner, readonly/revocable AI, failing and successful synthetic child log redaction, background-first/web/desktop owner reuse and graceful exit. Date exception AI preview + desktop confirmation local mock passed; managed UI remains compatible. Reviewer original P1/P2/P3 findings corrected with failing-then-passing regressions. Installer and packaged runtime checks are still pending.

2026-11-11 final proof: source and packaged web/lifecycle/notification/date-exception checks passed; local candidate131625411 bytes SHA2562751b84970caa9ebcde4dd75e9bc3396c3cb43e3be78b11d152922166304aab2 at build4184945. Windows CI42968725312 and actual cloud fresh/0.9.7-upgrade/reinstall/uninstall42968725348 passed. Both reports ok=true, synthetic data/settings hashes preserved, both launch entries share owner. Final code review approved. Legacy workbench runtime coexistence NOT retested: original public asset removed; local retained authentic installer matched700d64... but current Sandbox is another software task. No stopping that VM or reuploading old software. This limitation remains open before a new public release; do not claim full legacy coexistence acceptance. Feature branch retained, no release/local production install.
