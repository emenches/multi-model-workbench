# Model and reasoning-effort controls — first usability pass

## User request
The user wants to set model and thinking effort without hunting through each full provider site. The Workbench uses authenticated provider webviews rather than official per-token APIs.

## Implemented in this PR
- Add a **Model & effort** action to every active provider tile in the compact dock.
- One click opens **the existing authenticated native provider window**, preserving the working macOS full-size window lifecycle.
- Display a dedicated Model & effort panel with **Current model: Not verified** and **Thinking effort: Not verified**, plus a clear link back to the provider's own menu.
- Never claim that selecting a local setting changed the provider. Options vary by provider, plan and selected model; some providers do not expose explicit effort controls.
- Keep the normal provider Inspect/details view independent.
- Add UI tests to verify honest unverified labels and the real provider-opening action.

## Next phase: verified in-app picker (NOT included)
A robust in-app picker requires a provider-specific adapter which can:
1. Read actual available model and effort choices from the live provider page without relying on guessed account entitlements.
2. Present only choices returned by that provider.
3. Apply a selected option through the allowed visible page UI, *not* via fake local state or unsupported APIs.
4. Read back and verify the provider's actual selection before showing it as active.
5. Fall back to **Manage on provider page** on DOM change or unclear verification.
6. Avoid interacting with SSO/CAPTCHA screens and never give remote provider views Tauri privileges.

No provider-specific selectors have yet been validated against a current authenticated macOS page, so direct dropdown control is intentionally deferred.

## Mac testing
From `feat/provider-model-effort-entry`:
```bash
pnpm verify
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm tauri dev
```
Open the compact Providers section, select **Model & effort** for ChatGPT and Gemini, and confirm their separate full-size provider pages open immediately. Change the model manually in the provider page and confirm no fabricated selection appears in the Workbench panel. Test with a logged-out provider to ensure errors and sign-in behavior remain comprehensible.
