import { normalizeTask, validPage, validSettings } from './backup';
import type { Settings, Task, Page } from '../types';

export type Deletion = { id: string; deletedAt: string };
export type CloudData = { app: 'yellow-note-sync'; version: 2; tasks: Task[]; settings: Settings; deleted: Deletion[]; pages: Page[] };

export function parseCloudData(data: unknown): CloudData {
  const d = data as Partial<CloudData> & { version?: number };
  if (!d || d.app !== 'yellow-note-sync' || ![1, 2].includes(d.version || 0) || !Array.isArray(d.tasks) ||
    !d.tasks.every((task) => normalizeTask(task) !== null) || !validSettings(d.settings) || !Array.isArray(d.deleted) ||
    !d.deleted.every((item) => item && typeof item.id === 'string' && typeof item.deletedAt === 'string' && Number.isFinite(Date.parse(item.deletedAt))) ||
    (d.version === 2 && (!Array.isArray(d.pages) || !d.pages.every(validPage))) ||
    new Set(d.tasks.map((task) => task.id)).size !== d.tasks.length)
    throw new Error('동기화 데이터 형식이 올바르지 않습니다.');
  return { app: 'yellow-note-sync', version: 2, tasks: d.tasks.map((t) => normalizeTask(t)!), settings: d.settings!, deleted: d.deleted, pages: d.version === 2 ? d.pages! : [] };
}

export function mergeCloudData(local: CloudData, remote: CloudData): CloudData {
  const tasks = new Map<string, Task>();
  const deleted = new Map<string, Deletion>();
  const pages = new Map<string, Page>();
  for (const page of [...local.pages, ...remote.pages]) {
    const old = pages.get(page.id);
    if (!old || old.updatedAt <= page.updatedAt) pages.set(page.id, page);
  }
  for (const item of [...local.deleted, ...remote.deleted]) {
    const old = deleted.get(item.id);
    if (!old || old.deletedAt < item.deletedAt) deleted.set(item.id, item);
  }
  for (const task of [...local.tasks, ...remote.tasks]) {
    const old = tasks.get(task.id);
    if (!old || old.updatedAt < task.updatedAt) tasks.set(task.id, task);
  }
  for (const [id, task] of tasks) {
    const removal = deleted.get(id);
    if (removal && removal.deletedAt >= task.updatedAt) tasks.delete(id);
    else deleted.delete(id);
  }
  for (const [id, task] of tasks) {
    if (task.pageId && pages.get(task.pageId)?.deletedAt)
      tasks.set(id, { ...task, pageId: null });
  }
  const settings = (local.settings.updatedAt || '') > (remote.settings.updatedAt || '') ? local.settings : remote.settings;
  return { app: 'yellow-note-sync', version: 2, tasks: [...tasks.values()], deleted: [...deleted.values()], pages: [...pages.values()], settings };
}
