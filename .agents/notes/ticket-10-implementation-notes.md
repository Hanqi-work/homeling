# Ticket #10 implementation notes

## Scope and initial facts

- Implement the persona registry/create/recovery/message loop in the existing standalone daemon; keep Collie zero-touch and do not write under `~/.local/share/collie/`.
- Herdr wire contract was verified from `~/.local/share/collie/HERDR_API.md` and its client/adapter: NDJSON with string request IDs, one RPC per connection except `events.subscribe`; `workspace.create {cwd,focus:false,label?}`, `pane.send_text {pane_id,text}`, `pane.send_keys {pane_id,keys}`, and `session.snapshot {}`. The `workspace.create` response contains workspace/tab/root pane IDs.
- Herdr API does not provide a single "launch agent" method in the checked client; launch means creating/choosing an allowlisted launcher command and submitting it to a Herdr shell pane. Preserve launchers allowlisting by sourcing commands from the existing Collie launcher API, not accepting arbitrary client commands.
- Existing daemon already owns Origin/JSON checks for writes and the narrow Collie bridge proxy; persona routes must follow those same access checks.

## Decisions / deviations

- Initial edits were mistakenly made in the integration checkout. On coordinator correction, stashed all changes and moved them into `/Users/rolex/Documents/Codes/githubProject/MyProject/homeling.ticket-10-persona-loop`, a Worktrunk branch based on `integrate-v1`; main checkout is clean. The stash contained ticket #7 TaskDetail/RawPane work too, so those six files and related raw-pane/task-detail changes were handed off to `/tmp/t7-handoff/` and excluded from this branch.
- Registry records use atomic temp-file + rename persistence. Create flow must not publish a persona until workspace and main-pane launch succeed; on failure close/rollback resources when possible and return an explicit failure rather than leaving an incomplete registry record.
- Recovery uses persisted workspace/pane IDs plus `session.snapshot` as truth. Missing main panes are repaired using the launcher selection allowed for the persona; unreachable Herdr is surfaced rather than silently modifying registry state.

## Work log

- Read the issue, PRD §6, glossary and ADR-0001; confirmed existing source on `integrate-v1` includes snapshot, history, launch proxy and message reply capabilities from the ticket dependencies.
- Added `HerdrSocketClient` as an independent NDJSON one-shot client plus event stream. A memory Unix socket test exercises `workspace.create`, `tab.create`, send text/Enter, snapshot, close, rename, and events; no Herdr CLI writes or Collie filesystem edits.
- Registry mutations serialize the full read-transform-temp-write-rename operation; serializing only file writes would lose a concurrent upsert computed from stale state.
- During persona first-message injection, the actual pane transcript contains the system-prompt prefix. The daemon returns that exact submitted string as a confirmation hint so the existing history matcher can still confirm delivery against the transcript while the UI keeps showing only the user's text.
- Herdr has no workspace-close RPC. Failed creates close panes best-effort and persist an orphan marker for the remaining empty/unknown space; deletes close only the main pane and keep the space archived, not the task panes.

