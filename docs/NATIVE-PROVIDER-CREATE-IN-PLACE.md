# Native provider windows: create in place, never reparent

## Problem / verified repro
The user's Mac repeatedly renders an authenticated ChatGPT provider WebView only in the old small upper-left pane area after **Real page** moves it into a much larger macOS window. Multiple patches invoking `set_bounds`, `set_size`, `set_position`, auto resize and delayed retries did not fix the visual result.

## Architectural change
The provider WebView is now **constructed directly inside its destination native window**, even while the window is initially hidden, in `provider_open`:

1. Create/reuse `provider-page-<provider>` as a `tauri::Window` at 940 × 700 logical pixels.
2. Create the provider's **single** WebView as a full-client child of that window, with `WebviewBuilder::auto_resize()`, keeping the original per-provider data directory and bridge/navigation hooks.
3. **Real page** shows this window. No `Webview::reparent` is used.
4. Closing the native window *hides the window* rather than destroying the underlying authenticated WebView.
5. On screen resize, the window's auto-resize behavior controls its child; `provider_open_window` also performs one explicit client fit and returns measured geometry.
6. Legacy `provider_open_login` does not apply the control pane's small rectangle to the hosted WebView.

The project's current layout engine continues to call `provider_hide`, `provider_show`, and `provider_set_bounds`, but those commands already decline to repaint or resize a WebView in a dedicated host. Authentication state and bridge execution remain attached to the **same** provider WebView and provider profile.

## Security invariants
- Only the app's `main` control webview may invoke `provider_open`, `provider_open_window`, and related commands. The provider's remote content gets no file, shell or Tauri command access.
- This does not bypass CAPTCHA or authentication checks and does not duplicate browser sessions or copy cookies.
- The per-provider persistent storage path remains `app_data/webviews/<provider>`.

## Local Mac verification
```bash
git fetch origin
git switch fix/native-provider-window-owning-webview
pnpm verify
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm tauri dev
```
- Open **Real page** for ChatGPT: its page should fill the entire native window, including after resize and maximize.
- Close/reopen; verify logged-in session persists without opening another login flow.
- Repeat for Gemini.
- **Important:** With the native windows hidden, verify ChatGPT and Gemini still show **Ready** and actually respond to a simple two-provider Consult question. A hidden host is a different lifecycle from a visible main-window child, and may expose background script throttling or load behavior. If this breaks, the next architecture must explicitly retain background execution without reparenting.
- The developer geometry display should show WebView size matching native window client size. If the dimensions match but the rendered page remains small, collect a screenshot and geometry values before changing code again.

## Status
Unverified on macOS and not merged. It requires Rust compilation and runtime test on the user's Mac. Previous small-frame sizing patches in parent PR #8 are superseded by this branch's change to provider creation ownership.
