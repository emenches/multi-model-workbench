# Login WebView covering the provider toolbar

## Report
In the ChatGPT pane, an Apple SSO page could cover the **Real page / Expand / Login / More** buttons. An affected screenshot showed the native content beginning at roughly y=24px.

## Root cause and fix
Previously, `provider_open_login` created an absent provider child at hardcoded `(x=24, y=24, width=420, height=320)`. Native WKWebView child views paint over React controls regardless of HTML z-index, so this is not safe.

The React login action now waits for a visible, measured content-stage rectangle and explicitly opens the provider at that location. The Rust command requires an existing child plus the explicit measured bounds, and positions it **before** navigating to login. Existing children are repositioned before being shown, preventing a brief overlap with the toolbar.

This does not alter Apple's credential processing. A separate OS login popup may overlap the parent window.

## Minimize provider page after sign-in

- Use the existing **Text view** button in the provider header when it is accessible. **Real page** reopens the embedded content.
- If a native page obscures the header, choose **Workbench → Minimize Provider Page** (Cmd+Shift+M). This hides the native provider webviews and restores text mode **without** signing out or closing temporary authentication popups.
- For an unresponsive authentication flow, **Workbench → Return to Workbench (Close Login)** (Cmd+Shift+0) also closes transient provider login popups. This is the stronger escape action.

Both actions retain the saved per-provider browser profile; neither intentionally signs out.

## Local macOS regression test
1. `pnpm verify` then `pnpm tauri dev`.
2. ChatGPT → Login → Apple SSO; check all provider-toolbar controls remain visible and clickable.
3. After successful login, choose **Workbench → Minimize Provider Page** (Cmd+Shift+M), verify the page hides and the app controls are accessible. Reopen via **Real page** and verify the session is still signed in.
4. Test sign-in to an initially unopened provider and again after hiding/reopening.
4. Verify Claude CAPTCHA tab-loop and native recovery fixes still work.
5. Run `cargo test --manifest-path src-tauri/Cargo.toml --lib`.

The code change is not yet verified on macOS until the live login smoke test succeeds.
