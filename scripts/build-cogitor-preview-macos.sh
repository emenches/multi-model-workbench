#!/bin/zsh
# Local fallback for the GitHub-hosted Cogitor preview installer.
# Run from a clone checked out at preview/cogitor-unified-macos.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Cogitor macOS previews must be built on a Mac." >&2
  exit 1
fi
if [[ "$(git branch --show-current)" != "preview/cogitor-unified-macos" ]]; then
  echo "Switch to preview/cogitor-unified-macos before building." >&2
  exit 1
fi
for command_name in pnpm cargo rustup; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing $command_name. Follow the setup steps in docs/COGITOR_PREVIEW_BUILD.md." >&2
    exit 1
  fi
done

pnpm install --frozen-lockfile
pnpm verify
cargo test --manifest-path src-tauri/Cargo.toml --lib
rustup target add x86_64-apple-darwin aarch64-apple-darwin
pnpm tauri build --bundles dmg --target universal-apple-darwin

output_dir="src-tauri/target/universal-apple-darwin/release/bundle/dmg"
dmg_file="$(find "$output_dir" -maxdepth 1 -type f -name '*.dmg' -print -quit)"
if [[ -z "$dmg_file" ]]; then
  echo "Build finished without a DMG at $output_dir" >&2
  exit 1
fi
printf '\nCogitor preview DMG: %s\n' "$PWD/$dmg_file"
shasum -a 256 "$dmg_file"
open "$output_dir"
