import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AppRoot } from "./AppRoot.tsx";
import { SessionAwareHomeTriage } from "./HomeTriage.tsx";
import { PersonaMemoryEditor } from "./PersonaMemoryEditor.tsx";
import { PersonaCustomize } from "./PersonaCustomize.tsx";
import { LocaleProvider, useLocale } from "./locale.tsx";
import { PushSettings } from "./PushSettings.tsx";
import { registerServiceWorker } from "./pwa/register-sw.ts";
import "./index.css";

const ActivityPanel = lazy(() => import("./ActivityPanel.tsx").then((module) => ({ default: module.ActivityPanel })));
function ActivityLoading() {
  const { t } = useLocale();
  return <main className="p-6 text-sm text-neutral-400">{t("activity.loading")}</main>;
}

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
          homeSummary: <SessionAwareHomeTriage />,
          memory: (personaId) => <PersonaMemoryEditor personaId={personaId} />,
          customize: (personaId) => <PersonaCustomize personaId={personaId} />,
          activity: (personaId) => <Suspense fallback={<ActivityLoading />}><ActivityPanel personaId={personaId} /></Suspense>,
          settings: <PushSettings />,
        }} />
      </BrowserRouter>
    </LocaleProvider>
  </StrictMode>,
);
