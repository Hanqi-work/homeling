import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AppRoot } from "./AppRoot.tsx";
import { PushSettings } from './PushSettings.tsx';
const ActivityPanel = lazy(() => import('./ActivityPanel.tsx').then(module => ({ default: module.ActivityPanel })));
import { registerServiceWorker } from "./pwa/register-sw.ts";
import "./index.css";

registerServiceWorker((handle) => {
  console.info("[homeling] new version available — call applyUpdate() to refresh");
  (window as unknown as { __homelingApplyUpdate?: () => void }).__homelingApplyUpdate = () => handle.applyUpdate();
});
const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode><BrowserRouter basename="/lite"><AppRoot slots={{ settings: <PushSettings />, activity: personaId => <Suspense fallback={<p>Loading activity…</p>}><ActivityPanel personaId={personaId} /></Suspense> }} /></BrowserRouter></StrictMode>,
);
