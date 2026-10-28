# Multi-Model Workbench fork

## Goal
Extend the MIT-licensed Multi-AI Chat Desktop application with local project context, research provenance, and eventually permission-controlled coding tools. Retain the upstream provider webviews and graph-based collaboration runtime. Keep the existing LICENSE and NOTICE.md.

## Milestone 1: persistent project context
- Project selector and editor within the existing workflow control shelf.
- Up to 100 local projects with 16 KB of editable project instructions per project.
- Project data stored in the app data directory (workbench-projects-v1.json), using the existing atomic write helper.
- Selected project context is included in the existing workflow context argument; it is not added to the visible user message.
- Provider sessions and conversation history are unchanged. Conversation history is **not scoped to project** in M1: start a new conversation on project change to avoid carrying the previous conversation into another project.
- No general-purpose local file browsing, code execution, source verification, or source indexing yet.

## Security and constraints
- The new Rust commands accept calls only from the trusted control webview.
- Only the trusted control webview receives the new Tauri permissions; remote provider pages receive none.
- Project data stays local until you run a workflow; then project name/instructions are sent to the selected providers as part of the request.
- Provider website automation is subject to the providers' own terms and may break when websites change. Do not bypass authentication, security measures, or rate limits.
- No diagnostic or telemetry upload added.

## Validation
Run `pnpm install --frozen-lockfile`, `pnpm verify`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `pnpm tauri dev`.
Inspect project creation, switching to no project, persistence after app restart, and the context received by providers. Full desktop runtime tests require a local GUI and provider logins.

## Milestone 2: project-centered research
- Link conversations to projects with backward-compatible migration.
- Source metadata, citations, vetted claims, conflicting evidence and decisions.
- Bounded context composer to avoid sending an entire project history.

## Milestone 3: controlled build tools
- Local repository chooser and read-only source browser.
- Staged patches in independent Git worktrees, visible diffs, and confirmation before writes.
- Sandboxed testing and explicit execution permissions. Remote provider pages never receive filesystem or shell access.
