# Conversation-first Workbench and detached provider pages

## Problem
Repeated attempts to clip macOS WKWebView inside a React panel left **Real page** covering the workbench controls. The sidebar also devoted much of its space to diagnostic controls, preset cards and full provider browser content. During Consult, a provider can be **Ready** (connection healthy) while a workflow step still waits for a response-completion event; those states must not be conflated.

## New behavior
- **Real page** reuses the existing authenticated provider WebView and moves it into its own resizable, movable native window using Tauri's `Webview::reparent` API. It does not create a duplicate login session or a second provider engine.
- Closing a provider window hides it and reparents the same webview into the main window's hidden parking area. The native app menu can still minimize provider windows, and the main control pane remains separate.
- UI uses a **conversation-first shell**. Projects remain visible; bulky workflow cards move behind **Tools & modes**, with a quick selector on the conversation toolbar.
- A compact provider dock shows connectivity without taking over the chat area; the full provider inspector opens only when asked.
- Workflow progress is inspectable in the main conversation. **Connected/Ready is not a guarantee that a step has emitted RESPONSE_DONE.**
- The transport diagnostics panel remains opt-in.

## Permissions
The native provider-window command is callable only from the `main` workbench control webview via the explicit Tauri command permission. Remote provider content does not gain Tauri access. No CAPTCHA bypass, profile copying or remote shell/file access.

## Validation on the user's Apple M3 Max
Run:
```bash
git fetch origin
git switch feat/conversation-first-provider-windows
pnpm verify
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm tauri dev
```
Test:
1. Check the regular chat window retains visible controls when ChatGPT's **Real page** opens. Move/minimize the separate window.
2. Close the separate page and reopen it. Confirm that the same ChatGPT session remains logged in and a second authentication flow is not required.
3. Repeat with Gemini and with Claude login (if available).
4. Confirm two-provider Consult can still send to both providers with native windows closed.
5. Check project switching, compact mode selector, Tools & modes, provider inspector, and workflow details.
6. Verify the latest response-language changes: English question -> English review and English final synthesis.
7. Confirm app menus/shortcuts still return to the main workbench and no external ChatGPT renderer tab opens.

## Known follow-up
A screenshot showed Gemini's visible page answer with Consult still waiting, while ChatGPT's provider chip was Ready. That is a response-detection and workflow-state issue distinct from UI and native window clipping. Do not mark a step complete based solely on chip readiness. Capture which `RESPONSE_CHUNK` and `RESPONSE_DONE` events arrived for the in-flight provider before changing completion logic.

## Availability
This branch is source-level implementation, **not a verified macOS fix yet**. Tauri/WKWebView reparenting needs compile and live macOS validation. Existing branch work is stacked; `main` has not been changed.

## macOS native sizing diagnostic (follow-up)

User confirmed that opening the separate provider window works and the page remains logged in, **but the WKWebView stays the size of its original upper-left pane** even after the previous set_bounds/resizing/timeout patches. Those changes did not resolve the issue.

The next patch switches to Tauri's independent `Webview::set_size` and `Webview::set_position`, applied on show and on native window resize. It also reports **measured** window client and WebView dimensions, including WebView offset. This distinguishes:
- WebView size still reported as the old pane: a Tauri reparent/geometry problem.
- WebView reports filling the window yet the visible WKWebView remains small: an AppKit-native frame/layout desynchronization, requiring a macOS-specific native adjustment rather than more Tauri set_bounds delays.

When running `pnpm tauri dev`, click Real page and read the **Native page geometry** line in the workbench (also printed in Terminal). It shows physical pixels, not CSS pixels. Capture that line if the visual window still does not fill. Do not share authentication data, cookies, or page content.
