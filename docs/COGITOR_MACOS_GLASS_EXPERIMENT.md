# Cogitor macOS glass experiment — visual acceptance

**Scope:** experimental presentation-only change; base `preview/cogitor-unified-macos`. This is not a public release, not native macOS 26 `NSGlassEffectView`, and not a replacement for the independent PR #53 security acceptance.

## Visual choices

- A quiet translucent navigation layer: project and chat sidebar over an app-owned, subtly colored backdrop.
- Softly raised active conversation and New Chat controls.
- A compact translucent header and three-mode-ready segmented control styling. **The future Cogitor delegation mode is not activated by this PR**.
- Floating composer with softly lit edge; activity drawer and popovers styled as elevated materials.
- Conversation transcripts, code, images, provider websites, and editor text remain on readable ordinary surfaces.
- Preserve keyboard focus, 14–16 px content scale, session width, conversation persistence, and all current behavior.
- No new Tauri native permissions, native window transparency, third-party plugins, or `macOSPrivateApi` setting.

## Checks

1. macOS light appearance: check sidebar hierarchy, selected state, subtle glass edge, bright-background legibility, message and code readability.
2. macOS dark appearance: check white/gray text contrast over blur, active tab clarity, unread/stop/error states.
3. Reduce Transparency and Increase Contrast in macOS Accessibility: glass should become solid, text and controls should remain distinguishable. Also inspect focus with keyboard navigation.
4. Window sizes: 900x580 minimum and 1480x900 default; collapse/resize the sidebar; open Activity drawer and Settings.
5. Run Simple Chat and Consult; confirm no layout change breaks click targets or scrolling. Login/provider WebViews must remain visually untouched.
6. Confirm no glass class on Windows/Linux and no style override in opt-in AI-Sister theme.
7. Compare with preview baseline side by side before committing to design or investigating native vibrancy.

## Rollback and release boundaries

Remove the `src/mac-glass.css` import and class enabling from `src/main.tsx` to restore the previous appearance. The additional CSS is never loaded in remote provider pages.

Do not interpret styling as system-supplied native Liquid Glass. Native AppKit effects would need a further targeted implementation, older-macOS fallback, accessibility tests, and distribution review.
