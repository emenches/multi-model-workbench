# Login WebView covering the provider toolbar

## Report
In the ChatGPT pane, an Apple SSO page could cover the **Real page / Expand / Login / More** buttons. An affected screenshot showed the native content beginning at roughly y=24px.

## Root cause and fix
Previously, `provider_open_login` created an absent provider child at hardcoded `(x=24, y=24, width=420, height=320)`. Native WKWebView child views paint over React controls regardless of HTML z-index, so this is not safe.

The React login action now waits for a visible, measured content-stage rectangle and explicitly opens the provider at that location. The Rust command requires an existing child plus the explicit measured bounds, and positions it **before** navigating to login. Existing children are repositioned before being shown, preventing a brief overlap with the toolbar.

This does not alter Apple's credential processing. A separate OS login popup may overlap the parent window; users can still use **Workbench → Return to Workbench (Close Login)** or Cmd+Shift+0.

## Local macOS regression test
1. `pnpm verify` then `pnpm tauri dev`.
2. ChatGPT → Login → Apple SSO; check all provider-toolbar controls remain visible and clickable.
3. Test sign-in to an initially unopened provider and again after hiding/reopening.
4. Verify Claude CAPTCHA tab-loop and native recovery fixes still work.
5. Run `cargo test --manifest-path src-tauri/Cargo.toml --lib`.

The code change is not yet verified on macOS until the live login smoke test succeeds.
