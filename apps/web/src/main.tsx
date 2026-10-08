import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AppRoot } from "./AppRoot.tsx";
import { PersonaMemoryEditor } from "./PersonaMemoryEditor.tsx";
import { LocaleProvider } from "./locale.tsx";
import { registerServiceWorker } from "./pwa/register-sw.ts";
import "./index.css";

const ActivityPanel = lazy(() => import("./ActivityPanel.tsx").then((module) => ({ default: module.ActivityPanel })));

registerServiceWorker((handle) => {
  console.info("[homeling] new version available — call applyUpdate() to refresh");
  (window as unknown as { __homelingApplyUpdate?: () => void }).__homelingApplyUpdate = () => handle.applyUpdate();
});
const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <BrowserRouter basename="/lite">
        <AppRoot slots={{
          memory: (personaId) => <PersonaMemoryEditor personaId={personaId} />,
          activity: (personaId) => <Suspense fallback={<main className="p-6 text-sm text-neutral-400">Loading activity…</main>}><ActivityPanel personaId={personaId} /></Suspense>,
        }} />
      </BrowserRouter>
    </LocaleProvider>
  </StrictMode>,
);
