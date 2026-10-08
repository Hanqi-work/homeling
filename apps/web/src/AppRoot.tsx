import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { App } from "./App.tsx";
import { SessionBoundary, SessionLockButton } from "./SessionBoundary.tsx";
import type { PersonaShellSlots } from "./shell-slots.ts";
const ConversationPage = lazy(() => import("./ConversationPage.tsx").then((module) => ({ default: module.ConversationPage })));
const TaskDetailPage = lazy(() => import("./TaskDetailPage.tsx").then((module) => ({ default: module.TaskDetailPage })));
/** Public composition seam shared by the production entrypoint and fake-server UI tests. */
export function AppRoot({ slots = {} }: { slots?: PersonaShellSlots }) {
  const shellSlots = { ...slots, settings: <><SessionLockButton />{slots.settings}</> };
  return <SessionBoundary><Routes>
    <Route path="/p/:paneId" element={<Suspense fallback={<main className="p-6 text-sm text-neutral-400">Loading conversation…</main>}><ConversationPage /></Suspense>} />
    <Route path="/persona/:personaId" element={<Suspense fallback={<main className="p-6 text-sm text-neutral-400">Loading conversation…</main>}><ConversationPage /></Suspense>} />
    <Route path="/persona/:personaId/p/:paneId" element={<Suspense fallback={<main className="p-6 text-sm text-neutral-400">Loading conversation…</main>}><ConversationPage /></Suspense>} />
    <Route path="/t/:paneId" element={<Suspense fallback={<main className="p-6 text-sm text-neutral-400">Loading task…</main>}><TaskDetailPage /></Suspense>} />
    <Route path="*" element={<App slots={shellSlots} />} />
  </Routes></SessionBoundary>;
}
