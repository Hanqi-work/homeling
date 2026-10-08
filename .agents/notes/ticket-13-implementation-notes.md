# Ticket #13 implementation notes

## Scope and seams
- User authorized public API, persistence, observer and UI seams. TDD: ActivityLedger public registration/observation/list/subscribe, in-process handleRequest, rendered ActivityPanel. No real Herdr/Collie/service.
- Independent workspace `homeling.ticket-13-activity`, base `ca826f05`; contract-only `03ca2959770fc3719549d64c896a32117311a317` test/typecheck/build green. #19 actual guard contract `a4750d622dd6dc8ad8508d386b0b0a65b69f1644` merged as dependency, not claiming #19 complete.

## Decisions
- Persist task ownership and events together. UUID occurrence identity separate from stable pane navigation ID; terminal completion/failure mutually exclusive; publish only after atomic commit. Subscribers live-only, explicit sequence catch-up, consumers persist own cursor/id.
- No snapshot-to-history reconstruction. Snapshots may scope subscriptions/check pane availability, never synthesize past task creation or completion.
- One-hand protocol evidence: local Collie HERDR_API.md lines 329–368 (subscription ack, snake_case wire vs dotted subscription, scoped status events; pane_exited has no exit code), bridge/mux/herdr/events.ts. Local herdr-board board-herdr/src/types.rs and events/parse.rs describe schema-verified protocol 19; socket fixture includes agent_status payload. No raw terminal failure field or replay cursor is proved. Done means observed agent completion, not process exit success.
- Pending notification occurrence mapping is owned by #15; request.id remains the #5 security identity. #13 supplies task ownership only, not a second approval protocol.
- #11 owns App/main shell. Deliver standalone ActivityPanel; coordinator wires slots.activity after green dependency.

## Actual integration and review
- Merged #19 actual narrow capability revision `9065918e`, pane-bound single-shot result registration `edcbd7db`, full HTTP/service guard `2bd32251`, cached-runtime fix `72f57330`. User task creation uses original admission dispatch; only returned pane ownership gets a resourceId-bound single atomic registration. Observer accepts exact `activity.observe` scope and cannot enroll tasks or write user launch failures.
- Found #19 cached `runtime.fetcher` retained a request admission; reported upstream; #19 supplied a red-green fix. Preserve cached runtime identity for persona queue serialization, but cache only unwrapped upstream fetcher.
- Task launch: createTab → durable result registration → pane-scoped subscription acknowledgement → launcher text/Enter (original user dispatch). Explicit refused launch can record failure with user admission; timeout/unknown/lock cannot fabricate process failure. Cleanup remains bounded to already-created pane.
- Observer startup awaits a durable restart gap before subscription; completed/working inference is limited to the same observation epoch. A new daemon or stream gap cannot roll historical completion into a new task; duplicate working does not create a new occurrence. Same-pane process incarnation is not available, so a work-cycle UUID is not a process/session identifier.
- Invalid persisted references, ownership, event identity, terminal outcomes and sequence fail closed rather than resetting history. Subscriber delivery follows atomic rename; isolated callback failure is logged and never changes persisted truth.
- Merged integration `3a322b2fc942b158e31ab97fbd02ea91315467cb` (#9) and #11 shell `ddd9d6bf`. Resolved conflicts preserving both #9 cancellation gate and #19 dispatch gate. Migrated old #8/#9 business tests to #19's real injected SessionController unlock fixture, not a bypass.
- Main shell wiring only adds lazy ActivityPanel to the frozen `slots.activity` seam. `/t/:paneId?occurrence=...` checks the durable occurrence before live access; old/terminal/unknown/wrong-pane/unavailable bindings render real recorded metadata, without fetching newer pane history or showing write controls. DOM regression confirms the reused-pane route requests only occurrence lookup.
- Complete production-wiring revision `2981dd6b585332b84e0fd5c0d3a8059d35f49c15`: 311 tests, full typecheck/build green; handed #15 for consumption while independent review and simplification continue.
- Optional `HOMELING_ACTIVITY_PATH` defaults to `activity.json` alongside `HOMELING_REGISTRY_PATH`; sent coordinator for final README environment table, do not overwrite the README owner's work.
- Loaded and executed modern-web-guidance search/list/accessibility; installed skill reported stale version. Kept native list/link/time semantics, coarse-friendly targets, focus outline and abortable serial polling; did not alter user skill configuration.

## Deviations and remaining validation
- Herdr pane exit cannot prove failure; represent unknown. Explicit launch failures can be recorded as failed only for a registered launch occurrence. Stream disconnect/restart leaves durable gap/unknown; no invented completion during downtime.
- Real device/source-version behavior remains human acceptance; no actual service started.
