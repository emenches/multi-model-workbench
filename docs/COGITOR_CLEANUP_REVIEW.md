# Cogitor behavior-preserving cleanup — review checklist

This draft cleanup is based on the latest reviewed **typed-provider IPC security branch**
(PR #47, `security/cogitor-typed-provider-ipc`), **not main**. The Claude
left-click fix remains on its separately stacked draft PR #48. No security
PR or release is merged by this cleanup.

## Gate checked before creating this branch (2026-10-27 PDT)

- PR #46 head `b4f75b7`: [CI #40636289297](https://github.com/emenches/multi-model-workbench/actions/runs/40636289297) — successful.
- PR #47 head `ec6b466`: [CI #40636293822](https://github.com/emenches/multi-model-workbench/actions/runs/40636293822) — successful.
- PR #48 head `3d0813f`: [CI #40639010534](https://github.com/emenches/multi-model-workbench/actions/runs/40639010534) — successful, including 911 frontend tests.
- All three latest-head runs passed frontend verification, native Rust library tests and strict Clippy on macOS, Windows and Ubuntu. No unresolved PR review threads or reported failed security tests were found.
- User-reported macOS acceptance on the PR #48 line: Gmail Google-account switch, **ordinary left-click** Claude magic-link login back into the existing Claude session, successful three-agent Consult, reopening conversations, Stop, and authenticated session persistence after restart. Evidence: [PR #48 acceptance record](https://github.com/emenches/multi-model-workbench/pull/48#issuecomment-6461625394). This is a human report, **not** inferred from unit tests.

## Scope of this cleanup

- Centralize the repeated dock-provider membership checks in a private type guard; preserve provider order, slot swaps and normalization.
- Share chip/side presentation filtering and avoid a redundant normalization pass when finding the center provider.
- Reuse the existing sendable-target filter for Free mode; translate outdated comments without changing timeout behavior.
- Consolidate duplicated sidebar preference storage interfaces and browser lookup into a small UI-only helper. Access-denied browser storage now safely falls back to existing defaults rather than throwing while resolving a default argument.
- Clarify private settings normalizer names without altering persisted keys, schema, or values.
- Remove a dead Rust status-title payload branch that returned true regardless of payload, leaving the **STATUS_REPORT-only** security boundary unchanged; add positive/negative regression coverage.
- Add focused tests for provider membership, slot fallback, presentation filters and target order.

## Boundary review and deliberate non-changes

- **No edits** to Tauri command registration/capabilities, typed provider control/read IPC, origin checks, native popup handoff, Claude login tabs, cookies/profiles, Consult orchestration, or bridge retry/stop behavior.
- Keep historical storage keys, bundle ID, repository name, and native IPC/event identifiers intact.
- Oversized App/Settings components and broad CSS deduplication are intentionally deferred: changing their ownership or focus/layout behavior in this security gate is higher risk than the small helpers cleaned here.

## Required before merging or releasing

- Cleanup CI: frontend typecheck, lint, build, Vitest/agent tests; Rust tests and strict Clippy on **macOS, Windows, Linux**. Fix any failures without weakening tests.
- Hands-on Mac smoke test on the final assembled stack: Gmail account switch and **ordinary left-click** Claude magic link returning to the original Claude session; right-click Open regression, 3-agent Consult response capture, Stop, saved-chat reopen, restart persistence, Settings, and keyboard/focus navigation.
- Native macOS Retry popup under an actual failure and stale ChatGPT recovery remain **automated-only**; do not claim human verification. Hostile nested WebKit redirects, dependency/privacy audit and historical-file permission migration also remain separate security work.
- Reconcile stacked PR ancestry before merging in dependency order; **do not merge or release without explicit approval**. This draft cleanup is not a security certification.
