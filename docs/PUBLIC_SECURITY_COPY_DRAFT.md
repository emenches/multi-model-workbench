# Cogitor: public security and privacy copy (NOT YET APPROVED FOR README)

**Gate:** Publish to GitHub README/About or a public security page only after the dependent security changes (PR #44 and its underlying Claude login PRs) are merged, build and platform tests are green, and the real Mac user-flow smoke tests pass. This draft is not a security certification or an independent audit.

## Suggested future Security & Privacy section

> **Built with clear boundaries.** Cogitor lets you work with AI services through their own signed-in pages, rather than requiring API keys in Cogitor. Provider and email pages are not granted the same native command permissions as Cogitor's local control pane. Sensitive local settings and saved workflow files are created with owner-only permissions on macOS and Linux. Adapter download URLs and redirects are restricted to the expected HTTPS host, and downloaded adapter data is size-limited. Cogitor does not need to copy your email password or magic links into its chat transcript.
>
> **Important limitations:** Cogitor controls embedded browser windows and runs automation scripts in supported provider pages; this does not create a hard credential-isolation boundary against a compromised native app. Conversations and resume information may be stored locally in plaintext. Provider adapter definitions can be updated from a remote upstream source. These are meaningful trust considerations and remain areas of ongoing hardening. You can review source and the security review before using the app.

## Launch transparency checklist

- Confirm the actual landed implementation for each statement; change wording if it differs.
- Confirm URL/capability tests, Rust tests and clippy on Windows/macOS/Linux, frontend tests, and normal Claude/Gmail login + 3-agent Consult on macOS.
- Resolve or disclose high-risk findings: auto-applied mutable adapter updates and arbitrary JS evaluation IPC. Publishing this section does **not** imply those risks are eliminated.
- Never claim zero tracking beyond actual verified telemetry config, never claim end-to-end encryption, secure credential isolation, independent audit, or comprehensive vulnerability-free status without evidence.
- For the GitHub About description (short): **“Cogitor: a desktop workspace that helps your connected AI assistants collaborate, compare, review and reason together.”**
- Retain original upstream authors' MIT attribution and licensing notices; product rebrand does not rewrite provenance.
