# Claude sign-in recovery (M1 bugfix)

On macOS, Claude's embedded verification can issue repeated disallowed navigations; the original app opened each in the system browser, producing unusable CAPTCHA tabs. Separately, a native child webview or an authentication popup can obscure the React panel controls.

## Fix
- Claude's **non-allowlisted** HTTP(S) top-level navigations and popup requests are blocked rather than automatically opened in the user's system browser. The existing blocked-host notice still identifies these URLs. Allowlisted provider and SSO flows remain unchanged.
- Add native **Workbench → Return to Workbench (Close Login)** menu action with **Cmd+Shift+0**. It hides all provider WebViews, closes transient provider popup windows, focuses the main window, and switches the frontend to text mode.
- All popup windows request OS decorations and a bounded initial size. Unmanageable fallback popups are denied.
- No CAPTCHA bypass, browser fingerprinting, or automatic challenge solving is introduced.

## Local validation
1. `git switch fix/claude-login-escape`, `pnpm verify`, then `pnpm tauri dev`.
2. Open Claude's login and reproduce the stalled CAPTCHA.
3. From the native macOS menu, choose Workbench → Return to Workbench, or press Cmd+Shift+0. Confirm you can operate other providers without completing Claude login.
4. Verify no further system-browser CAPTCHA tabs open automatically from blocked Claude redirects.
5. Verify a normal browser window opened manually does not imply an authenticated session in the isolated app WebView.
6. Run `cargo test --manifest-path src-tauri/Cargo.toml --lib` and check CI before merging.

This fixes loss of control of the app; it cannot guarantee Claude will permit an embedded session.
