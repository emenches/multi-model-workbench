# Cogitor UI pass: acceptance checklist

**Base:** `fix/dark-only-startup` (draft PR #36). All changes are staged in a separate, unmerged UI PR.

## Requested user experience
- App/native title and sidebar say **Cogitor**. Keep the original Tauri app identifier and data storage keys to preserve signed-in provider sessions and conversation history.
- The Activity panel opens by default and shows actual workflow steps when a workflow runs. No fabricated progress or activity.
- Transcript body uses at least 16px effective text at the default settings, retains user font preferences, and remains readable in the compact app window.
- The project/chat sidebar defaults to 304px, can be resized 220–480px by pointer or keyboard arrows/Home/End, and saves its user preference. Collapsing and expanding should not reset the saved width. Conversation titles remain tooltipped when truncated.
- User questions and AI messages show the local creation timestamp below each bubble. Save/reopen retains the original times. Historic messages without timestamps show no invented date.
- Clicking Coding/Debate/Consult/Roundtable/Brainstorm in workflow selection opens the existing role-assignment editor for that mode. The editor may be entered even if some agents are not Ready.
- The user can choose **Use connected agents**, which maps serial workflow roles onto currently Ready agents. With 3 Ready agents, a 4-role serial workflow should run with one reused provider. Consult still requires two distinct Ready agents for the initial parallel stage.
- Save persists custom role assignments, and the next workflow honors them. Do not silently run a workflow with missing required providers if no valid assignment exists.

## Desktop smoke test before merge
1. Cold-start Cogitor. Verify Activity is initially open, sidebar is wider, icon/title remains correct, no white flash, and Claude session is still signed in.
2. Resize sidebar to narrow and wide positions, reload, collapse/reopen, verify retained width. Navigate 20+ conversations including long titles and project nesting.
3. Send a simple chat message, confirm a question timestamp and an answer timestamp. Open another chat, return, restart, confirm neither time was replaced by current time.
4. Click the **Agents & settings** action with Coding selected. Confirm its role editor is expanded and visible. Configure a fourth Coding role to reuse one of the 3 Ready providers; save; run Coding; inspect all steps in Activity.
5. Test Debate, Roundtable, Brainstorm with role reuse. Test Consult with two providers and confirm initial responses remain independent. Simulate one provider becoming signed out and confirm no silent unsafe fallback.
6. Verify Gmail account switching and Claude right-click **Open** magic-link handoff remain as previously accepted. Do not share tokens/screenshots of email content.
7. Check minimum window (900px) and larger screens, window resize while Activity is open, and pointer/keyboard sidebar adjustments.

## Automated checks
```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec vitest run src/__tests__/app.test.ts src/__tests__/conversationSessions.test.ts src/__tests__/modeRoleAssignment.test.ts src/__tests__/sidebarWidthPreference.test.ts src/__tests__/i18n.test.ts
pnpm verify
pnpm tauri dev
```

GitHub Actions was not reporting runs in the prior security PR review. **Do not infer a successful build or macOS acceptance from committed tests alone.** Keep the PR draft until validation and user smoke tests pass.
