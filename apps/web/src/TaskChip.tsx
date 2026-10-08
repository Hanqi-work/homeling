import type { Task } from "@homeling/contracts";
import type { ReactElement } from "react";

interface TaskChipProps {
  task: Task;
}

export function TaskChip({ task }: TaskChipProps): ReactElement {
  const working = task.status === "working";
  const status = task.status === "unknown" ? "starting" : task.status;
  return (
    <li data-task-id={task.paneId} className="w-fit max-w-full rounded-full border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-200">
      <span aria-hidden="true" className="mr-2">{working ? "◍" : "○"}</span>
      <span className="font-medium">{task.launcher.label}</span>
      <span className="text-neutral-400"> · {status}</span>
    </li>
  );
}
