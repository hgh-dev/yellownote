import "fake-indexeddb/auto";
import { beforeAll, expect, it, vi } from "vitest";
import { db } from "../src/data/db";
import { newTask } from "../src/lib/tasks";
import {
  initialize,
  addTask,
  updateTask,
  flush,
  deleteTask,
  setSettings,
} from "../src/data/store";
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => memory.set(k, v),
  removeItem: (k: string) => memory.delete(k),
});
beforeAll(async () => {
  await initialize();
});
it("빠른 연속 편집의 마지막 값과 복구 기록 정리", async () => {
  const t = newTask(0);
  addTask(t);
  for (let i = 0; i < 30; i++)
    updateTask(t.id, { title: `제목 ${i}`, memo: `메모\n${i}` });
  expect(memory.has("yellow-note-recovery-v1")).toBe(true);
  await flush();
  expect((await db.tasks.get(t.id))?.title).toBe("제목 29");
  expect((await db.tasks.get(t.id))?.memo).toBe("메모\n29");
  expect(memory.has("yellow-note-recovery-v1")).toBe(false);
});
it("완료와 고정은 보존, 삭제는 메모까지 제거", async () => {
  const t = newTask(1);
  addTask(t);
  updateTask(
    t.id,
    {
      title: "보존",
      memo: "내용",
      pinned: true,
      completed: true,
      completedAt: new Date().toISOString(),
    },
    true,
  );
  setSettings({ showCompleted: false });
  await flush();
  expect((await db.tasks.get(t.id))?.pinned).toBe(true);
  expect((await db.tasks.get(t.id))?.memo).toBe("내용");
  deleteTask(t.id);
  await flush();
  expect(await db.tasks.get(t.id)).toBeUndefined();
});
it("저장 실패 후 보류된 변경을 재시도로 복구", async () => {
  const t = newTask(2);
  addTask(t);
  await flush();
  const put = vi
    .spyOn(db.tasks, "put")
    .mockRejectedValueOnce(new Error("QuotaExceededError"));
  updateTask(t.id, { title: "저장 실패해도 유지" });
  await expect(flush()).rejects.toThrow();
  expect(memory.has("yellow-note-recovery-v1")).toBe(true);
  put.mockRestore();
  await flush();
  expect((await db.tasks.get(t.id))?.title).toBe("저장 실패해도 유지");
});
