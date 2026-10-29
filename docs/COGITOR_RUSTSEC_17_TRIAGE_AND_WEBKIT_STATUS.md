# Cogitor RustSec triage: original 17 advisories and actual exposure

Source baseline: old Cargo.lock in preview before security PR #53 (520 locked crates). Audit evidence: [original RustSec failure](https://github.com/emenches/multi-model-workbench/actions/runs/40646146022). Updated audited dependency lock: PR #53 at `01529bbbb6bb6725c008268e40b0d0d71f242ef3` passed [RustSec](https://github.com/emenches/multi-model-workbench/actions/runs/40647389908) with **0 known vulnerability findings** among 498 locked crates, after 17 original advisories. The last additional code-only navigation guard still requires cross-platform CI and an installed-app smoke test.

Important distinction: RustSec scans *locked dependency versions*, including packages for optional features and targets. A RustSec hit is evidence of an affected version in the lockfile; it does not establish the vulnerable function was exercised or remotely reachable from Cogitor.

| IDs | Old library and version | Exploit precondition / Cogitor-specific exposure | Remediation |
| --- | --- | --- | --- |
| RUSTSEC-2026-0369, 0367, 0368 | `zip 4.6.1` (3) | Unsafe ZIP extraction/symlink and Unix permissions; high/critical *as a library flaw*. Old reverse lock dependency chain `zip → tauri-plugin-updater → Cogitor`. Cogitor **never initialized or invoked the updater plugin** in `lib.rs`. No demonstrated user-controlled extraction path in the app. | Deleted unused `tauri-plugin-updater` dependency; ZIP removed from lockfile entirely. |
| RUSTSEC-2026-0341, 0339, 0342, 0340, 0338 | `quinn-proto 0.11.15` (5) | QUIC protocol DoS/crash issues: stream buffer guard bypass, connection-ID retirements, datagram buffer handling, peer ACK timing panic, zero-length stream panic. Old graph `quinn-proto → quinn → reqwest → Cogitor`. Targeted `cargo tree --edges features -i quinn-proto` on Apple Silicon and normal Linux tree show the QUIC crate **not activated by the checked feature configuration** (reqwest has `default-features = false`, no HTTP3 feature requested). A lock entry alone is not a demonstrated reachable QUIC endpoint. | Compatible upgrade `quinn-proto 0.11.19`; audited graph clean. |
| RUSTSEC-2026-0195, 0194 | `quick-xml 0.39.4` (2) | Namespace allocation and quadratic duplicate-attribute checks on malicious XML. Old reverse path `quick-xml → plist → tauri-utils/Tauri` (primarily app/property-list handling). No specific runtime ingestion of attacker-controlled remote XML was identified; do not equate with exposed network XML parser. | Updated plist to 1.10.3 and quick-xml to 0.42.0. |
| RUSTSEC-2026-0347, 0348, 0349, 0346 | `rustls 0.23.45` (4) | TLS ECH rejection data handling (specific early-write/ECH configuration), optional Brotli decompression memory exhaustion, post-handshake downgrade handling and debugging secret exposure. Unlike ZIP/QUIC, Rustls **is active** through `reqwest` native HTTPS; individual advisories still have narrower feature/API preconditions, and no exploitation was established. | Updated `rustls` to 0.23.46. |
| RUSTSEC-2026-0382 | `rustls-webpki 0.103.15` (1) | Path validation could accept distrust-listed emSign intermediates; real trust-store consequence for HTTPS using this stack. | Updated to `rustls-webpki 0.103.16`. |
| RUSTSEC-2026-0383, 0381 | `webpki-root-certs / webpki-roots 1.0.8` (2) | Same distrust event affecting bundled TLS roots, reached by native HTTPS `reqwest` graph. | Updated `webpki-roots` to 1.0.11; unused old root-certs package removed from lock. |

Total = **3 + 5 + 2 + 4 + 1 + 2 = 17**. This is six affected dependency groups, not 17 independent Cogitor code flaws.

### Independent source evidence and path investigation
- RustSec advisories: https://rustsec.org/advisories/RUSTSEC-2026-0369.html, https://rustsec.org/advisories/RUSTSEC-2026-0341.html, https://rustsec.org/advisories/RUSTSEC-2026-0195.html, https://rustsec.org/advisories/RUSTSEC-2026-0382.html.
- The one-off read-only [Cargo dependency platform and feature diagnostics](https://github.com/emenches/multi-model-workbench/actions/runs/40647797292) ran on the PR branch. They show `zip` absent from the resolved graph, QUIC not activated in the checked feature trees, `quick-xml` through plist/Tauri, and `rustls`/`webpki` through reqwest native HTTPS. The temporary diagnostics workflow was deleted after the check.
- The follow-up RustSec recheck after `tokio 1.54.1` and `event-listener 5.4.2` reports **0 known vulnerabilities and 10 allowed informational warnings**, down from 12 warnings on the first refreshed lockfile: https://github.com/emenches/multi-model-workbench/actions/runs/40647389908.
- Remaining allowed warnings involve unmaintained `unic-*`, `zvariant`/D-Bus, `proc-macro-error`, and a `glib` iterator soundness warning. They require upstream updates/platform-specific review, not ignoring or treating the complete risk as zero.

## WebKit / OAuth security validation: exact status

**A full packaged Cogitor WKWebView penetration test has NOT been performed**, but real engine-level testing now runs in CI. Additional verified coverage:
- A real macOS WKWebView executable compiled with Apple's WebKit/AppKit SDK runs on GitHub's macOS runner (macOS 26.6.2). It uses deterministic synthetic local pages; no real accounts, token URLs, or external services.
- [Live native WebKit run 40649324924](https://github.com/emenches/multi-model-workbench/actions/runs/40649324924) passed all adversarial probes: SOP cross-origin frame DOM reads blocked; native delegate denied untrusted top-level navigation and new windows; different WKWebViews had isolated test message handlers; script-originated MouseEvent could not forge `isTrusted`; injected real Cogitor Claude link script ignored synthetic and host-spoofed clicks.
- The **real bundled `claude-login-tabs.html`** was loaded in WKWebView and its added `frame-src 'none'` Content Security Policy prevented a hostile iframe from loading. The native toolbar builder also now denies popups and restricts its navigation to the bundled toolbar route; the latter callback is covered by Rust unit tests.
- A static CI assertion verifies that the `main` control view and `claude-login-toolbar` have their intended distinct native capability grants. This is policy analysis, not a remote webpage invoking Tauri IPC in the built application.
- The test harness lives at `scripts/security/WKRuntimeProbe.swift` and runs via `.github/workflows/webkit-runtime-security.yml`. Every new browser-boundary code change should rerun this job.

This test suite **does not run Cogitor's packaged Tauri host** and does not exercise real authenticated OAuth flows. It is a substantial engine-level hardening test, not a substitute for end-to-end application penetration testing.

Previous source/unit checks also cover:
- Rust unit tests for native URL policies, provider origin checks, typed IPC actions, malicious URL patterns, and session lifecycle.
- Node VM tests run the *actual* injected Gmail/Claude click-activation JavaScript against fake DOM events: scripted, right-click, modifier, host spoofing, credentialed URLs, unsafe schemes and Google redirect wrappers.
- Source review of Tauri `main`-only permissions and the separate tiny toolbar capability; the real provider and Gmail WebViews have zero Tauri IPC grants.
- New hardening restricts the privileged Claude toolbar **itself** to its bundled page, denies new popup windows and avoids it navigating to remote websites. It is a defense-in-depth change, not a demonstrated exploit, and is not yet live-smoke tested.

**Not yet tested end-to-end in real macOS WebKit**:
1. Malicious WebView page tries all `window.__TAURI__` and invoke routes; native requests from untrusted provider/email origins must be refused while the local toolbar continues to function.
2. A throwaway Gmail identity with controlled message HTML: links to lookalike hosts, redirect chains, encoded destinations, custom ports, `javascript:` and `file:` URLs, popup storms, cross-origin iframes, and target=_blank. Confirm none can hand a token or privileged command to the Claude view.
3. Verify exact-origin Claude magic link handoff, normal left-click, right-click, Google account switching, and OAuth popups in the **packaged** app (also after quit/relaunch), not just synthetic browser tests.
4. Provider navigation attacks from malicious redirects/SSO pages, including stale document callbacks after a new navigation, and Tauri IPC/capability boundary bypass attempts.
5. Inspect macOS WKWebView/NSApp runtime process, network activity, disk cookies and security logs with explicit authorization and test identities; perform independent manual review rather than using personal inbox/session tokens.
6. After any new toolbar navigation guard: ensure production bundled `tauri://localhost/claude-login-tabs.html` is not blocked and the existing login flow remains usable. CI cannot confirm a user's saved browser login.

The 2026-10-27 user-installed universal DMG smoke test proved Claude+Gemini signed-in session persistence and two-agent workflow in the earlier preview, but **does not constitute a penetration test** and cannot validate this later unmerged hardening change.

## Release decision

- The specific 17 RustSec vulnerability findings are remediated in the *PR branch* and the recheck passed. Do not claim they are removed from the already-installed app, the old preview DMG, or public main until the PR merges and a new DMG is built and tested.
- Browser runtime adversarial penetration testing, final cross-platform CI after the last toolbar guard, and actual Developer ID notarization remain separate gates for wider beta distribution.
