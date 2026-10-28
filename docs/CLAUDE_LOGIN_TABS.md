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
window (48 logical pixels high), not a DOM overlay injected into Claude.
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
navigation and hands it to the **existing Claude WebView**. The app never
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
- Email providers requiring true popup windows for OAuth may not work
  yet, since email's `window.open` is kept in the tab rather than
  constructing an opener-linked popup. If this occurs, use a webmail
  provider that supports in-tab login or the explicit pasted-link route.
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
