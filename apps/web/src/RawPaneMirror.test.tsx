import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RawPaneMirror } from "./RawPaneMirror.tsx";

describe("RawPaneMirror", () => {
  test("renders read-only, scrollable plain text rather than HTML or terminal emulation", () => {
    const html = renderToStaticMarkup(<RawPaneMirror text={"<script>alert(1)</script>\noutput"} loading={false} error={null} />);
    expect(html).toContain('data-testid="pane-mirror"');
    expect(html).toContain("overflow-auto");
    expect(html).toContain("font-mono");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("read-only");
  });

  test("keeps a successful empty screen empty instead of substituting history text", () => {
    const html = renderToStaticMarkup(<RawPaneMirror text="" loading={false} error={null} fallback={false} />);
    expect(html).toContain("Pane screen · read-only");
    expect(html).not.toContain("History text fallback");
    expect(html).toMatch(/data-testid="pane-mirror"[^>]*><\/pre>/);
  });

  test("labels transcript content as a fallback", () => {
    const html = renderToStaticMarkup(<RawPaneMirror text="retained transcript" loading={false} error="pane unavailable" fallback />);
    expect(html).toContain("History text fallback");
    expect(html).toContain("retained transcript");
    expect(html).toContain("pane unavailable");
  });
});
