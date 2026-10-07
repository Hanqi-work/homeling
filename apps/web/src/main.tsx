import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { App } from "./App.tsx";
import { registerServiceWorker } from "./pwa/register-sw.ts";
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
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
