# Cogitor approved visual identity

Status: **Selected for preview**. This file describes the production UI icon/wordmark, not a claim of trademark clearance.

- Icon: simplified orbital eye; a flat orange central disk with a small cream highlight, three short cream orbit segments, and three orbital dots.
- Base palette: orange `#E38B45`, cream `#EFE6D3`, charcoal `#1A1612`. No gradients, shadows, or glossy effects in static assets.
- Selected lettering: **03 / Modern Sans**. In the desktop UI, uppercase **COGITOR** with balanced tracking, medium-to-semibold weight, and the platform sans-serif stack (SF Pro/Inter/Segoe UI). No novel proprietary font dependency.
- Idle: fixed, clean icon with no glow and no movement. No motion in macOS Dock, menu bar or platform icon files.
- While a response/workflow is running: only the orange center and its small cream highlight ease through a very subtle pulse (2.8-second cycle). The orbit never spins. Users requesting reduced motion get a still icon.
- Canonical master: `src/assets/app-icon.svg`; the same geometry is used by `src/ui/CogitorMark.tsx` for animated UI state.
- Native iconset: `pnpm brand:icons` generates all standard-size platforms from the master and overrides **only** macOS `icon.icns` using `src/assets/app-icon-macos.svg`, inset 52px on a 512px transparent canvas (79.7% artwork width). This prevents an oversized Dock icon; the in-app mark and Windows icons remain unchanged. The icon generator runs before both `tauri dev` and `tauri build`.
- Preserve the current native bundle identifier and local data paths; cosmetic branding must not sign users out or discard history.
