# Cogitor approved visual identity

Status: **Selected for preview**. This file describes the production UI icon/wordmark, not a claim of trademark clearance.

- Icon: simplified orbital eye; a flat orange central disk with a small cream highlight, three short cream orbit segments, and three orbital dots.
- Base palette: orange `#E38B45`, cream `#EFE6D3`, charcoal `#1A1612`. No gradients, shadows, or glossy effects in static assets.
- Selected lettering: **03 / Modern Sans**. In the desktop UI, uppercase **COGITOR** with balanced tracking, medium-to-semibold weight, and the platform sans-serif stack (SF Pro/Inter/Segoe UI). No novel proprietary font dependency.
- Idle: fixed, clean icon with no glow and no movement. No motion in macOS Dock, menu bar or platform icon files.
- While a response/workflow is running: only the orange center and its small cream highlight ease through a very subtle pulse (2.8-second cycle). The orbit never spins. Users requesting reduced motion get a still icon.
- Canonical master: `src/assets/app-icon.svg`; the same geometry is used by `src/ui/CogitorMark.tsx` for animated UI state.
- Native iconset: auto-generated from the master with `pnpm brand:icons` as part of both `tauri dev` and `tauri build`.
- Preserve the current native bundle identifier and local data paths; cosmetic branding must not sign users out or discard history.
