# Workbench security and maintainability review

**Date:** 2026-10-27  
**Target:** `feature/claude-login-tabs` (working, manually validated three-agent Consult)
**Status:** Initial targeted source audit and low-risk hardening; **not** a comprehensive independent penetration test or proof of security.

## Verified product baseline

The user successfully signed into Claude from the native Workbench provider window,
using the Gmail tab and **right-click → Open** on its magic link. The toolbar
layout and Gmail account switching are working. They then completed a Consult
with **three agents working together**. This is the behavioral baseline and
the minimum acceptance test for every security/cleanup change.

The standard Gmail *left-click* on that magic link is still unresponsive.
Right-click → Open is a confirmed fallback. Do not casually refactor the
authentication bridge, navigation callbacks or popup opener until this
behavior has a reproducing test.

## Threat model and trust boundaries

- **Trusted local control pane:** the Workbench React app can start workflows,
  request selected native commands, and operate supported provider pages.
  Main-pane XSS is high-impact because arbitrary provider evaluation remains
  an available native command.
- **Untrusted third-party pages:** Claude, ChatGPT, Gemini, Grok, email and all
  popup sites may contain scripts outside Workbench's control. The current
  Tauri capability configuration grants *none* of the control-pane permissions
  to these remote provider/mail pages. Keep that separation.
- **Local Claude toolbar:** is a bundled local HTML/JS page, not injected into
  Gmail. Its capability is limited to tab actions plus `core:default`.
  Treat changes to those permissions as security-sensitive.
- **Native auth handoff:** some WebKit navigation callbacks handle a Claude
  magic-link URL transiently in native memory and pass it to the existing
  Claude WebView. Current diagnostics print only fixed events, scheme and
  hostname; keep paths, queries and auth codes out of logs.
- **On-disk data:** settings, project context, snapshots, adapter cache and
  session checkpoint files may contain user content or account/workflow
  information. Browser storage contains authentication cookies.
- **Remote dependency:** the app fetches adapter JSON from a default upstream
  `TED-H-com/multi-ai-chat-desktop/main/adapters` source at startup and every
  six hours. Adapter JSON cannot expand the bundled URL host scope under the
  present validator, but can change selectors and behavior within that scope.

An app-controlled WKWebView is **not** a hard credential-isolation boundary
from a compromised native app. The present design avoids inspecting email
DOM/cookies or collecting credentials by default, but does not support
claims that the app is technically *incapable* of reading those credentials.

## Findings and actions

| ID | Priority | Evidence / risk | State |
| --- | --- | --- | --- |
| S1 | High | `settings::write_atomic_before_replace` used `std::fs::write` for temp files. On a typical Unix umask of 022, new local JSON files can have 0644 permissions; snapshots and resume data can contain user conversations. | **Fixed in this PR for newly written/replaced files:** exclusive `create_new` plus 0600 mode on Unix, with tests. Follow-up review fixed an exclusive-create collision error path that could unlink a preexisting temp file; a regression test preserves that file. Existing files need a later permission migration after backup/rollback design. |
| S2 | High | `adapters.rs` auto-fetches JSON from a mutable upstream `main` branch, using version precedence and bounded scope validation. This is a supply-chain/data-capture surface: remote selector changes may affect which DOM nodes are read on provider pages. | **Open:** propose a separately reviewed change to bundled-only updates by default, or pinned/signature-verified manifests with explicit consent. Do **not** remove update behavior in the same PR as the storage fix. |
| S3 | High | `webviews.rs` exports native `provider_eval` / `provider_eval_with_callback` with arbitrary JS supplied by the trusted main control pane. Guarding the caller and page origin reduces the risk, but compromised main UI code would have powerful provider-page access. | **Open:** move to a small set of typed actions (send, status, snapshot, stop), then remove generic arbitrary-JS IPC after a Consult regression suite. |
| S4 | Medium | `settings_get` and `settings_set` relied on Tauri's main-WebView capability for authorization but lacked the explicit `ensure_control_webview` check used elsewhere. | **Fixed in this PR:** explicit trusted main-webview checks without changing frontend command names. |
| S5 | Medium | `settings::open_external_url` and `adapters::build_source_url` previously accepted any string with an HTTPS prefix; userinfo, ports and URL normalization can conceal unintended destinations. An initially valid adapter source could also redirect to HTTP or another host. Adapter downloads enforced a 64 KiB limit only *after* allocating the entire response, allowing an unbounded body when Content-Length was absent or false. | **Fixed in this PR:** structural URL validation, origin-bound HTTPS redirects, and a streaming size limit enforced on every downloaded chunk, with negative tests. |
| S6 | Medium | The email WebView permits general HTTPS browsing and opener-linked popups; links to Claude are routed to the existing Claude WebView. This is required for the working magic-link flow, but popup-origin and user-gesture boundaries deserve dedicated tests. | **Open:** preserve working right-click path while testing left-click and malicious redirects with synthetic, non-secret URLs. Never add mailbox DOM-reading scripts as a workaround. |
| S7 | Medium | `session_checkpoint.rs` persists a JSON string locally with no explicit size limit; snapshots have a count cap but no per-file byte cap; stored data may be plaintext. | **Open:** document retention and redaction, add generous file bounds, assess macOS Keychain-backed encryption at rest and recovery behavior. Avoid deleting user data during upgrade. |
| S8 | Medium | macOS `data_directory` is unsupported for WKWebView; all provider pages may use the default native website data store, though websites still have ordinary origin-based cookie separation. | **Open:** define stable `data_store_identifier` values, separately test migration and SSO, avoid silently signing users out. |
| S9 | Medium | `webviews.rs` exceeds 4,000 lines; `injected/engine.ts` exceeds 2,500. Login, popup, bridge and workflow lifecycles are intertwined. | **Open:** split by *behavioral boundary*, not mechanical line moves, after golden tests cover all providers. |
| S10 | Low | The existing `securityConfig.test.ts` checked only the main control capability, not the Claude toolbar capability. | **Fixed in this PR:** assert toolbar-only commands, no remote scopes and no provider/mail access. |
| S11 | Medium | Dependabot watched GitHub Actions but not the committed `pnpm-lock.yaml` and `src-tauri/Cargo.lock`. | **Fixed in this PR:** weekly npm and Cargo update PRs for maintainer review. |

**Positive findings:** production CSP is configured for the main window; provider
WebViews are not listed in the privileged capability; adapter URL scopes are
validated against bundled host scopes; native WebView control eval is gated
by provider state and URL; the bridge title transport only accepts
status-report actions; GitHub CI already runs frontend verification and
Rust tests/Clippy across Windows, macOS and Linux; GitHub Actions are
pinned by commit SHA. Retain these protections.

## Recommended cleanup sequence

### Phase A — Safe hardening (this PR)
- [x] Owner-only atomic local file creation on Unix/macOS
- [x] Explicit trusted-webview authorization for settings commands
- [x] Strict external and adapter-source URL parsing, plus HTTPS same-host redirect policy
- [x] Toolbar capability regression tests
- [x] Dependabot for JavaScript and Rust
- [ ] Existing CI checks green on all three operating systems
- [ ] Mac smoke test: Claude login, Gmail account switch, three-agent Consult,
      response capture, window resize and restart persistence

### Phase B — Supply chain and secrets (separate PR)
- [ ] Pin adapter source to an audited, immutable revision or signed manifest;
      make new selector versions visible and require an explicit update policy
- [ ] Review all adapter JSON selectors for overbroad capture and unexpected
      text serialization
- [ ] Assess current dependencies for known advisories; resolve only with
      tested lockfile updates
- [ ] Create an opt-in permission migration for already-existing local
      snapshots/checkpoints/settings (do not rewrite or delete user data
      silently)
- [ ] Decide on user-visible privacy controls: clear browser profile,
      clear chats and snapshots, export data, and explicit persistence choices

### Phase C — Native browser and authentication
- [ ] Build a synthetic OAuth/magic-link test web page with no real secrets:
      normal click, context-menu Open, about:blank intermediate popup,
      redirect, nested popup, Gmail mailbox route and hostile link
- [ ] Verify no tab/page URL containing a token reaches logs, events,
      issue templates or clipboard without explicit user action
- [ ] Narrow the toolbar's `core:default` capability after confirming
      exactly which Tauri event and IPC permissions it needs
- [ ] Test per-provider macOS data stores and session migrations without
      accidentally breaking shared sign-in flows
- [ ] Verify browser-origin and authenticated-document checks on every
      injection path (Claude, ChatGPT, Gemini, Grok)

### Phase D — Refactor without changing functionality
- [ ] Split `webviews.rs` into provider lifecycle, navigation policy,
      login popup handling, window layout and native bridge submodules
- [ ] Split `injected/engine.ts` into adapter lifecycle, composer input,
      response capture and liveness modules
- [ ] Move URL-policy decisions to pure functions with exhaustive tests;
      do not introduce broad wildcard allows
- [ ] Replace raw IPC `js: String` commands with strongly typed action
      payloads and a fixed native script dispatcher
- [ ] Remove redundant diagnostics/old experiments **only after** confirming
      no active recovery behavior relies on them
- [ ] Add a regression matrix for simple chat, Consult, session checkpoint,
      stopped/retried messages, signed-in/signed-out providers, tabs and
      restored window geometry

## Release gates

Before merging any security PR, require:
1. `pnpm verify` / frontend tests and `cargo test --lib` / Clippy on the
   existing CI matrix; any failed platform blocks merge.
2. A **real** macOS smoke test in the normal Workbench window with three
   connected agents. Confirm each answer is visible in Workbench's own
   transcript; do not retry a provider prompt simply because capture failed.
3. Claude sign-in via the known right-click → Open path and an explicit
   check for the outstanding ordinary-click bug.
4. No debug logging of email content, cookies, password fields,
   magic-link paths/query strings or user transcripts.
5. A rollback path (revert the unmerged PR and relaunch) with browser
   sessions/data left intact unless the user explicitly clears them.

## Verification status (follow-up)

- Additional source review on this draft identified and fixed an exclusive-temp-file
  failure path: when `create_new` failed because the path already existed, the
  original cleanup tried to remove that path even though this process had not
  created it. File creation and post-creation write failures now have separate
  cleanup behavior, with a collision regression test.
- The connected GitHub Actions API currently reports **zero workflow runs and
  zero check runs** for this repository/PR commit. This is an absence of
  verification, **not** a green build. Before merging, enable/check repository
  Actions settings and confirm the `CI` pull-request workflow actually runs;
  check Windows, macOS, Linux, frontend and Rust tests.
- A separate follow-up review found that the HTTP client could follow adapter
  source redirects outside the initially validated origin. The fetch client now
  follows at most five redirects, and only to the same HTTPS host without
  credentials or custom ports. Redirect tests use synthetic, token-free URLs.
- Adapter download response handling now rejects bodies as soon as incoming
  chunks exceed 64 KiB; it no longer allocates an unbounded HTTP response
  before checking its size. A unit test exercises exact-cap and over-cap input.
- `cargo` and `pnpm` and the macOS WebKit runtime are not available in this
  editing environment. Source inspection and newly added tests cannot replace
  a compiled matrix or the user's Mac smoke test.
- This is stacked as PR #44 onto PR #43, itself dependent on the Claude login
  fixes. Do not merge out of order or claim this is already deployed to `main`.

## Validation boundaries

This report is a source-level triage of the specific files cited above.
No automated dependency CVE scan, independent pentest, or full code coverage
analysis has yet been completed. The code in this PR has **not** been compiled
or exercised on the user's Mac through this GitHub connector, and no PR
should be marked ready or merged based solely on this report.
