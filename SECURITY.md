# Cogitor Security Policy (Preview)

Cogitor is an independently maintained fork of [Multi-AI Chat Desktop](https://github.com/TED-H-com/multi-ai-chat-desktop). This document describes **Cogitor**, not the upstream author's security reporting process. The fork's previous policy referenced the upstream author's email; **please do not send Cogitor-specific reports or private data to that address**.

## Supported builds

| Build | Security status |
| --- | --- |
| `preview/cogitor-unified-macos` | Active pre-release testing; security fixes reviewed here before a public release |
| Cogitor public release | Not yet published |
| Older experimental / development builds | Not supported for public use |
| `main` | Historical fork baseline; do not assume it contains the reviewed preview hardening |

No independent penetration-test certification or security-response SLA is claimed. A green CI build is not a substitute for security review.

## Report a vulnerability privately

Do **not** open a public issue or pull request containing exploit steps, session tokens, email contents, cookies, conversation text, provider HTML, or local profile files.

1. Look for the repository's **Security → Report a vulnerability** option at [Cogitor's Security page](https://github.com/emenches/multi-model-workbench/security). Use private reporting if GitHub has it enabled.
2. If private reporting is unavailable, contact the maintainer using a **privately published** contact channel on the [repository owner profile](https://github.com/emenches). Do not send sensitive details through a public GitHub comment. An alternate secure reporting channel must be arranged before exchanging tokens, logs or reproductions.

For a report, include the version/commit, OS, installation type, expected and observed security boundary, and a sanitized test-data reproduction. Never provide actual session secrets.

## Current security boundaries

- Remote provider pages are untrusted. Their `ai-<provider>` WebViews and auxiliary login windows have **no Tauri command capability**; only the bundled `main` control view receives commands. Native Rust commands check the calling WebView.
- Provider control uses allowlisted native **typed actions** instead of forwarding arbitrary JavaScript supplied by the control UI. Provider page-origin and readiness checks still apply.
- Adapter downloads and cached remote overrides are **off by default**. Opt-in adapters are constrained JSON, must stay within bundled provider URL scopes, use restricted HTTPS redirects and size caps, and do not grant new Tauri capabilities.
- Settings, saved snapshots, checkpoints and adapter caches are local. New files use restrictive owner-only permissions on Unix, bounded reads reject oversized files and symlinks, and the app does not intentionally delete unreadable legacy user data. This does **not** imply all historic files have been migrated to owner-only permissions.
- Provider sessions use OS-managed embedded browser profile data. Cogitor does not ask for provider passwords directly; users sign into the real provider site.
- The control UI uses a production Content Security Policy. Developer builds use a different local-server configuration.
- There is no separate Cogitor cloud account or conversation server. Local histories, cookies and profile data are **not claimed to be end-to-end encrypted or Keychain-encrypted**. A compromised local account or native host can expose local data.
- The preview macOS DMG is **ad-hoc signed, not Apple Developer ID notarized**. Code signing verification alone does not establish publisher identity.

Provider service changes, OAuth/account lockouts, provider usage rules, embedded WebKit vulnerabilities, the user's OS account and third-party provider websites remain relevant external risks.

## 繁體中文摘要

本文件適用於 **Cogitor 分支**，不代表原始專案的作者。請勿公開張貼登入 cookie、token、對話內容或漏洞利用細節。若 GitHub Security 提供私密漏洞回報功能，請優先使用；否則先透過維護者公開的聯絡方式建立私密通道。遠端供應商 WebView 沒有 Tauri 命令權限；遠端 adapter 更新預設關閉。使用者資料儲存在本機，但並不宣稱採用端對端或 Keychain 加密。macOS 預覽版尚未經過 Apple 公證。
