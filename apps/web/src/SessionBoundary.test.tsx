import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionBoundary } from "./SessionBoundary.tsx";
test("locked UI masks but retains the mounted application and draft instead of replacing its route", () => {
  const markup = renderToStaticMarkup(<SessionBoundary><section data-route="/persona/p1"><textarea defaultValue="keep my draft" /></section></SessionBoundary>);
  expect(markup).toContain('inert=""');
  expect(markup).toContain('data-route="/persona/p1"');
  expect(markup).toContain("keep my draft");
  expect(markup).toContain("<dialog");
  expect(markup).toContain('type="password"');
  expect(markup).not.toContain("localStorage");
});
