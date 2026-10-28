# Cogitor naming and repository cutover checklist

**Decision:** The release name is **Cogitor**, with the approved flat orbital
icon and Modern Sans wordmark. Do not rename this fork or its bundle identifier
until the security and Claude-login preview series has passed testing.

## Already safe to display

- App `productName`, main window, page title, sidebar wordmark and native
  recovery menu should say Cogitor.
- Existing OS icon assets use Cogitor's orbital mark.
- In-app hover text, tooltips and About/help references should be checked for
  the former product name in each supported language.

## Deferred packaging and GitHub rename

The current Rust Cargo package/executable is named
`multi-ai-chat-desktop`, and its historical package description still bears
the old name. A developer build can therefore show that old name in the macOS
Dock/menu even though `tauri.conf.json` says Cogitor. The native library
crate and `src-tauri/src/main.rs` refer to the old Rust library symbol, so
renaming the package/lib requires a coordinated compile and packaging pass.

Before the public release:

1. Choose a unique, available GitHub repository name, likely
   `emenches/cogitor`, and check trademarks and licensing/attribution.
2. Rename the GitHub fork in repository Settings, then update its About text.
   GitHub may redirect older repository links, but explicit release URLs,
   issue templates, API URLs, CI docs and hardcoded upstream adapter paths
   must still be audited. Keep original MIT license and contributor credits.
3. Update `Cargo.toml` package name and description, library target,
   `main.rs`, lockfile metadata, script/artifact paths, release workflow,
   and any `pnpm` package identifiers together. Rebuild on all three OSs.
4. Preserve the Tauri bundle ID `com.tedh.multiaichat` initially so existing
   user settings, cookies, sign-ins and local chats continue working. A later
   bundle ID change would require an explicit data/profile migration and rollback.
5. Sign and notarize release installers. Check Finder, Launchpad, Dock hover
   label, menu bar, About, Windows installer, Linux AppImage and GitHub links.
6. Publish the security/privacy description only after its testable claims
   match a verified release commit, with limitations clearly stated.

## During development

The native executable tooltip may continue using the old Cargo package name.
A stale macOS Dock pin can also preserve an older application name; quit the
old app, use the current build and remove/re-pin the old Dock item when testing.
Avoid changing package/bundle IDs just to fix an intermediate preview tooltip.
