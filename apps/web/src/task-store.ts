import type { Task } from "@homeling/contracts";

type TaskStorage = Pick<Storage, "getItem" | "setItem">;
type StoredTask = Omit<Task, "status">;

const KEY_PREFIX = "homeling:tasks:";

function storageKey(conversationPaneId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(conversationPaneId)}`;
}

function browserStorage(): TaskStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Load one conversation's launch metadata; runtime status is always rebuilt from a fresh snapshot. */
export function readConversationTasks(
  conversationPaneId: string,
  storage: TaskStorage | null = browserStorage(),
): Task[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(storageKey(conversationPaneId));
    if (!raw) return [];
    const records = JSON.parse(raw) as StoredTask[];
    if (!Array.isArray(records)) return [];
    return records.map((record) => ({ ...record, status: "unknown" }));
  } catch {
    return [];
  }
}

/** Keep task identity across route unmounts, but do not persist stale snapshot-derived status. */
export function saveConversationTasks(
  conversationPaneId: string,
  tasks: readonly Task[],
  storage: TaskStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    const records: StoredTask[] = tasks.map(({ status: _status, ...record }) => record);
    storage.setItem(storageKey(conversationPaneId), JSON.stringify(records));
  } catch {
    // Session storage is a convenience; an unavailable quota must not break launching a task.
  }
}
