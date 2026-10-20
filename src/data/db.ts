import Dexie, { type Table } from "dexie";
import type { Task, Settings, Backup } from "../types";
export class NoteDatabase extends Dexie {
  tasks!: Table<Task, string>;
  settings!: Table<Settings, string>;
  constructor(name = "yellow-note") {
    super(name);
    // Future schema changes must add a version().stores().upgrade() migration.
    this.version(1).stores({
      tasks: "id, createdAt, sortOrder",
      settings: "id",
    });
  }
}
export const db = new NoteDatabase();
export async function replaceDatabase(backup: Backup, database = db) {
  await database.transaction(
    "rw",
    database.tasks,
    database.settings,
    async () => {
      await database.tasks.clear();
      await database.tasks.bulkPut(backup.tasks);
      await database.settings.clear();
      await database.settings.put(backup.settings);
    },
  );
}
