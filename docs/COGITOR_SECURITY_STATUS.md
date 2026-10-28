# Cogitor security hardening status — 2026-10-27

This document supplements the original security triage in
`SECURITY_HARDENING_REVIEW_2026-10-27.md`. It describes source changes on
**unmerged draft branches**, not a security certification.

## Changes staged for review

**PR #46: remote selectors and saved content**
- Bundled provider adapters are now the default. Remote adapter downloads and
  cached remote overrides require a deliberate checkbox opt-in in Settings.
  Changing from enabled to disabled restores bundled selectors in running
  provider pages; an in-flight fetch rechecks permission before applying.
  Cached files are retained for reversibility.
- Settings update policy is enforced in native Rust, not only in the UI.
  Malformed, missing, and historical preference files default to "off".
- Snapshot write/read cap: 16 MiB per file. Checkpoint write/read cap: 8 MiB.
  Oversized existing files fail with an error, not truncation or deletion.
- Persisted-file reads validate regular file type, size and (on Unix) the
  identity of the opened file to reduce symlink replacement attacks.
- Visible native app/recovery menu says Cogitor, while bundle identity and
  stable native event names remain unchanged.

**PR #47: typed provider boundary (stacked on #46)**
- Removed generic `provider_eval` and `provider_eval_with_callback` from
  Tauri command registration, capabilities and permission entries.
- Allowed typed actions: **send**, **fill**, **stop**, and **acknowledge numeric
  bridge message**. Read-only native bridge reads: **peek** and **health**.
  Native code creates the fixed JavaScript itself and JSON-encodes user
  messages as data. Source text supplied through the IPC cannot be executed.
- The frontend compatibility layer maps only the known bridge read expressions
  and safely encoded acknowledgements to the typed native commands; other JS
  expressions are rejected before calling native code.
- Existing main-webview, provider-activity, page-origin and readiness checks
  remain in force.

## Still open (do not claim resolved)

- Human test of Claude Gmail account switching, right-click magic-link login,
  multi-provider Consult and response capture, Retry and Stop, stale ChatGPT
  bridge recovery, and macOS window/profile persistence.
- A full Windows/macOS/Linux CI matrix with frontend checks, Rust tests and
  Clippy. Draft PRs remain unmerged if any gate is failing or pending.
- Popup user-gesture boundaries and normal left-click login link behavior;
  synthetic OAuth and hostile-redirect browser tests.
- Migration of permissions for *existing* local files, privacy/deletion
  controls, and whether keychain-backed encryption at rest is feasible.
- Mac WebKit per-provider data-store isolation cannot be changed without an
  explicit, rollback-safe migration for signed-in profiles.
- Dependency vulnerability review, removal of unused native permissions,
  modular refactor and cross-platform end-to-end accessibility tests.
- Existing app/browser history remains locally accessible to the signed-in
  desktop user. Never claim full device credential isolation, zero-data-risk
  security or end-to-end encryption.

## Release procedure

1. Merge only in dependency order after CI and live workflow smoke tests.
2. Update this document to reference the exact release SHA and completed
   checks; address any failed or skipped gate.
3. Publish accurate facts in GitHub README/description and a security policy.
   Keep the user-facing explanation accessible without exaggerating claims.
4. Rename the GitHub fork/repository and historical Cargo/developer app name
   as one coordinated release step, preserving attribution, old redirect links,
   profile locations, and update metadata.
