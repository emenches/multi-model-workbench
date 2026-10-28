# Workbench UX refresh — design direction

Status: proposed; implementation incremental. Do not replace the underlying Tauri/provider layout or workflow graph during the current macOS debugging phase.

## Problem
The existing UI presents many internal concepts (Echo transport panel, 2/4 badges, step traces, adapter controls, connection status and mixed tabs) simultaneously. It resembles an engineer-facing test harness, uses small crowded controls, and places provider webviews in a region where native WKWebView can obscure app buttons. The research and coding goal needs a calm user-first interface.

## Design goals
1. **Conversation first:** the main reading area owns most of the window. Clear typography, generous spacing, consistent chat composer. Workflows are presented as outcomes rather than graph mechanics.
2. **One sidebar, progressive disclosure:** left sidebar for projects and conversations, collapsible; mode switch near the composer. Keep source lists, research notes and coding actions out of casual chat.
3. **Provider rail:** a compact provider lineup (name, signed-in/ready/waiting and model if verifiably known), with native page preview opened on demand. Never let a provider page cover the workbench toolbar. Cmd+Shift+M still hides it.
4. **Consult as a readable sequence:** start with two verified connected providers. Show the initial answers side by side or stacked according to width, then Review, then Final answer. Collapse intermediate steps by default after completion but keep them inspectable.
5. **Research workspace:** separate Sources / Claims / Decisions panels with direct URLs, dates and provenance. Do not confuse AI-generated text with verified source references.
6. **Coding workspace:** choose repository, inspect plan, review diffs and explicitly approve edits or commands. Provider pages have no direct shell or filesystem access.
7. **Simple visual system:** native-feeling rounded fields, one accent color, readable 14–16px body text and responsive spacing. Accessibility and focus order verified on macOS.
8. **Advanced controls when requested:** model/effort selection only when the selected provider and option are actually verified. Otherwise show "Manage on provider page", not fake toggles.

## Proposed desktop layout
- Narrow collapsible left sidebar: Projects, Recent conversations, New conversation.
- Center (flexible): thread; prominent final answer; unobtrusive step progress under selected mode.
- Optional right inspector drawer: Providers / Sources / Workflow details / Debug. Closed by default.
- Input area: mode selector (Chat, Consult, Research, Code), model participants and compact send field.
- Developer diagnostics: only available in development builds and only after user opts in; excluded from normal chat transcripts.

## Mobile and narrow desktop
- One reading column, overlay drawers rather than simultaneous fixed panels.
- Provider native page remains in a dedicated measured region, with native menu escape available.
- Buttons maintain min 44px touch targets where possible; preserve typography and contrast.

## Staged implementation
- **UX-0:** remove automatic developer diagnostics from the transcript; fix Consult language consistency.
- **UX-1:** establish shell/sidebar/composer design tokens and simplify card hierarchy without changing Tauri boundaries.
- **UX-2:** Consult progress/result experience (two answers, review, final) and side-by-side comparison on wide displays.
- **UX-3:** dedicated research evidence and Git coding inspector, retaining explicit user consent gates.
- **UX-4:** verified per-provider model/effort controls.

Do not conflate model provider subscription limits or browser UI control with API entitlements. No false "ready" status, no CAPTCHA bypass, no silent file changes.
