# Two-provider Consult

## Behavior
Consult now needs **two distinct, signed-in, currently ready providers**. With only one provider, the Consult send action remains blocked. This does not relax the parallel-collision rule.

The existing four-step graph remains unchanged:
1. Provider A and Provider B answer independently (parallel).
2. Reviewer examines and corrects both initial answers.
3. Summarizer synthesizes the initial answers and review.

With exactly two providers, the later reviewer defaults to A and the summarizer defaults to B. These are sequential roles, so no concurrent sends target the same provider. With three or four connected providers, configured reviewers and summarizers are preserved when available, while unavailable roles are filled from connected providers.

Routing is **per run** and does not overwrite the user's role settings. Provider-ready state and the selected active provider lineup determine eligibility, not just a saved login from a previous session.

## Files
- `src/ui/consultAvailability.ts`: ready-provider enumeration and role assignment.
- `src/App.tsx`: aligned readiness, preflight, and execution routing.
- `src/ui/PresetCatalog.tsx`: accurate Consult 0/2, 1/2 or 2/2 ready indicator.
- `src/__tests__/consultAvailability.test.ts`: minimum, 2/3/4 providers, settings preservation, duplicate and inactive providers.

## Verification
Run `pnpm verify`, then `pnpm tauri dev`. Sign in to two providers. Select Consult, submit a question, confirm first two independent outputs are produced, then the reviewer and summary steps complete. Confirm a single connected provider cannot start Consult. The live provider flows are not guaranteed by unit tests.
