import type { ReactElement } from "react";

interface RawPaneMirrorProps {
  text: string;
  loading: boolean;
  error: string | null;
  truncated?: boolean;
  fallback?: boolean;
}

/** Text-only mirror: no escape-sequence interpreter, terminal controls, or HTML injection. */
export function RawPaneMirror({ text, loading, error, truncated = false, fallback = false }: RawPaneMirrorProps): ReactElement {
  return (
    <section aria-label="原始 pane 镜像" className="mt-3 rounded-xl border border-neutral-700 bg-black p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-neutral-400">
        <span>{fallback ? "History text fallback · read-only" : "Pane screen · read-only"}</span>
        {loading ? <span role="status">Loading…</span> : null}
      </div>
      {error ? <p role="status" className="mb-2 text-xs text-amber-300">{error}</p> : null}
      {truncated ? <p className="mb-2 text-xs text-amber-300">Only the retained output tail is available.</p> : null}
      <pre data-testid="pane-mirror" className="max-h-[60dvh] overflow-auto whitespace-pre font-mono text-xs leading-5 text-neutral-200">{text}</pre>
    </section>
  );
}
