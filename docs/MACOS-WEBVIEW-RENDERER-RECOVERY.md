# macOS overlay and ChatGPT renderer window recovery

## Report
Native provider webviews can cover React buttons, especially after scroll or layout polling. Meanwhile ChatGPT may appear signed in but the host still shows **Checking**. Reopening ChatGPT could spawn a blank browser tab with `https://cdn.platform.openai.com/deployments/dil/v14/runner.html`.

## Fix
- Park a native provider view by **hiding it before changing its offscreen bounds**, never by moving it offscreen and then showing it. Some WKWebView implementations may clamp visible offscreen child surfaces to the window and obscure the toolbar. The app's existing `background_throttling(Disabled)` setting remains. This preserves provider webview and cookie profiles.
- Disallow automatic *top-level* browser window/popup creation for ChatGPT's narrowly recognized internal DIL runner URL (HTTPS `cdn.platform.openai.com/deployments/dil/.../runner.html`). The normal embedded HTML page, subresources and iframes remain under the provider's control; **do not block all requests to the CDN**.
- When a provider webview is loaded but its DOM status remains unknown, display an explicit **Reload** action on the app toolbar to retry the page bridge without signing out.
- Do **not** equate a signed-in preview with a functioning automation bridge. No forced `logged_in` status.

## macOS validation
1. `git switch fix/webview-overlay-and-chatgpt-recovery`, `pnpm verify`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `pnpm tauri dev`.
2. Sign in to ChatGPT; press Cmd+Shift+M to minimize; verify native page remains hidden even after idle for 5+ seconds and after two-finger scroll.
3. Open Real page; verify it remains within the provider content panel below the toolbar.
4. Restart the app. Confirm ChatGPT is not falsely marked Ready during reconnect, and click Reload if Checking persists. Verify readiness after bridge status is received and a Free fan-out message can be sent.
5. Confirm the DIL runner doesn't create a separate blank browser tab, while rich ChatGPT replies can still display inside the main page.
6. Recheck Claude login and Grok challenge behavior; no CAPTCHA bypass is introduced.

## Future: model and thinking effort selection
Expose per-provider controls only after proving a stable model-picker adapter can read and verify the provider's actual selected option. Do not claim a model/effort level was changed merely because a local selector was clicked. For now use the provider's own Real page to select the model and thinking effort manually.
