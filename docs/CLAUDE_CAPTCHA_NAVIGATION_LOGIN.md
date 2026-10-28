# Claude native login: observed CAPTCHA navigation fix

**Status: draft; macOS end-to-end verification required before merge.**

## Evidence from controlled tests on October 27, 2026

| Experiment | Outcome |
| --- | --- |
| Clean native Swift WKWebView | Email magic-link login succeeded |
| Bare Tauri WebViewWindow, default and fresh stores | Both succeeded |
| Bare Tauri child WebView, visible and hidden-first parent | Both succeeded |
| Tauri child with Workbench browser builder options only | Succeeded |
| Tauri child with current Workbench navigation allowlist | **Failed** browser verification |
| Same navigation allowlist evaluated in audit mode (no denials) | **Succeeded** |

The audit window recorded **only these denied destinations**:

```text
scheme=about host=(no-host)
scheme=https host=newassets.hcaptcha.com
```

These are auxiliary challenge documents and hCaptcha assets. The user's login
success with navigation *not* cancelled is evidence that Workbench's
`on_navigation` policy may have broken Claude's legitimate verification
flow. hCaptcha explicitly identifies `newassets.hcaptcha.com` as a real asset
hostname in its developer docs: https://docs.hcaptcha.com/

## Changes

1. Extend existing auxiliary-navigation exception **for Claude only** to:
   - `about:blank`, `about:srcdoc` (no query);
   - HTTPS URLs whose exact hostname is `newassets.hcaptcha.com`, with no
     userinfo or nondefault port.
2. Keep existing navigation rules for other providers, and continue
   rejecting all other unknown hosts and schemes. Do not open denied URLs in
   the system browser.
3. Retain the earlier clean-login hypothesis code from the closed PR #40:
   - No `BOOTSTRAP_JS` or `PERMISSION_SHIM_JS` on Claude document start;
   - A read-only composer-presence check only on recognized conversation
     routes before installing the existing chat adapter;
   - No cookie/token/password reads or transfers.
4. Add positive and negative Rust unit tests for allowed and disallowed
   URLs, including phishing-like suffixes, HTTP, custom ports, query-bearing
   `about:` URLs and other-provider behavior.

This deliberately does **not** allow `*.hcaptcha.com` or every `about:`
scheme at production runtime. hCaptcha notes that asset subdomains can vary
over time or by region. If Claude later requires another legitimate host, add
it only after a similarly privacy-preserving local test.

## Mac validation

Check out `fix/claude-captcha-navigation-login` from the Workbench repo:

```sh
git fetch origin
git switch fix/claude-captcha-navigation-login
pnpm tauri dev
```

In the **normal Claude provider window** (not the debug-only audit):

1. Open Workbench → Claude → Sign in.
2. Enter your email and confirm Claude reaches the magic-link step.
3. Complete sign-in in the Workbench browser session; never share codes or
   magic links in an issue/chat. If a normal-browser link is opened outside
   Workbench, use Claude's supported original-device verification-code flow.
4. Verify Claude's composer and **Ready** status.
5. Send one harmless test prompt; verify the answer reaches **Workbench's
   own chat transcript**. If it appears only on Claude's page, **do not
   resend**; record that capture failed.
6. Restart Workbench and check sign-in/session persistence.

**Expected outcome is a hypothesis, not yet a verified fix.** No actual macOS
compilation or integration test was possible in the GitHub connector environment.

## Security and product boundaries

- No browser extension, browser fingerprint spoofing, login bypass,
  API keys or credential extraction.
- This narrow navigation allowance does not weaken other provider policies.
- An embedded browser is controlled by the desktop app and does not provide
  browser-enforced credential isolation; a security review is still required
  before making promises about credential access.
- The use of existing Claude subscriptions in third-party automation must be
  assessed against Anthropic's current third-party usage guidance before
  public launch. Passing browser login does not establish provider permission
  for subscription automation.
