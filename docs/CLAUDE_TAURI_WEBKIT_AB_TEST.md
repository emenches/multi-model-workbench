# Claude macOS WebKit A/B login test

## Why this test exists

The user's standalone, clean Swift/AppKit `WKWebView` successfully signed in to
Claude on macOS. Workbench's real Claude window still returned **“Couldn't
verify your browser”** after PR #40 removed its document-start injected
scripts and permission shim. Therefore disabling those scripts alone did not
fix Workbench and cannot be presented as a proven solution.

## Test setup

This PR adds a **debug-only** native menu named **Claude Login Tests** with
two test windows. Neither window is part of Workbench's normal Claude workflow.

| Menu item | WebKit data store | Other custom Workbench provider hooks |
| --- | --- | --- |
| Claude raw WebKit - default profile | Tauri/macOS default website data store | None |
| Claude raw WebKit - fresh profile | A stable, new `data_store_identifier` | None |

Both tests construct `tauri::WebviewWindowBuilder` at the exact
`https://claude.ai/` address that succeeded in the Swift probe. Both keep
the user agent at its native default. **Neither** uses `BOOTSTRAP_JS`,
`PERMISSION_SHIM_JS`, `on_navigation`, `on_page_load`,
`on_new_window`, `background_throttling`, external auth interception,
or DOM/browser evaluation in Workbench code. Tauri's own WebView
initialization still exists; this is not literally the same `WKWebView`
construction code as Swift.

The **fresh profile** is deliberately separate from Workbench's regular
website store. It may require signing in anew. No cookies or login
information are copied or inspected. The fixed store ID persists across
debug restarts; the test does **not** clear existing provider data.

## Run

In a local clone:

```sh
git fetch origin
git switch test/claude-untainted-tauri-webview
pnpm install
pnpm tauri dev
```

From the macOS menu bar, choose **Claude Login Tests → Claude raw WebKit -
fresh profile**. Type your email at the Claude login screen.

**First pass condition:** Claude proceeds to the magic-link / verification
step, as it did in the successful standalone Swift probe.

If the fresh-profile test succeeds, try the **default profile** version and
compare. If both succeed but Workbench's Claude window still fails, focus
next on the provider-specific WebviewBuilder lifecycle, navigation hooks,
popups, and WebView ownership. If the fresh-profile test succeeds but default
fails, focus next on site-data-store isolation and existing authentication
state. If **both fail**, investigate differences in Tauri/Wry WebKit
initialization versus the native Swift WKWebView, rather than revisiting the
same login-script patch.

Only enter credentials on Claude's genuine page. The diagnostic windows do
not inspect page content or request login details from Workbench, and users
should **not** share magic links, codes, session cookies or credential logs.

## Security / scope

- A diagnostic, **not** a production fix or login bypass.
- Debug macOS builds only; no release menu or runtime code.
- No extension, API key, request interception, user-agent impersonation, or
  sensitive DOM access.
- The app runtime still owns the embedded browser, so this does not make
  credential access technically impossible under a compromised app.
- Provider automation and account/subscription terms remain independent
  questions that must be checked before a public Workbench release.
- No automated authenticated end-to-end test possible without local macOS
  execution and a user-controlled provider account.

## Related

- PR #40: Claude script-deferral hypothesis; user confirmed login still fails.
- Tauri WebView data directories are unsupported on macOS; data store identifiers
  are supported on macOS 14+:
  https://v2.tauri.app/reference/config/
