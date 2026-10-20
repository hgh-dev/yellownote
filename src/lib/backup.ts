import type { Backup, Settings, Task } from "../types";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const iso = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(v) &&
  Number.isFinite(Date.parse(v));
export function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const date = new Date(`${v}T12:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === v &&
    Number(v.slice(0, 4)) >= 1000
  );
}
export function validSettings(v: unknown): v is Settings {
  return (
    object(v) &&
    v.id === "preferences" &&
    typeof v.showCompleted === "boolean" &&
    ["created", "due", "priority", "manual"].includes(v.sortMode as string) &&
    ["asc", "desc"].includes(v.direction as string)
  );
}
export function validTask(v: unknown): v is Task {
  return (
    object(v) &&
    typeof v.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v.id,
    ) &&
    typeof v.title === "string" &&
    typeof v.memo === "string" &&
    (v.dueDate === null || validDate(v.dueDate)) &&
    [null, "high", "medium", "low"].includes(v.priority as string | null) &&
    typeof v.pinned === "boolean" &&
    typeof v.completed === "boolean" &&
    iso(v.createdAt) &&
    iso(v.updatedAt) &&
    (v.completed ? iso(v.completedAt) : v.completedAt === null) &&
    typeof v.sortOrder === "number" &&
    Number.isSafeInteger(v.sortOrder) &&
    v.sortOrder >= 0
  );
}
export function parseBackup(text: string): Backup {
  let b: unknown;
  try {
    b = JSON.parse(text);
  } catch {
    throw new Error("JSON 파일을 읽을 수 없습니다.");
  }
  if (!object(b) || b.app !== "yellow-note" || b.version !== 1)
    throw new Error("지원하지 않는 백업 형식 또는 버전입니다.");
  if (
    !iso(b.exportedAt) ||
    !validSettings(b.settings) ||
    !Array.isArray(b.tasks) ||
    !b.tasks.every(validTask)
  )
    throw new Error("백업에 잘못된 날짜, 설정 또는 할 일 데이터가 있습니다.");
  if (new Set(b.tasks.map((t) => t.id)).size !== b.tasks.length)
    throw new Error("중복된 할 일 ID가 있습니다.");
  return b as unknown as Backup;
}
export function makeBackup(tasks: Task[], settings: Settings): Backup {
  return {
    app: "yellow-note",
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    settings,
  };
}
