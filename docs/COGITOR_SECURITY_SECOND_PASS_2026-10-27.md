# Cogitor second security pass — post-integration review (2026-10-27 PT)

## Scope and baseline
Reviewed the combined Cogitor preview at `4960931e53b50b42884eb6a726f67a85c8096877`, focusing on:
- Tauri capabilities and native IPC; provider WebViews and navigation/popup decisions.
- Claude/Gmail magic-link flow and cookie handling.
- Read/write behavior of settings, project metadata, snapshots, checkpoints and remote adapter cache.
- Adapter HTTPS download limits, redirect policy and opt-in gate.
- Release signing/attribution/privacy, separate from app runtime security.

Compared relevant sections against the upstream `TED-H-com/multi-ai-chat-desktop` source as of upstream main `6bcf904dfce890f7ebe198cbfc329bf8d685ce62` (2026-10-19).

## Confirmed protections retained
- Provider pages have no Tauri command capability; only local `main` has permissions and Rust commands verify the caller.
- Cogitor replaced generic native `provider_eval` string execution with allowlisted typed actions and restricted read-only probes.
- Remote adapters are off by default, even for cached overrides; opt-in, data validation, same-host HTTPS redirects, on-stream 64 KiB cap and explicit recheck of consent apply.
- Checkpoints and snapshots have capped UTF-8 reads, file type/inode checks and size-limited writes. Atomic JSON writes use exclusive temp files and owner-only mode on Unix.
- Claude magic-link navigation checks exact `https://claude.ai` origin and does not log or emit a secret token; auxiliary Gmail WebViews have no Tauri commands.
- Combined integration CI passed 913 frontend tests and Rust tests/strict Clippy on macOS, Windows and Linux, with successful universal macOS DMG packaging. Previous real packaged smoke tests passed Claude + Gemini two-agent workflows and auth persistence.

## Findings fixed in this PR
1. **Settings file lacked read/write byte bounds and trusted symbolic links.** The old `read_settings` loaded the whole JSON with `read_to_string`. It could read an oversized or symlinked local file and a later Settings save could replace a malformed settings file with defaults. Now it shares the bounded UTF-8/symlink-aware file reader (1 MiB), limits serialized new settings, and refuses to overwrite unreadable existing settings. The UI/provider state can still fall back safely on damaged data; an explicit Settings save fails with an error until the user recovers the original.
2. **Remote adapter *cache* read was unbounded.** HTTPS downloads already stream-limit to 64 KiB, but `hydrate_from_cache` used `std::fs::read_to_string` without a cap. It now uses the 64 KiB file limit and rejects symlinks. Rejected cache files remain untouched. This complements, and does not replace, the already-default-off adapter update policy.

3. **Markdown exports previously used default file permissions and followed symlinks.** A conversation can contain sensitive content, and a newly exported file on Unix may otherwise be world-readable under a permissive umask. Exports now use existing owner-only (0600 on Unix), atomic writes and refuse symlink/non-regular targets. Existing regular files can still be explicitly overwritten via the normal save dialog. No change is made to in-app conversations or original source files.

Regression tests cover oversized/corrupt/symlinked settings, refused destructive overwrites, oversized outgoing settings, malformed remote cache reads with original data intact, and Markdown-export privacy/symlink handling.

## Remaining security differences / explicit limits
- Native auth and email popups use embedded WKWebView. Gmail may follow user-clicked HTTPS tracking links in zero-permission auxiliary WebViews; OAuth and exact-origin magic-link handoff are complex and do not have an independent native WebKit pentest. Tightening redirects blindly risks breaking live login.
- Apple Account 'locked for security reasons' reproduced in Safari Private, so it is not a demonstrated Cogitor-only authentication regression. ChatGPT Apple login acceptance remains pending user recovery.
- User content, cookies and WebKit profile data are local but not claimed to be end-to-end encrypted or Keychain-protected. A compromised local OS account/native host remains out of scope.
- Initial `settings.json` failures still render safe defaults to keep the app usable; direct saves now reject replacing unreadable legacy data, intentionally requiring recovery instead of silent loss.
- Full dependency advisory review, penetration testing with adversarial WebKit redirects and recovery from an actual provider-failure Retry modal remain incomplete.
- macOS DMG uses ad-hoc signing, not Developer ID notarization. README, SECURITY.md and release credentials still reference upstream; those require update before public promotion.
- Existing Rust formatting drift remains advisory in macOS preview workflow; this PR does not mix in a wholesale rustfmt rewrite.

## Release/merge guidance
This is a separate **draft** PR into the validated preview branch. Do not auto-merge, rename bundle ID, clear app data or publish a binary. Require frontend and Rust tri-platform CI, then maintain the prior packaged-app login/Consult smoke-test expectations.