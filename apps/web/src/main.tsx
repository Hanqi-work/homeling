import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AppRoot } from "./AppRoot.tsx";
import { PersonaCustomize } from "./PersonaCustomize.tsx";
import { registerServiceWorker } from "./pwa/register-sw.ts";
import "./index.css";

registerServiceWorker((handle) => {
  console.info("[homeling] new version available — call applyUpdate() to refresh");
  (window as unknown as { __homelingApplyUpdate?: () => void }).__homelingApplyUpdate = () => handle.applyUpdate();
});
const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode><BrowserRouter basename="/lite"><AppRoot slots={{ customize: (personaId) => <PersonaCustomize personaId={personaId} /> }} /></BrowserRouter></StrictMode>,
);
