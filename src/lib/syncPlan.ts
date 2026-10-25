import type { Settings, Task, Page } from '../types';
import { mergeCloudData, type CloudData, type Deletion } from './cloud';

export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry) || '';
}
export function sameData(a: CloudData, b: CloudData) {
  const ordered = (data: CloudData) => ({ ...data,
    tasks: [...data.tasks].sort((x, y) => x.id.localeCompare(y.id)),
    pages: [...data.pages].sort((x, y) => x.id.localeCompare(y.id)),
    deleted: [...data.deleted].sort((x, y) => x.id.localeCompare(y.id)),
  });
  return fingerprint(ordered(a)) === fingerprint(ordered(b));
}
export type SyncPlan = {
  combined: CloudData;
  tasksToWrite: Task[];
  pagesToWrite: Page[];
  deletionsToWrite: Deletion[];
  tasksToDelete: Deletion[];
  settingsToWrite: Settings | null;
  applyToLocal: boolean;
};
export function planFirebaseSync(local: CloudData, remote: CloudData): SyncPlan {
  const combined = mergeCloudData(local, remote);
  const taskDocs = new Map(remote.tasks.map((item) => [item.id, item]));
  const pageDocs = new Map(remote.pages.map((item) => [item.id, item]));
  const deletedDocs = new Map(remote.deleted.map((item) => [item.id, item]));
  return {
    combined,
    tasksToWrite: combined.tasks.filter((item) => fingerprint(taskDocs.get(item.id)) !== fingerprint(item)),
    pagesToWrite: combined.pages.filter((item) => fingerprint(pageDocs.get(item.id)) !== fingerprint(item)),
    deletionsToWrite: combined.deleted.filter((item) => fingerprint(deletedDocs.get(item.id)) !== fingerprint(item)),
    tasksToDelete: combined.deleted.filter((item) => {
      const task = taskDocs.get(item.id);
      return task && task.updatedAt <= item.deletedAt;
    }),
    settingsToWrite: fingerprint(remote.settings) === fingerprint(combined.settings) ? null : combined.settings,
    applyToLocal: !sameData(local, combined),
  };
}
