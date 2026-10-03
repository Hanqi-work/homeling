# patches

Additive diffs against the local Collie checkout (`~/.local/share/collie`, detached v1.14.2).

`collie update` runs `git checkout --force` and drops git-tracked edits (ADR-0002). These files are the source of truth; `scripts/apply-patches.sh` reapplies them after an update. Do not commit the edits into the Collie checkout.

| patch | what |
|---|---|
| `0001-lite-spa-fallback.patch` | `serveStatic`: extension-less `/lite` and `/lite/*` that miss on disk fall back to `web/dist/lite/index.html` instead of the root shell. Existing files and every other path are unchanged. |

Apply, then `collie build` and restart the bridge — static files are read from disk, but this change is compiled into the bridge binary.
