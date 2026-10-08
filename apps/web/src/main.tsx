import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { App } from "./App.tsx";
import { PersonaMemoryEditor } from "./PersonaMemoryEditor.tsx";
import { registerServiceWorker } from "./pwa/register-sw.ts";

const ConversationPage = lazy(() => import("./ConversationPage.tsx").then((module) => ({ default: module.ConversationPage })));
const TaskDetailPage = lazy(() => import("./TaskDetailPage.tsx").then((module) => ({ default: module.TaskDetailPage })));
import "./index.css";

registerServiceWorker((handle) => {
  // A new version is waiting: log it and offer an observable refresh path (ticket #14;
  // richer toast UI can slot in here later without touching the SW).
  console.info("[homeling] new version available — call applyUpdate() to refresh");
  (window as unknown as { __homelingApplyUpdate?: () => void }).__homelingApplyUpdate = () => handle.applyUpdate();
});

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename="/lite">
      <Routes>
        <Route path="/p/:paneId" element={<Suspense fallback={<main className="p-6 text-sm text-neutral-400">Loading conversation…</main>}><ConversationPage /></Suspense>} />
        <Route path="/persona/:personaId" element={<Suspense fallback={<main className="p-6 text-sm text-neutral-400">Loading conversation…</main>}><ConversationPage /></Suspense>} />
        <Route path="/persona/:personaId/p/:paneId" element={<Suspense fallback={<main className="p-6 text-sm text-neutral-400">Loading conversation…</main>}><ConversationPage /></Suspense>} />
        <Route path="/t/:paneId" element={<Suspense fallback={<main className="p-6 text-sm text-neutral-400">Loading task…</main>}><TaskDetailPage /></Suspense>} />
        <Route path="*" element={<App slots={{ memory: (personaId) => <PersonaMemoryEditor personaId={personaId} /> }} />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
