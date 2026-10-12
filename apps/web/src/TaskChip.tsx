import { useLocale } from "./locale.tsx";
import type { Task } from "@homeling/contracts";
import type { ReactElement } from "react";
import { Link } from "react-router";

interface TaskChipProps {
  task: Task;
  returnTo?: string;
}

export function TaskChip({ task, returnTo = "/" }: TaskChipProps): ReactElement {
  const { t } = useLocale();
  const working = task.status === "working";
  const status = t(`task.${task.status === "unknown" ? "starting" : task.status}`);
  return (
    <li data-task-id={task.paneId}>
      <Link
        to={`/t/${encodeURIComponent(task.paneId)}`}
        state={{ task, returnTo }}
        aria-label={t("task.detailsLabel", { name: task.launcher.label, status })}
        className="block w-fit max-w-full rounded-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:border-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-400"
      >
        <span aria-hidden="true" className="mr-2">{working ? "◍" : "○"}</span>
        <span className="font-medium">{task.launcher.label}</span>
        <span className="text-neutral-400"> · {status}</span>
      </Link>
    </li>
  );
}
