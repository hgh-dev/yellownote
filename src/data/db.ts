import Dexie, { type Table } from "dexie";
import type { Task, Settings, Backup, Page } from "../types";
export class NoteDatabase extends Dexie {
  tasks!: Table<Task, string>;
  settings!: Table<Settings, string>;
  deleted!: Table<{ id: string; deletedAt: string }, string>;
  pages!: Table<Page, string>;
  constructor(name = "yellow-note") {
    super(name);
    // Future schema changes must add a version().stores().upgrade() migration.
    this.version(1).stores({
      tasks: "id, createdAt, sortOrder",
      settings: "id",
    });
    this.version(2).stores({
      tasks: "id, createdAt, sortOrder",
      settings: "id",
      deleted: "id",
    });
    this.version(3).stores({
      tasks: "id, createdAt, sortOrder, pageId",
      settings: "id",
      deleted: "id",
      pages: "id, sortOrder",
    }).upgrade(async (tx) => {
      await tx.table<Task>("tasks").toCollection().modify({ pageId: null });
    });
  }
}
export const db = new NoteDatabase();
export async function replaceDatabase(backup: Backup, database = db) {
  await database.transaction(
    "rw",
    database.tasks,
    database.settings,
    database.deleted,
    database.pages,
    async () => {
      await database.tasks.clear();
      await database.tasks.bulkPut(backup.tasks);
      await database.deleted.clear();
      await database.pages.clear();
      await database.pages.bulkPut(backup.pages);
      await database.settings.clear();
      await database.settings.put(backup.settings);
    },
  );
}
