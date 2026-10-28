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
  deleteCompletedTasks,
  setSettings,
  addPage,
  renamePage,
  deletePage,
  getNote,
  reorderPages,
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
it("현재 페이지의 완료된 할 일만 삭제하고 동기화용 삭제 기록을 남김", async () => {
  const pageId = addPage("일괄 삭제 테스트");
  const doneInPage = { ...newTask(11), title: "페이지 완료", pageId, completed: true, completedAt: new Date().toISOString() };
  const doneUnsorted = { ...newTask(12), title: "미분류 완료", completed: true, completedAt: new Date().toISOString() };
  const remaining = { ...newTask(13), title: "진행 중", pageId };
  for (const task of [doneInPage, doneUnsorted, remaining]) addTask(task);
  await flush();
  expect(deleteCompletedTasks(pageId)).toBe(1);
  await flush();
  expect(await db.tasks.get(doneInPage.id)).toBeUndefined();
  expect(await db.tasks.get(doneUnsorted.id)).toBeDefined();
  expect(await db.tasks.get(remaining.id)).toBeDefined();
  expect(await db.deleted.get(doneInPage.id)).toBeDefined();
  expect(await db.deleted.get(doneUnsorted.id)).toBeUndefined();
  expect(deleteCompletedTasks(null)).toBe(1);
  await flush();
  expect(await db.tasks.get(doneUnsorted.id)).toBeUndefined();
  expect(await db.deleted.get(doneUnsorted.id)).toBeDefined();
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
it("페이지에 할 일을 넣고 이름 변경·삭제해도 할 일은 미분류로 남음", async () => {
  const id = addPage("업무");
  const t = { ...newTask(3), pageId: id, title: "회의 준비" };
  addTask(t);
  await flush();
  expect((await db.pages.get(id))?.name).toBe("업무");
  expect((await db.tasks.get(t.id))?.pageId).toBe(id);
  renamePage(id, "회사");
  await flush();
  expect((await db.pages.get(id))?.name).toBe("회사");
  deletePage(id);
  await flush();
  expect(getNote().tasks.find((item) => item.id === t.id)?.pageId).toBeNull();
  expect((await db.tasks.get(t.id))?.pageId).toBeNull();
  expect((await db.pages.get(id))?.deletedAt).toBeTruthy();
});
it("페이지 드래그 순서를 저장하고 다시 읽음", async () => {
  const first = addPage("공부");
  const second = addPage("집안일");
  await flush();
  reorderPages(second, first);
  await flush();
  const ordered = getNote().pages.filter((p) => !p.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder);
  expect(ordered.findIndex((p) => p.id === second)).toBeLessThan(ordered.findIndex((p) => p.id === first));
  expect((await db.pages.get(second))?.sortOrder).toBeLessThan((await db.pages.get(first))!.sortOrder);
});
