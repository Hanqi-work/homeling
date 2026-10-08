import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { App } from "./App.tsx";

const ConversationPage = lazy(() => import("./ConversationPage.tsx").then((module) => ({ default: module.ConversationPage })));
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename="/lite">
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/p/:paneId" element={<Suspense fallback={<main className="p-6 text-sm text-neutral-400">Loading conversation…</main>}><ConversationPage /></Suspense>} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
