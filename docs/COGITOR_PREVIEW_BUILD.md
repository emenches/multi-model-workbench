# Cogitor macOS Preview

## This is a test branch, not a published installer

**Integrated source:** `preview/cogitor-unified-macos`, based on the Claude-login
and security-hardening branch with the Cogitor UI changes applied. It has an
ad-hoc signature, not Developer ID notarization. **Do not share this build with
general users until tests and the remaining security review are complete.**

A macOS-only GitHub workflow was added at
[`cogitor-macos-preview.yml`](../.github/workflows/cogitor-macos-preview.yml).
The workflow runs `pnpm verify`, Rust tests, universal Tauri compilation,
DMG mounting and code-signature verification, then uploads a
`cogitor-macos-universal-preview` artifact with the DMG and SHA256SUMS.txt.

### If GitHub Actions is enabled

Open this repository's **Actions** tab and look for **Cogitor macOS Preview**.
After a successful run on `preview/cogitor-unified-macos`, open the run,
download the **cogitor-macos-universal-preview** artifact at the bottom,
unzip it and open `Cogitor-preview-universal.dmg`.

**No workflow run or binary was available when this document was written.**
If no runs appear, open GitHub Settings → Actions → General and verify Actions
are enabled. GitHub may require further approval or an additional push event;
the tool permissions used to author this branch cannot trigger workflow_dispatch
or change repository Actions policy.

### Run the very latest source without installing a DMG

From the Cogitor repository, use:

```bash
git fetch origin
git switch preview/cogitor-unified-macos
git pull --ff-only
pnpm install --frozen-lockfile
pnpm tauri dev
```

If the local preview branch does not exist yet, use
`git switch --track origin/preview/cogitor-unified-macos` instead.
The `beforeDevCommand` automatically regenerates the native brand icons,
builds injected scripts and starts Vite. macOS will compile and launch a
development app without installing a DMG. Stop with Ctrl-C in the terminal.
The signed-in browser profile and settings use the existing app identifier:
do not run a release copy and dev copy against the same profile simultaneously.

### Local build fallback on your Mac

Prerequisites: Xcode Command Line Tools, Rust stable with Cargo, Node.js 22.13+
or 24+, and pnpm 11.

From your existing repository clone:

```bash
git fetch origin
git switch -c preview/cogitor-unified-macos --track origin/preview/cogitor-unified-macos
zsh scripts/build-cogitor-preview-macos.sh
```

If that local branch already exists, use `git switch preview/cogitor-unified-macos`
and `git pull --ff-only` instead. The script will build a universal macOS
installer under
`src-tauri/target/universal-apple-darwin/release/bundle/dmg/`.

The preview intentionally keeps the upstream bundle identifier
`com.tedh.multiaichat` to preserve local profiles. Back up the current app
and settings before replacing an installed production app; for an isolated first
look, launch the preview directly from its mounted DMG instead of copying it to
/Applications. macOS may warn about an unnotarized development build.
Use System Settings → Privacy & Security → Open Anyway only if you recognize
and trust the build you just created.

**What to test:** Activity drawer default open; chat/sidebar text size; drag
sidebar wider/narrower and restart; message timestamps and history;
Coding/Debate/Roundtable with 3 providers filling 4 sequential roles; Consult
with 2 distinct initial roles; and existing Claude/Gmail login magic links.
See [Cogitor UI acceptance](./COGITOR_UI_ACCEPTANCE.md).

If any automated check fails, do not install or distribute the resulting
artifact. Inspect the failing logs and correct the source first.
