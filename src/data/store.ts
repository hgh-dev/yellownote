import { useSyncExternalStore } from "react";
import { db, replaceDatabase } from "./db";
import { defaults, type Task, type Settings, type Backup, type Page } from "../types";
import { normalizeTask, validPage, validSettings } from "../lib/backup";
interface State {
  tasks: Task[];
  pages: Page[];
  settings: Settings;
  ready: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  error: string | null;
}
let state: State = {
  tasks: [],
  pages: [],
  settings: defaults,
  ready: false,
  saving: false,
  lastSavedAt: null,
  error: null,
};
const listeners = new Set<() => void>();
const emit = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};
export const useNote = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state,
  );
export const getNote = () => state;
const journalKey = "yellow-note-recovery-v1";
let pending = new Map<string, Task | null>();
let pendingPages = new Map<string, Page>();
let pendingSettings: Settings | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let starting: Promise<void> | null = null;
function journal() {
  try {
    if (!pending.size && !pendingPages.size && !pendingSettings) localStorage.removeItem(journalKey);
    else
      localStorage.setItem(
        journalKey,
        JSON.stringify({ tasks: [...pending], pages: [...pendingPages], settings: pendingSettings }),
      );
  } catch {
    emit({
      error:
        "임시 복구 사본을 저장할 공간이 부족합니다. 저장 완료를 확인하고 JSON 백업을 내려받아 주세요.",
    });
  }
}
function schedule(immediate = false) {
  journal();
  emit({ saving: true });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("yellow-note-change"));
  clearTimeout(timer);
  if (immediate) void flush().catch(() => {});
  else
    timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 180);
}
export function flush(): Promise<void> {
  clearTimeout(timer);
  if (running)
    return running.then(() =>
      pending.size || pendingPages.size || pendingSettings ? flush() : undefined,
    );
  if (!pending.size && !pendingPages.size && !pendingSettings) return Promise.resolve();
  const batch = new Map(pending),
    pageBatch = new Map(pendingPages),
    preferences = pendingSettings,
    savedAt = new Date().toISOString();
  running = db
    .transaction("rw", db.tasks, db.settings, db.deleted, db.pages, db.meta, async () => {
      for (const [id, task] of batch) {
        if (task) {
          await db.tasks.put(task);
          await db.deleted.delete(id);
        } else {
          await db.tasks.delete(id);
          await db.deleted.put({ id, deletedAt: new Date().toISOString() });
        }
      }
      for (const page of pageBatch.values()) await db.pages.put(page);
      if (preferences) await db.settings.put(preferences);
      await db.meta.put({ key: "last-saved-at", value: savedAt });
    })
    .then(() => {
      batch.forEach((task, id) => {
        if (pending.get(id) === task) pending.delete(id);
      });
      pageBatch.forEach((page, id) => {
        if (pendingPages.get(id) === page) pendingPages.delete(id);
      });
      if (pendingSettings === preferences) pendingSettings = null;
      journal();
      emit({ saving: !!pending.size || !!pendingPages.size || !!pendingSettings, lastSavedAt: savedAt, error: null });
    })
    .catch((error: unknown) => {
      emit({
        saving: false,
        error:
          "저장하지 못했습니다. 브라우저 저장 공간과 권한을 확인한 뒤 다시 저장해 주세요. 입력 내용은 현재 화면에 유지됩니다.",
      });
      throw error;
    })
    .finally(() => {
      running = null;
    });
  return running.then(() =>
    pending.size || pendingPages.size || pendingSettings ? flush() : undefined,
  );
}
export function initialize() {
  if (starting) return starting;
  starting = (async () => {
    try {
      const raw = localStorage.getItem(journalKey);
      if (raw) {
        const recovery = JSON.parse(raw);
        if (
          !Array.isArray(recovery.tasks) ||
          !recovery.tasks.every(
            (entry: unknown) =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              typeof entry[0] === "string" &&
              (entry[1] === null ||
                (normalizeTask(entry[1])?.id === entry[0])),
          ) ||
          (recovery.pages !== undefined && (!Array.isArray(recovery.pages) || !recovery.pages.every((entry: unknown) =>
            Array.isArray(entry) && entry.length === 2 && validPage(entry[1]) && entry[0] === entry[1].id))) ||
          (recovery.settings !== null && !validSettings(recovery.settings))
        )
          throw new Error("복구 데이터 오류");
        pending = new Map(recovery.tasks.map(([id, task]: [string, unknown]) => [id, task === null ? null : normalizeTask(task)]));
        pendingPages = new Map(recovery.pages || []);
        pendingSettings = recovery.settings;
        await flush();
      }
      const [tasks, settings, pages, deleted, saved] = await Promise.all([
        db.tasks.toArray(),
        db.settings.get("preferences"),
        db.pages.toArray(),
        db.deleted.toArray(),
        db.meta.get("last-saved-at"),
      ]);
      const lastSavedAt = saved?.value || [
        ...tasks.map((task) => task.updatedAt),
        ...pages.map((page) => page.updatedAt),
        ...deleted.map((item) => item.deletedAt),
        settings?.updatedAt,
      ].filter((value): value is string => !!value).sort().at(-1) || new Date().toISOString();
      emit({ tasks, pages, settings: settings || defaults, lastSavedAt, ready: true });
    } catch {
      emit({
        error:
          "저장소를 열 수 없습니다. 비공개 모드를 해제하거나 저장 공간과 브라우저 권한을 확인한 뒤 새로고침해 주세요.",
      });
    }
  })();
  return starting;
}
export function addTask(task: Task) {
  emit({ tasks: [...state.tasks, task] });
  pending.set(task.id, task);
  schedule(true);
}
export function updateTask(
  id: string,
  patch: Partial<Task>,
  immediate = false,
) {
  const old = state.tasks.find((t) => t.id === id);
  if (!old) return;
  const task = { ...old, ...patch, id, updatedAt: new Date().toISOString() };
  emit({ tasks: state.tasks.map((t) => (t.id === id ? task : t)) });
  pending.set(id, task);
  schedule(immediate);
}
export function deleteTask(id: string) {
  emit({ tasks: state.tasks.filter((t) => t.id !== id) });
  pending.set(id, null);
  schedule(true);
}
export function setSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch, updatedAt: new Date().toISOString() };
  emit({ settings });
  pendingSettings = settings;
  schedule(true);
}
export function saveOrder(tasks: Task[]) {
  const previous = state.tasks;
  emit({ tasks, settings: { ...state.settings, sortMode: "manual", updatedAt: new Date().toISOString() } });
  tasks.forEach((t) => { if (previous.find((old) => old.id === t.id) !== t) pending.set(t.id, t); });
  pendingSettings = state.settings;
  schedule(true);
}
function pageName(name: string, exceptId?: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 40) throw new Error("페이지 이름은 1~40자로 입력해 주세요.");
  if (state.pages.some((p) => !p.deletedAt && p.id !== exceptId && p.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase()))
    throw new Error("같은 이름의 페이지가 이미 있습니다.");
  return trimmed;
}
export function addPage(name: string): string {
  const now = new Date().toISOString();
  const page: Page = { id: crypto.randomUUID(), name: pageName(name), sortOrder: Math.max(-1, ...state.pages.map((p) => p.sortOrder)) + 1, updatedAt: now, deletedAt: null };
  emit({ pages: [...state.pages, page] });
  pendingPages.set(page.id, page);
  schedule(true);
  return page.id;
}
export function renamePage(id: string, name: string) {
  const old = state.pages.find((p) => p.id === id && !p.deletedAt);
  if (!old) return;
  const next = pageName(name, id);
  if (next === old.name) return;
  const page = { ...old, name: next, updatedAt: new Date().toISOString() };
  emit({ pages: state.pages.map((p) => p.id === id ? page : p) });
  pendingPages.set(id, page);
  schedule(true);
}
export function reorderPages(activeId: string, overId: string) {
  const ordered = state.pages.filter((p) => !p.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const from = ordered.findIndex((p) => p.id === activeId);
  const to = ordered.findIndex((p) => p.id === overId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  const now = new Date().toISOString();
  const changed = new Map(ordered.map((p, index) => [p.id, p.sortOrder === index ? p : { ...p, sortOrder: index, updatedAt: now }]));
  const previous = state.pages;
  emit({ pages: state.pages.map((p) => changed.get(p.id) || p) });
  changed.forEach((page, id) => { if (previous.find((old) => old.id === id) !== page) pendingPages.set(id, page); });
  schedule(true);
}
export function deletePage(id: string) {
  const old = state.pages.find((p) => p.id === id && !p.deletedAt);
  if (!old) return;
  const now = new Date().toISOString();
  const page = { ...old, updatedAt: now, deletedAt: now };
  const affected = state.tasks.filter((t) => t.pageId === id);
  const tasks = state.tasks.map((t) => t.pageId === id ? { ...t, pageId: null, updatedAt: now } : t);
  emit({ pages: state.pages.map((p) => p.id === id ? page : p), tasks });
  tasks.forEach((t) => { if (affected.some((oldTask) => oldTask.id === t.id)) pending.set(t.id, t); });
  pendingPages.set(id, page);
  schedule(true);
}
export async function restore(backup: Backup) {
  await flush();
  await replaceDatabase(backup);
  const savedAt = new Date().toISOString();
  await db.meta.put({ key: "last-saved-at", value: savedAt });
  emit({ tasks: backup.tasks, pages: backup.pages, settings: backup.settings, lastSavedAt: savedAt, error: null });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("yellow-note-change"));
}
export async function applySynced(tasks: Task[], settings: Settings, deleted: { id: string; deletedAt: string }[], pages: Page[]) {
  await flush();
  const savedAt = new Date().toISOString();
  await db.transaction("rw", db.tasks, db.settings, db.deleted, db.pages, db.meta, async () => {
    await db.tasks.clear();
    await db.tasks.bulkPut(tasks);
    await db.settings.put(settings);
    await db.deleted.clear();
    await db.deleted.bulkPut(deleted);
    await db.pages.clear();
    await db.pages.bulkPut(pages);
    await db.meta.put({ key: "last-saved-at", value: savedAt });
  });
  emit({ tasks, pages, settings, lastSavedAt: savedAt, error: null });
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    journal();
    void flush().catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      journal();
      void flush().catch(() => {});
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (pending.size || pendingPages.size || pendingSettings) {
      journal();
      void flush().catch(() => {});
      e.preventDefault();
    }
  });
}
