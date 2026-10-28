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

## Verification evidence and scope

**Automated CI completed (last full green baseline):**
- [CI run 40637580555](https://github.com/emenches/multi-model-workbench/actions/runs/40637580555)
  passed frontend verification (79 Vitest files, **910 tests**), build, types, lint,
  injected scripts, agent tests, and adapter checks.
- The same run passed native Rust library tests and strict Clippy (`-D warnings`)
  on **macOS, Windows, and Linux**. All three original security PRs (#46–#48)
  also passed their earlier platform CI runs.
- Additional composer keyboard-focus CSS regression tests were added after the
  above baseline; check CI at the final PR #48 head before merging.

**Actual macOS user acceptance, on the hardened preview line:**
- Claude Gmail account switching followed by an ordinary **left-click**
  magic-link handoff worked.
- A full **three-agent Consult** completed successfully.
- Opening an existing conversation, starting another chat, and **Stop** worked.
- Authentication remained active following a Cogitor restart.

**Automated-only edge cases, deliberately not induced on a healthy Mac:**
- Retry after a simulated provider-send failure, timeout, or degraded bridge,
  including stop-before-resend, reserved-turn continuity, and cancellation.
  Covered by `workflow.test.ts` and recovery-dialog tests in `m4a-ui.test.ts`.
- ChatGPT stale-status read/health/ack whitelist in Rust, plus transient
  stale/degraded transport recovery, non-duplication, and no forged responses
  in `pull.test.ts`. Not equivalent to observing a real stale ChatGPT document.
- Claude link filters reject off-origin/unsafe URLs and synthetic/right clicks;
  the browser script does not inspect Gmail page content, based on source and
  unit checks. Not equivalent to a full native synthetic-OAuth/WebKit pentest.

## Remaining limitations and follow-up work

- **Not manually verified on this build:** a real Retry modal opened by a
  provider failure; right-click `Open` after the left-click patch (previously
  working, and protected by a non-interception test); a real stale ChatGPT
  recovery event; synthetic hostile redirects across nested WebKit popups.
  These are explicit edge-case coverage gaps, not failed normal-use tests.
- Existing local file permission migration, sensitive-data retention and
  deletion controls, and potential Keychain encryption need separate design,
  rollback, and explicit user-data preservation work.
- Per-provider WebKit data-store isolation requires migration research and
  cannot be silently introduced without risking existing sign-ins.
- Complete dependency advisory review, minimization of residual native
  permissions, and a broader independent penetration assessment remain future
  security tasks. No standalone security certification is claimed.
- Current security branches are stacked and may have diverged histories:
  reconcile ancestry before merges; do not force-push or merge out of order.
- The application has no ability to isolate secrets from a compromised
  native host. Do not claim zero risk, end-to-end encryption, or credential
  isolation beyond ordinary browser origin separation.

## Release procedure

1. Merge only in dependency order after CI and live workflow smoke tests.
2. Update this document to reference the exact release SHA and completed
   checks; address any failed or skipped gate.
3. Publish accurate facts in GitHub README/description and a security policy.
   Keep the user-facing explanation accessible without exaggerating claims.
4. Rename the GitHub fork/repository and historical Cargo/developer app name
   as one coordinated release step, preserving attribution, old redirect links,
   profile locations, and update metadata.
