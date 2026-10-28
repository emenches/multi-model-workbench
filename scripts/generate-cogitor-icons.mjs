#!/usr/bin/env node
// Native icons use the approved flat master. Only macOS's .icns is inset,
// correcting Dock scale without shrinking Windows icons or the in-app mark.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const iconDir = join(root, 'src-tauri', 'icons');
const generate = (source, output) => execFileSync(
  pnpm,
  ['exec', 'tauri', 'icon', source, '--output', output],
  {
    cwd: root,
    stdio: 'inherit',
    ...(process.platform === 'win32' ? { shell: true } : {}),
  },
);

// Generate normal-size PNG, ICO, mobile and web assets as before.
generate('src/assets/app-icon.svg', iconDir);

// macOS Dock icons need transparent outer breathing room. Override only .icns.
const tempDir = mkdtempSync(join(tmpdir(), 'cogitor-mac-icon-'));
try {
  generate('src/assets/app-icon-macos.svg', tempDir);
  copyFileSync(join(tempDir, 'icon.icns'), join(iconDir, 'icon.icns'));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
