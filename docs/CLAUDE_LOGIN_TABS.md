# Claude sign-in tabs (macOS, draft)

The normal Workbench Claude window now reaches the magic-link step after
draft PR #42's narrow hCaptcha navigation fix. This stacked PR adds **two
tabs inside the existing Claude provider window**, without a Chrome
extension or model API:

- **Claude:** the existing provider WebView, including its current browser
  session and post-login chat bridge.
- **+ Email:** a second, script-free WKWebView with a URL field for Gmail,
  iCloud Mail, Outlook, or another HTTPS webmail site.

The toolbar is a *local* Tauri app WebView at the top of the provider's native
window (76 logical points high, with larger 44pt controls), not a DOM overlay injected into Claude.
It has three commands (open email, switch tab, close email). Claude and
the email website **never receive those commands or any Tauri IPC
permissions**. The third-party email view has no Workbench content-script,
login detection, response capture, telemetry or cookie-reader.

## Completing the same magic-link session

The email view uses the same default macOS WKWebView website data store
as Workbench's Claude WebView. Workbench does **not** import cookies from
Safari/Chrome or from the separate Swift test probe.

When a user clicks an `https://claude.ai/...` URL from webmail (same-tab
navigation or a new-window request), the email WebView cancels that
navigation and hands it to the **existing Claude WebView**.

**Important popup fix:** the original prototype denied non-Claude
`window.open` links and navigated elsewhere, including initial
`about:blank` popups. Email providers often open a blank popup, then
navigate it through a tracking URL to Claude. That made a click appear
to do nothing. The new version lets HTTPS/blank email popups open as
**actual WebKit child windows with the original opener configuration**
and watches their navigation, including a bounded nested-popup case.
When they reach the exact `https://claude.ai` origin, Workbench
hands the link to the original Claude WebView and closes the temporary
popup. It never records the path or query of those URLs.

The toolbar receives a short fixed result such as *Login link opened in
Claude* and never receives the magic-link value. The app never
logs, stores, emits, or displays the full URL (it may contain a bearer
magic-login token). The Claude tab becomes visible. Other HTTPS navigation
stays inside the email view. A user can also explicitly paste a Claude URL
into the email-tab address field and press Go; the URL is cleared from
the toolbar immediately after use.

## Implementation notes and limitations

- Mac-only in this first implementation. Other platforms retain the
  original provider window with no toolbar.
- Only Claude's provider WebView loses `auto_resize()`; its native parent
  window's resize event lays out the toolbar + active content. All other
  providers retain their original layout.
- The provider window stays alive when hidden, as before. Opening the email
  tab doesn't destroy Claude or reset its login challenge.
- Other email hosts do not share existing Safari/Chrome sign-in sessions.
  The user may need to log into webmail inside Workbench once.
- Email links that request a new window now get an actual opener-linked
  WebKit popup; this is more compatible with email-provider tracking
  redirects and popup-dependent OAuth. Its behavior still requires
  validation on macOS.
- If a link click still fails, **right-click the link → Copy Link
  Address**, click the Email tab's address field, paste it privately,
  and press Go. The toolbar will clear the pasted URL immediately.
  Never share a magic-link URL in a bug report.
- Native diagnostic logs are restricted to fixed events plus URL
  **scheme and hostname**; no path, query, fragment, or authentication
  token is written to logs.
- A Workbench-controlled embedded browser **is not a technical guarantee
  that an app cannot access website credentials**. This design minimizes
  access but requires security review before public release.
- No attempt to evade the provider's authentication checks. Provider
  authorization for third-party subscription automation is still a
  separate policy question.

## Local macOS smoke test

```sh
git fetch origin
git switch feature/claude-login-tabs
pnpm install
pnpm tauri dev
```

1. Open the **normal** Claude provider window from Connected Agents.
2. Confirm a small tab strip appears with **Claude** and **+ Email**.
3. Enter the email address at Claude's login page; confirm it proceeds
   normally to the magic-link step (PR #42's compatibility fix).
4. Click **+ Email**. Type your HTTPS webmail site in the address field
   (default Gmail), if needed. Sign in using the provider's real page.
5. Click the actual Claude magic link in webmail. The original **Claude**
   view should become active and complete its own login.
6. If the mail provider's link opens elsewhere, use the tab's URL field
   to paste and navigate to the link yourself. **Never paste a magic
   link in GitHub issues, screenshots or chat.**
7. Confirm Claude shows its normal chat composer, and Workbench eventually
   reports Ready. Send one short benign prompt, and verify Workbench
   captures its reply. **Do not automatically resend** if it reached
   Claude but Workbench missed the response.
8. Resize the native provider window and switch tabs. Close the email
   tab using ×; verify Claude remains authenticated.
9. Restart Workbench and check Claude session persistence.

Tests in `src-tauri/src/claude_login_tabs.rs` cover exact Claude origin
matching and refusal of unsafe URL schemes/authority credentials. This
PR requires a real macOS Tauri compile and end-to-end login test before
merging.


## 2026-10-27 follow-up: email link click originally did nothing

After opening webmail successfully, the user clicked the actual magic link
but saw no response. The first implementation returned
`NewWindowResponse::Deny` for every email `window.open` and tried to
navigate the mail tab manually, which loses its popup opener and may swallow
a blank-then-redirect flow. This branch now creates a real popup with
`window_features(features)` (which reuses the opener's WebKit
configuration on macOS) and transfers only exact Claude-origin
navigations to the original Claude tab.

The native tab strip was increased from 48pt to 76pt in response to the
user's screenshot. The user should now test **clicking the link once**,
not just pasting it. If the link still fails, request only sanitized local
Terminal lines beginning `[Claude email browser]`. Never request or
record the link or any authentication codes.

This is a **draft**, not a confirmed macOS fix; compiling, opening an
email-generated popup and completing Claude login still require the user's
local test.
