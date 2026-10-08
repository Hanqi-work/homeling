# Ticket #18 implementation notes

## Scope and authorized seams
- Base integrate-v1 96bd5b2123bfd9d9e712c210a0b06495b9b053cc; isolated jj workspace/bookmark ticket-18-avatar-orbs. Main checkout and integration bookmark owned by merger.
- User authorized HTTP persona PATCH/list, durable registry reload/concurrent field patch, Customize DOM and shared PersonaAvatar rendering seams. Tests only DOM/mock/local fixtures; no browser or real services.
- Customization is an independent slot component. main.tsx receives only slot wiring; retain other slots and any session wrapper after integrating dependencies.
- Rename/avatar patches go through existing #10 registry atomic field patch; never send stale systemPrompt or prompt-injection fields.
- Orb only for fresh actual thinking state; paused/needsAttention/missing/stale/idle/blocked must remain static. Keep card/detail props compatible and extend conversation narrowly.
- #19 service admission dependency requested from implementer; no default system actor for user PATCH.

## Guidance
- React official Context7 controlled inputs/effect cleanup consulted. modern-web-guidance motion retrieved: compositor transform/opacity, static reduced-motion fallback. Installed skill warns outdated; no config mutation performed.

## Deviations
- jj workspace add --ignore-working-copy created empty workspace then failed to set its base. Only the new workspace was repaired with jj new at the explicit base; main checkout untouched.
