# Claude Chrome companion: credential-access security gate

**Status: design gate only. Not authorized for release or user installation.**
**Goal:** reuse the user's existing **Claude.ai subscription** via an authenticated Chrome conversation tab. No Claude API keys, sign-in interception, or credential sharing.

## What we can and cannot promise

A Chrome extension with permission to execute content scripts on a website can technically access the DOM on pages where those scripts run. This can include sensitive fields, even without the `cookies` permission. Therefore **never describe website access as a categorical browser-enforced inability to read passwords**. A malicious extension update or a compromised permitted page can defeat a mere promise not to read credentials. The only categorical zero-credential-access option is not to grant an extension access to credential-bearing pages at all (and to keep a manual/no-extension fallback).

The **v0.1.1 experimental extension is not safe enough to ship** as the finished product: it uses `tabs`, `scripting`, and `https://claude.ai/*` in `host_permissions`, allowing broad site access and dynamic script injection. The user should disable/remove that prototype after completing the transport test.

## Mandatory security contract before implementing a companion

1. **No login-page access.** Never attach a content script on `/login`, `/signup`, `/auth`, `/oauth`, account, billing, or other sensitive pages. Match only verified Claude conversation routes (candidate paths: `/new` and `/chat/*`, subject to real-world validation). Reject all other origins, paths, embedded frames and redirects. Re-check the URL immediately before **every** DOM read, edit, or response capture, including SPA route changes, and fail closed if the page becomes sensitive.
2. **Minimal Chrome permissions.** Prefer **static, path-scoped content scripts** with no `host_permissions`, `scripting`, `tabs`, or general-purpose dynamic injection where the browser's behavior allows the needed tab discovery. Only request the narrowly necessary communication permission (e.g. `nativeMessaging`) and any justified session state capability. Do not request `cookies`, `debugger`, `webRequest`, `history`, `identity`, `management`, `clipboardRead`, `<all_urls>`, or unrelated hosts. Confirm actual effective permissions in Chrome; narrowing match patterns does not necessarily make Chrome's user-facing site-access warning path-specific.
3. **Read only the conversation controls.** Content scripts may inspect the specific **Claude message composer** for ready/draft verification and the specific **assistant response containers** for a request sent by Workbench. No generic DOM dump, blanket body text, page HTML, arbitrary selectors from the native app, text inputs outside the composer, password fields, account menus, cookies, localStorage, sessionStorage, or fetch/XHR interception.
4. **No credential flow in Workbench.** Never prompt for or relay passwords, one-time codes, email-login links, MFA challenges, session cookies, bearer tokens, auth headers, or API keys. Sign-in remains entirely in Chrome's normal first-party Claude page and is not instrumented.
5. **Local native transport.** Prefer Chrome's **Native Messaging** API, with a per-extension-ID `allowed_origins` allowlist, a small versioned JSON schema, explicit pairing/opt-in, limited message sizes, and only named commands (`status`, `send_once`, `stop`) and events (`ready`, `chunk`, `done`, `error`). No arbitrary JavaScript evaluation, browser-wide inspection, network proxy, or generic automation API. Do not start a localhost socket listener by default.
6. **Never resend uncertain submissions.** Every send has a single-use, bounded request ID; after a possible click, failure reports `submission_uncertain` and requires explicit user inspection or confirmation. Never auto-click Send again.
7. **No telemetry or remote endpoints.** Allow no outbound destinations from the companion except first-party claude.ai requests made by Claude itself (not by the extension). Workbench receives only prompt text it authored, the captured reply, and safe status/error metadata. No password or token-shaped fields in messages or logs.
8. **Transparent revocation.** Enable Claude-through-Chrome only with explicit user opt-in. Provide visible connection state, Pause/Disconnect, and removal instructions. Extension must stop accessing Claude when disconnected, and must not run in incognito by default.
9. **Open-source and testable.** Ship readable source, packaged-build reproducibility information, prominent permissions disclosure, reviewer documentation, and automated assertions blocking forbidden permissions/imports/hosts/auth routes, plus tests for redirects, login overlays, content-script reconnects, background service-worker restarts, and duplicate-send prevention.
10. **Security review before merge.** Perform independent source/manifest review and real macOS Chrome testing. No release until the verified implementation meets the contract and the remaining site-permission caveat is explicitly disclosed.

## Preferred architecture

```text
Workbench Tauri workflow engine
       │ only schema-validated prompt/result/status
       ▼
Chrome Native Messaging host (locally installed and origin-allowlisted)
       │
       ▼
Small, explicitly enabled Chrome extension
       │ content script on permitted Claude conversation routes ONLY
       ▼
The user's already-authenticated Claude.ai conversation page
```

**Not covered by this design:** transporting credentials or cookies, bypassing Claude login checks, using Claude API keys, or claiming a zero-risk guarantee from browser permissions. Chrome extensions that read an AI conversation necessarily have the capability to read permitted page content. If the user requires a strict technical impossibility of reading any sensitive on-page data under any extension compromise, do **not** deploy the extension; provide an extension-free manual workflow instead.

## Gate tests to write before enabling

- Manifest has no `cookies`, `scripting`, `tabs`, `webRequest`, `debugger`, `identity`, `history`, `<all_urls>`, or generic wildcard hosts.
- Content script never executes on login, sign-up, auth, SSO, billing, account, settings, or unrelated origins, even when reached via SPA transitions.
- The code contains no generic page-script evaluator, cookie/storage reads, password-input selectors, network interception, or DOM serialization.
- After one click, a missing acknowledgment or disconnect does not result in a second automatic send.
- Native host accepts only the designated signed extension ID, validates every message, and has no always-on TCP/HTTP/WebSocket listener.
- A manual macOS Chrome test confirms Claude subscription authentication, one-shot send, response receipt, reload/reconnection behavior, and user-directed disconnection.

## Sources

- Chrome permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- Chrome native messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Chromium security FAQ (site DOM access): https://chromium.googlesource.com/chromium/src/+/main/extensions/docs/security_faq.md
