# Claude: clean WebKit authentication smoke test

**Status:** experimental macOS patch; manual test required before merge.

## Proven in the separate native probe

On 2026-10-27 the user successfully completed email/magic-link authentication
in an unmodified Swift `WKWebView`, without an extension or API key.
The probe has its **own** WebKit website data store. Its authenticated
session will **not** transfer to this Tauri application.

## What this branch changes

- Claude no longer receives Workbench's document-start `BOOTSTRAP_JS`.
- Claude no longer receives the all-frames `PERMISSION_SHIM_JS`.
- Claude's post-login automation bridge is installed only when an explicit
  `https://claude.ai/new` or `https://claude.ai/chat/{id}` route **and**
  a usable ProseMirror composer are present. The DOM probe only tests element
  existence and never reads text, passwords, cookies or authentication data.
- The bridge installer can also be triggered by title changes so client-side
  navigation after authentication is not missed.
- Trusted host evaluation into Claude's login, account, settings, SSO, or
  other non-conversation routes fails closed.
- No browser extension, credential relay, or model API key.

**Caveats:** WebKit embedded in Workbench is not necessarily identical to the
probe: Tauri still uses its existing native navigation and popup callbacks.
A successful login in the probe does not prove this branch fixes Workbench.
A WebView controlled by a desktop application is not a hard credential
isolation boundary. This is a targeted authentication-compatibility test,
not a completed security audit of all post-login automation.

## How to test on macOS

Checkout `fix/claude-clean-webkit-login` (or its PR) from a local clone of
`emenches/multi-model-workbench`, and run:

```sh
pnpm install
pnpm tauri dev
```

Tauri's beforeDevCommand builds the injected bundle automatically.

1. Open **Claude** from Workbench's connected-agent UI; select **Sign in**.
2. Use **Continue with email**. The first pass condition is that the
   email address is accepted without “Couldn't verify your browser.”
3. Complete the magic link using the email/code method provided by Claude.
   If opening the link in the external browser doesn't authenticate the
   Workbench WKWebView, follow Claude's verification-code instructions in
   the Workbench window. Do not paste a login link or a code into issues,
   logs or test reports.
4. Verify Claude's normal chat UI loads in the Workbench native provider window.
5. Verify Workbench eventually shows Claude **Ready**. If it doesn't, note the
   current URL and whether the chat composer is visible; reload once and
   report a generic status without credentials or screenshots of login links.
6. Send a **new** benign short prompt in Workbench and confirm the reply is
   visible in **both** Claude's page and Workbench's transcript. Do not
   automatically retry if the Claude page has already received the prompt.
7. Close/reopen the provider window and restart Workbench to test session
   persistence. Note any login regression for a later per-provider macOS
   `data_store_identifier` migration.

## Non-goals and deferred work

- No browser-engine replacement and no Safari session sharing.
- No credential copying from the native probe or external browsers.
- No changes to other providers' bridges.
- macOS `data_directory` is unsupported by WKWebView; correct
  `data_store_identifier` usage needs a separate migration and regression
  test, since changing a store can sign users out.
- No attempt to evade a provider security check or misrepresent the app.
  Provider terms/permissions for subscription-powered third-party automation
  still require independent evaluation.

## Automated coverage

Rust unit tests assert that Claude's document-start scripts are disabled,
that authentication/account URL paths cannot qualify for the bridge, and
that known conversation routes do qualify. Full behavior requires a macOS
WKWebView test with a consenting test account and must not collect credentials.
