# ChatGPT repeatedly Checking / Real page overlaps controls

## Observed
- ChatGPT signed in and able to answer in Consult, but returns to "Checking" after application restart.
- Real page can draw above app controls again even after offscreen parking was repaired.
- DIL CDN renderer URL occasionally appeared as a separate browser tab.

## Root causes addressed
1. The "modal/overlay" cleanup restored **every** loaded provider with `provider_show()`, even those parked in text mode. That re-exposed WKWebViews over React. Now it restores only the currently selected native center after measuring and setting bounds.
2. The center-hidden transition could also call `show()` without positioning the child. It now accepts an explicit measured-stage function. In production, absent bounds or text mode means no restore.
3. An earlier DIL runner exception returned `true` from the provider's top-level navigation callback. That could replace the signed-in ChatGPT page with an auxiliary CDN document (which never installs the provider bridge). The app now rejects a renderer as a *top-level* navigation while leaving ordinary iframe/subresource loads to WKWebView.
4. The staleness watchdog previously sent `CHECK_STATUS` only to an *already functioning* bridge, making a missed initialization remain Checking. After confirmed ChatGPT app load, and when stale, it now tries a bounded repair of document-start bootstrap and adapter engine, only in the app's allowlisted top-level origin. It does not run on auth, renderer, or challenge documents.

## Safety
- No CAPTCHA bypass or changes to browser login/session storage.
- Native webviews remain loaded and signed in while parked.
- Do not equate a visible logged-in page with a verified automation bridge.

## Local macOS validation
1. `pnpm verify`; `cargo test --manifest-path src-tauri/Cargo.toml --lib`; `pnpm tauri dev`.
2. Verify ChatGPT is Ready after reopening an authenticated session without needing to log in again.
3. Open Real page, scroll, wait for 2+ background alignment polls, minimize Cmd+Shift+M. Controls must remain exposed.
4. Check no blank DIL runner windows open. Embedded rich responses should still render.
5. Run two-provider Consult all four stages; verify English-language original question yields English review and synthesis.
6. Verify Claude login and Gemini still work.

If ChatGPT keeps Checking, collect app diagnostic host statuses and which document URL is loaded (do not share session tokens) before making further changes.
