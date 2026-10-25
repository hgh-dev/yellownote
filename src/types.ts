export type Priority = "high" | "medium" | "low" | null;
export type SortMode = "created" | "due" | "priority" | "manual";
export interface Task {
  id: string;
  title: string;
  memo: string;
  dueDate: string | null;
  priority: Priority;
  pinned: boolean;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  sortOrder: number;
  pageId: string | null;
}
export interface Page {
  id: string;
  name: string;
  sortOrder: number;
  updatedAt: string;
  deletedAt: string | null;
}
export interface Settings {
  id: "preferences";
  showCompleted: boolean;
  sortMode: SortMode;
  direction: "asc" | "desc";
  completedSort?: "include" | "top" | "bottom";
  updatedAt?: string;
}
export const defaults: Settings = {
  id: "preferences",
  showCompleted: true,
  sortMode: "created",
  direction: "asc",
};
export interface Backup {
  app: "yellow-note";
  version: 2;
  exportedAt: string;
  tasks: Task[];
  settings: Settings;
  pages: Page[];
}
