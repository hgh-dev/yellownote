import { type Task, type Settings } from "../types";
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
// Calendar components are converted to UTC only for arithmetic, never for storing a local date.
export function dayDifference(due: string, today: string): number {
  const day = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((day(due) - day(today)) / 86400000);
}
export function dDay(due: string, today: string): string {
  const days = dayDifference(due, today);
  return days === 0 ? "D-Day" : days > 0 ? `D-${days}` : `D+${-days}`;
}
export function newTask(sortOrder: number): Task {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    memo: "",
    dueDate: null,
    priority: null,
    pinned: false,
    completed: false,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    sortOrder,
    pageId: null,
  };
}
export function sortedTasks(tasks: Task[], settings: Settings): Task[] {
  const rank = { high: 3, medium: 2, low: 1 };
  const dir = settings.direction === "asc" ? 1 : -1;
  return tasks
    .filter((t) => settings.showCompleted || !t.completed)
    .sort((a, b) => {
      if (settings.completedSort && settings.completedSort !== "include") {
        if (a.completed !== b.completed)
          return a.completed === (settings.completedSort === "top") ? -1 : 1;
        if (a.completed && b.completed)
          return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
      }
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      let diff = 0;
      if (settings.sortMode === "created")
        diff = a.createdAt.localeCompare(b.createdAt) * dir;
      if (settings.sortMode === "manual") diff = a.sortOrder - b.sortOrder;
      if (settings.sortMode === "due") {
        if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1;
        diff = (a.dueDate || "").localeCompare(b.dueDate || "") * dir;
      }
      if (settings.sortMode === "priority") {
        if (!a.priority !== !b.priority) return a.priority ? -1 : 1;
        diff =
          ((a.priority ? rank[a.priority] : 0) -
            (b.priority ? rank[b.priority] : 0)) *
          dir;
      }
      return (
        diff ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
      );
    });
}
export function reorderTasks(
  tasks: Task[],
  settings: Settings,
  activeId: string,
  overId: string,
): Task[] | null {
  const visible = sortedTasks(tasks, settings);
  const active = visible.find((t) => t.id === activeId),
    over = visible.find((t) => t.id === overId);
  if (!active || !over || active.pageId !== over.pageId || active.pinned !== over.pinned || activeId === overId)
    return null;
  if (settings.completedSort && settings.completedSort !== "include" && active.completed !== over.completed)
    return null;
  const from = visible.indexOf(active),
    to = visible.indexOf(over);
  visible.splice(from, 1);
  visible.splice(to, 0, active);
  // Hidden completed items keep their relative order and move after visible items in each group.
  const hidden = tasks
    .filter((t) => !visible.some((v) => v.id === t.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const now = new Date().toISOString();
  return [...visible, ...hidden].map((t, sortOrder) => ({
    ...t,
    sortOrder,
    updatedAt: now,
  }));
}
