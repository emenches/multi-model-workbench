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


## Results from 2026-10-27

The user reports **both** original bare Tauri WebViewWindow probes accepted
Claude email login:

- **Fresh isolated profile: passed.**
- **Default profile: passed.**

The separate bare Swift WKWebView probe also passed. The normal Workbench
provider window still failed, including the script-deferral hypothesis in PR
#40. This means a Tauri browser and Tauri's default WebKit data store are
**both compatible with Claude authentication** in this environment. It
does **not** prove that provider-level child windows or Workbench's other
WebView settings are compatible.

### Second experiment: child WebViews

The same debug-only **Claude Login Tests** menu now has two additional entries.
These are closer to how Workbench actually embeds provider pages:

| New menu item | WebView creation | Parent window visibility |
| --- | --- | --- |
| **Claude child WebKit - visible host** | `WindowBuilder` + `add_child(WebviewBuilder)` | Visible when child is created |
| **Claude child WebKit - hidden-first host** | Same child WebView API | Hidden while child is created; shown afterward |

Each uses its own stable, separate 16-byte WebKit data-store identifier.
These are **not** the normal Workbench Claude provider window. Neither test
adds provider-specific scripts, shims, callbacks, custom browser args,
background-throttling overrides, or automation. Both start at
`https://claude.ai/` and do not read page content, cookies or credentials.

To run on macOS, from the Workbench repo:
```sh
git fetch origin
git switch test/claude-untainted-tauri-webview
pnpm tauri dev
```

Choose **Claude Login Tests → Claude child WebKit - visible host** and check
whether Claude advances to the magic-link step. Repeat with
**Claude child WebKit - hidden-first host**. Use only a consenting test login
and don't share links/codes. The test does not require completing login:
the acceptance/rejection of the email form is the signal of interest.

- **Both pass:** Window architecture and hidden-first creation are less
  likely to explain the original failure; the next controlled comparison
  should cover the provider's builder options and navigation callbacks.
- **Visible passes, hidden-first fails:** Investigate initial visibility
  and page-start timing before changing any login logic.
- **Both fail:** Investigate child WebView construction or WebKit data store
  selection versus `WebviewWindowBuilder`; isolate them in the next test.
- **Visible fails, hidden-first passes:** Investigate timing/window focus and
  load ordering; confirm in a fresh run before drawing conclusions.

These scenarios are hypotheses, not proven root causes. No production fix
is being merged as a result of these diagnostic-only windows.


## Results from both child WKWebViews — passed

The user reports that **both** clean child WKWebView variants accepted Claude
email login: the visible-host and the hidden-first-host test. Combined with
the two successful bare Tauri WebviewWindows, this confirms neither child
WebView construction nor initial hidden host visibility is sufficient to
trigger the browser-verification failure.

### Third experiment: browser options vs. navigation policy

Two additional **debug-only** variants now reproduce one category of
Workbench's *normal Claude provider settings* at a time. Both use their own
persistent 16-byte WebKit store, a child WKWebView, a hidden-first host, and
the same `https://claude.ai/` start URL as the passing tests:

| Menu item | Added over clean hidden-first child | Explicitly omitted |
| --- | --- | --- |
| **Claude child - Workbench browser options** | `data_directory`, `auto_resize`, `background_throttling(Disabled)`, exact `additional_browser_args` string | Init scripts, permission shim, title/page-load/navigation/popup callbacks |
| **Claude child - Workbench navigation policy** | `on_navigation` with the existing Claude adapter allowlists, denying unallowlisted navigation | Extra builder options, init scripts, permission shim, title/page-load/popup callbacks |

The navigation-policy test **does not** log URLs or inspect pages; it simply
applies the existing yes/no permission decision to native navigation. The
options test includes `data_directory` even though macOS WKWebView ignores
this setting; it is a construction comparison, not a recommended profile
mechanism. Neither test automatically signs in or reads credentials.

Run the latest branch:

```sh
git fetch origin
git switch test/claude-untainted-tauri-webview
git pull --ff-only origin test/claude-untainted-tauri-webview
pnpm tauri dev
```

Try **Claude Login Tests → Claude child - Workbench browser options**, and
then **Claude child - Workbench navigation policy**. Only check whether Claude
accepts your email and advances to the magic-link step; do not share a
magic link, OTP, screenshots containing it, or session data.

- **Options fails only:** isolate individual builder settings, especially
  `background_throttling`, and then confirm without custom flags.
- **Navigation policy fails only:** inspect legitimate auth/challenge
  destinations rejected by the existing policy, but do not circumvent the
  provider's authentication checks.
- **Both pass:** the remaining differences include title/page-load/popup
  callbacks, combined settings, `initialization_script` when PR #40 is
  absent, lifecycle/timing, and other interactions. Continue with a
  narrower combination test; do not assume the cause.
- **Both fail:** validate one at a time on a fresh launch and check whether
  the added callback/settings individually affect the sign-in page.

No production login change is implied by these diagnostic-only tests.
