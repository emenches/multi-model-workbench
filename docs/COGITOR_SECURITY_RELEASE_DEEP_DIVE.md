# Cogitor release security deep dive — Developer ID and native browser boundaries

## What can be verified without credentials
- Core native WebView trust boundary: only bundled `main` control pane has Tauri commands; provider and Gmail WebViews/popup windows have none.
- Rust URL navigation policies: bounded SSO allowlists for provider tabs, and HTTPS-only email popups with no embedded credentials, custom ports or local URL schemes.
- Claude's browser event listener: scripted/middle/right/modified clicks ignored; only trusted left-click exact-origin `claude.ai` destinations or Google `www.google.com/url` wrappers pointing to `claude.ai` are intercepted. No reading email content or logging OAuth/magic-link query tokens.
- Adversarial tests run in a stubbed DOM/URL VM and native Rust URL policy unit tests. These prove the scripted guards, NOT end-to-end WebKit behavior or real Apple account acceptance.
- The checked-in production CSP and `main`-only Tauri capabilities remain in place. No arbitrary provider eval IPC was restored.

## New automatic dependency review
`.github/workflows/dependency-security.yml` runs `pnpm audit --audit-level high` against direct and transitive frontend/build dependencies, and RustSec `cargo audit --file src-tauri/Cargo.lock`. It runs on lockfile changes and can be manually dispatched; a weekly schedule becomes active when the workflow exists on the default branch. A passing npm test suite or Rust Clippy check is NOT an advisory scan. Audit results must be reviewed at the recorded commit, and high/critical findings must be triaged before a public beta.

### Advisory findings and remediations (2026-10-27 PT)
- Initial npm scan: **12 advisories (2 high, 7 moderate, 3 low)**. The old graph used Vite 6.4.3 and Zod 4.4.3 (high); the first upgrade resolved to Vite 6.4.5 and Zod 4.6.6. The remaining lower-severity advisory inventory narrowed to `@vitest/mocker` (moderate) and `fast-uri` (moderate/low). A follow-up lock refresh resolved to Vitest/mocker 4.1.12 and fast-uri 3.1.9. Do not claim a clean *final* npm scan until the new head commit's workflow succeeds.
- Initial RustSec scan: **17 vulnerabilities, including a critical ZIP extraction issue**, plus 12 allowed informational warnings. Reverse dependency graph traced ZIP 4.6.1 exclusively to unused `tauri-plugin-updater` (not initialized in Cogitor). Removed the unused plugin; re-resolved only affected compatible native packages: plist 1.10.3, quick-xml 0.42.0, quinn-proto 0.11.19, rustls 0.23.46, rustls-webpki 0.103.16, and webpki-roots 1.0.11. The subsequent RustSec audit [run 40646742578](https://github.com/emenches/multi-model-workbench/actions/runs/40646742578) **passed with no vulnerability errors** on the 498-crate lockfile.
- **12 RustSec allowed warnings remain**: unmaintained `proc-macro-error`, `unic-*`, `zbus_names`, `zvariant`/derive and potentially unsound `event-listener`, `glib`, `tokio` warnings. These may be transitive and/or platform-specific; they are not equivalent to zero residual security risk and need upstream dependency monitoring.
- These are **source-lockfile advisory results**, not proof of exploitability or isolation under a compromised OS account. Final cross-platform Rust compile and macOS packaging must pass after lock changes.



## Developer ID signing and Apple notarization (requires maintainer provisioning)
`.github/workflows/cogitor-macos-signed-beta.yml` is **workflow_dispatch only**. It needs a protected GitHub Actions Environment named `cogitor-release` with required reviewer approval. Do not add credentials to ordinary repository variables, CI logs, PR comments or this chat.

GitHub → Repository → Settings → Environments → **New environment**, name `cogitor-release`, configure required reviewers and restrict deployment branches to `preview/cogitor-unified-macos`. Add these **environment secrets**:

| Secret | Content |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded export of a valid Developer ID Application certificate + private key (P12) |
| `APPLE_CERTIFICATE_PASSWORD` | P12 export password |
| `APPLE_SIGNING_IDENTITY` | Exact `Developer ID Application: … (TEAMID)` keychain identity |
| `APPLE_API_ISSUER` | App Store Connect issuer UUID |
| `APPLE_API_KEY` | App Store Connect key ID |
| `APPLE_API_PRIVATE_KEY` | Contents of the matching downloaded .p8 private key |

Apple Developer membership alone is not enough: a **Developer ID Application** signing certificate is required for distribution outside the Mac App Store; Developer ID creation may require the account holder. Prefer a dedicated App Store Connect API key with appropriate Developer role. The .p8 file should never be committed.

The manual release workflow runs the full test suite, overrides the existing ad-hoc signature **only in ephemeral CI config** with Developer ID, and assigns preliminary beta display version `0.1.0`. Tauri signs, requests notarization with the API key, and staples the app. The workflow then mounts the DMG; verifies signing chain/team, refuses ad-hoc signature, checks `xcrun stapler validate`, `spctl --assess`, confirms both Intel and ARM architectures, and uploads a SHA256 manifest + DMG as an **Actions artifact only**. There is no GitHub Release creation, tag push, branch push, auto-merge or automatic distribution.

**Important:** GitHub only exposes a manual workflow when the workflow file exists on the repository's default branch. A workflow staged only on the preview or a PR cannot be launched from the Actions tab until that workflow definition is approved onto the default branch. This is a deliberate pre-release staging constraint; do not copy Apple secrets to another CI surface just to circumvent it.

Authoritative references:
- Tauri v2: https://v2.tauri.app/distribute/sign/macos/
- Apple notarization: https://developer.apple.com/documentation/security/customizing-the-notarization-workflow
- GitHub Actions environments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments

## Remaining risks and test gates
1. OAuth popup WebKit runtime behavior, browser-origin isolation, and native redirect handling require an actual macOS WebKit penetration test with throwaway identities. Scripting unit tests do not prove real sandbox boundaries.
2. Tauri does not isolate credentials from a compromised native host, OS login account, or malicious installed extension. Local saved chat/snapshot data is not claimed to be end-to-end encrypted.
3. Apple signing secrets must be manually provisioned, and no ticket exists until Apple returns a successful notarization. A passing test workflow alone is not a notarized release.
4. Sign-in with ChatGPT Continue with Apple remains blocked by the same Apple account-security lock in Safari Private; not a confirmed Cogitor-specific bug. Do not repeatedly retry locked account or bypass authentication.
5. Keep existing `com.tedh.multiaichat` bundle ID until a reviewed profile migration exists. Changing ID casually would orphan user WebKit cookies and conversations.
6. Public README, upstream attribution, `SECURITY.md`, first-release versioning and installer naming still require final review. No "security certified", "zero vulnerabilities", or "fully notarized" claim before evidence.

## Release decision
A public beta is reasonable only with a completed dependency advisory triage, merged and tested browser guards, real Apple notarization with the release commit, and end-user installed-app acceptance. A verified commit SHA and DMG SHA256 should be recorded in the release notes.
