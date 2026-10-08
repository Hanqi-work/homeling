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

## Deviations and remaining validation
- Herdr pane exit cannot prove failure; represent unknown. Explicit launch failures can be recorded as failed only for a registered launch occurrence. Stream disconnect/restart leaves durable gap/unknown; no invented completion during downtime.
- Real device/source-version behavior remains human acceptance; no actual service started.
