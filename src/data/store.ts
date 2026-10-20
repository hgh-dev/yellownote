import { useSyncExternalStore } from "react";
import { db, replaceDatabase } from "./db";
import { defaults, type Task, type Settings, type Backup } from "../types";
import { validTask, validSettings } from "../lib/backup";
interface State {
  tasks: Task[];
  settings: Settings;
  ready: boolean;
  saving: boolean;
  error: string | null;
}
let state: State = {
  tasks: [],
  settings: defaults,
  ready: false,
  saving: false,
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
const journalKey = "yellow-note-recovery-v1";
let pending = new Map<string, Task | null>();
let pendingSettings: Settings | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let starting: Promise<void> | null = null;
function journal() {
  try {
    if (!pending.size && !pendingSettings) localStorage.removeItem(journalKey);
    else
      localStorage.setItem(
        journalKey,
        JSON.stringify({ tasks: [...pending], settings: pendingSettings }),
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
      pending.size || pendingSettings ? flush() : undefined,
    );
  if (!pending.size && !pendingSettings) return Promise.resolve();
  const batch = new Map(pending),
    preferences = pendingSettings;
  running = db
    .transaction("rw", db.tasks, db.settings, async () => {
      for (const [id, task] of batch) {
        if (task) await db.tasks.put(task);
        else await db.tasks.delete(id);
      }
      if (preferences) await db.settings.put(preferences);
    })
    .then(() => {
      batch.forEach((task, id) => {
        if (pending.get(id) === task) pending.delete(id);
      });
      if (pendingSettings === preferences) pendingSettings = null;
      journal();
      emit({ saving: !!pending.size || !!pendingSettings, error: null });
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
    pending.size || pendingSettings ? flush() : undefined,
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
                (validTask(entry[1]) && entry[1].id === entry[0])),
          ) ||
          (recovery.settings !== null && !validSettings(recovery.settings))
        )
          throw new Error("복구 데이터 오류");
        pending = new Map(recovery.tasks);
        pendingSettings = recovery.settings;
        await flush();
      }
      const [tasks, settings] = await Promise.all([
        db.tasks.toArray(),
        db.settings.get("preferences"),
      ]);
      emit({ tasks, settings: settings || defaults, ready: true });
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
  const settings = { ...state.settings, ...patch };
  emit({ settings });
  pendingSettings = settings;
  schedule(true);
}
export function saveOrder(tasks: Task[]) {
  emit({ tasks, settings: { ...state.settings, sortMode: "manual" } });
  tasks.forEach((t) => pending.set(t.id, t));
  pendingSettings = state.settings;
  schedule(true);
}
export async function restore(backup: Backup) {
  await flush();
  await replaceDatabase(backup);
  emit({ tasks: backup.tasks, settings: backup.settings, error: null });
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
    if (pending.size || pendingSettings) {
      journal();
      void flush().catch(() => {});
      e.preventDefault();
    }
  });
}
