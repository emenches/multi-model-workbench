# Workbench layout + Consult status & Gemini popup cleanup (October 2026)

## User-visible changes

1. **Native page geometry hidden by default.** Size/position details are displayed only after explicitly enabling developer Diagnostics; they no longer occupy the conversation header on every native page open.
2. **Large workflow chooser.** The compact mode dropdown and cramped sidebar grid have been replaced by a proper focus-trapped modal with six large, explanatory workflow choices. It opens from the conversation's Mode control or sidebar **Tools & modes** action. The conversation is blocked while choosing a workflow, Escape/backdrop/Close dismiss.
3. **Left-pane layout.** Remove the `max-h-[42vh]` scroll restriction and `mt-auto` provider docking that left a huge unused middle region. Keep Project Workspace and Providers together, with one overflow region only when the entire pane is genuinely too small.
4. **Workflow progress always visible.** Remove nested disclosure and duplicated trace heading. Steps remain inspectable and retain individual provider/source detail dialogs.
5. **No stale parallel waiting banner.** The old orange `Waiting on Gemini: 395s` badge was the **last emitted countdown** from any parallel step, not the actual set of providers still waiting. Remove that banner while retaining the proper timeout/retry/cancel dialog at a real timeout. Live workflow progress is authoritative for step confirmation.
6. **Gemini browser popups.** Automatic external system-browser handoff is disabled for Gemini, ChatGPT, Claude and Meta. Only the exact recognized Grok auth return may hand off. Gemini provider-app duplicate popups are denied, but allowlisted OAuth/SSO popup windows remain available.

## Consult response correlation

The earlier trace marked a row Done directly on a provider `RESPONSE_DONE`. A user observed Gemini Done in the trace while the workflow still waited for Gemini. This could occur if the response event was stale/orphan or not accepted for the current waiter.

A waiter now publishes `WORKFLOW_STEP_CONFIRMED` with the **reserved provider turn** only after it consumes `RESPONSE_DONE`. The trace marks the matching role Done only on that confirmation; raw chunks and raw DONE show unconfirmed text. It also handles nested bus callback event ordering without duplicating free-response rows.

The backend response-completion detector is **not** artificially advanced. If the provider visibly finishes but the workflow never accepts DONE, it will still time out and offer recovery. The point of this change is to prevent false progress and expose the underlying bridge issue accurately.

## Validation checklist

```bash
git fetch origin
git switch fix/workbench-mode-modal-and-gemini-popups
pnpm verify
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm tauri dev
```

- Native ChatGPT and Gemini pages stay in their working permanent full-size windows.
- Real page geometry is invisible unless dev Diagnostics is explicitly enabled.
- Workflow chooser opens over chat, larger card descriptions are readable and keyboard Escape returns focus. Confirm Consult is selectable with 2 ready providers.
- Project Workspace and Providers appear adjacent, without the enormous empty middle gap or an artificially limited scroll shelf.
- Workflow progress stays visible throughout a two-provider Consult; a raw provider result without a matched waiter is **not** marked Done.
- Gemini finishes early while ChatGPT is still responding: no stale `Waiting on Gemini` orange banner; real timeout recovery still appears when needed.
- Gemini doesn't spontaneously open additional system-browser tabs or duplicate app popups. OAuth sign-in remains functional.
- Check whether ChatGPT and Gemini briefly display Checking during sends; this patch **does not** alter their actual connection bridge. Capture provider status + a sanitized host URL if Checking persists.

## Scope

This branch changes UI/progress and popup behavior, not the already proven native-page creation architecture. No provider terms bypass, no raw prompts logged, no fabricated Done or Ready signals. Tests still require actual local execution on macOS.
