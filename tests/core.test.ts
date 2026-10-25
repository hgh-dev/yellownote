import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { defaults, type Task, type Page } from "../src/types";
import Dexie from "dexie";
import {
  dDay,
  dayDifference,
  localDate,
  newTask,
  sortedTasks,
  reorderTasks,
} from "../src/lib/tasks";
import { makeBackup, parseBackup, validDate } from "../src/lib/backup";
import { NoteDatabase, replaceDatabase } from "../src/data/db";
import { mergeCloudData, parseCloudData } from "../src/lib/cloud";
const task = (patch: Partial<Task> = {}): Task => ({
  ...newTask(0),
  title: "산림사업 설계서 검토",
  createdAt: "2026-10-20T01:00:00.000Z",
  updatedAt: "2026-10-20T01:00:00.000Z",
  ...patch,
});
describe("Drive 데이터 합치기", () => {
  it("다른 기기의 새 할 일을 보존하고 삭제된 할 일을 되살리지 않음", () => {
    const removed = task();
    const added = task({ id: crypto.randomUUID(), title: "다른 기기 할 일" });
    const local = { app: "yellow-note-sync" as const, version: 2 as const, tasks: [removed], settings: defaults, deleted: [], pages: [] };
    const remote = { ...local, tasks: [added], deleted: [{ id: removed.id, deletedAt: "2026-10-21T01:00:00.000Z" }] };
    const result = mergeCloudData(local, remote);
    expect(result.tasks.map((item) => item.id)).toEqual([added.id]);
    expect(result.deleted).toEqual(remote.deleted);
  });
  it("나중에 수정한 할 일과 설정을 선택함", () => {
    const older = task();
    const newer = { ...older, title: "수정됨", updatedAt: "2026-10-22T01:00:00.000Z" };
    const local = { app: "yellow-note-sync" as const, version: 2 as const, tasks: [newer], settings: { ...defaults, updatedAt: "2026-10-22T01:00:00.000Z" }, deleted: [], pages: [] };
    const remote = { ...local, tasks: [older], settings: defaults };
    const result = mergeCloudData(local, remote);
    expect(result.tasks[0].title).toBe("수정됨");
    expect(result.settings.updatedAt).toBe(local.settings.updatedAt);
  });
  it("삭제된 페이지의 할 일은 미분류로 보존함", () => {
    const page: Page = { id: crypto.randomUUID(), name: "업무", sortOrder: 0, updatedAt: "2026-10-20T01:00:00.000Z", deletedAt: null };
    const removed = { ...page, updatedAt: "2026-10-22T01:00:00.000Z", deletedAt: "2026-10-22T01:00:00.000Z" };
    const local = { app: "yellow-note-sync" as const, version: 2 as const, tasks: [task({ pageId: page.id })], settings: defaults, deleted: [], pages: [page] };
    const result = mergeCloudData(local, { ...local, tasks: [], pages: [removed] });
    expect(result.pages[0].deletedAt).toBe(removed.deletedAt);
    expect(result.tasks[0].pageId).toBeNull();
  });
  it("다른 페이지 사이로 할 일을 드래그해 옮기지 않음", () => {
    const first = task({ pageId: crypto.randomUUID() });
    const second = task({ id: crypto.randomUUID(), pageId: crypto.randomUUID() });
    expect(reorderTasks([first, second], defaults, first.id, second.id)).toBeNull();
  });
  it("이전 Drive 동기화 파일의 할 일은 미분류로 읽음", () => {
    const oldTask = { ...task() } as Partial<Task>;
    delete oldTask.pageId;
    const parsed = parseCloudData({ app: "yellow-note-sync", version: 1, tasks: [oldTask], settings: defaults, deleted: [] });
    expect(parsed.version).toBe(2);
    expect(parsed.tasks[0].pageId).toBeNull();
    expect(parsed.pages).toEqual([]);
  });
});
describe("현지 날짜와 D-day", () => {
  it("미래, 오늘, 과거 및 연도 변경", () => {
    expect(dDay("2026-10-24", "2026-10-21")).toBe("D-3");
    expect(dDay("2026-10-21", "2026-10-21")).toBe("D-Day");
    expect(dDay("2026-10-19", "2026-10-21")).toBe("D+2");
    expect(dayDifference("2027-01-01", "2026-12-31")).toBe(1);
  });
  it("윤년과 DST 경계", () => {
    expect(dayDifference("2024-03-01", "2024-02-28")).toBe(2);
    expect(dayDifference("2026-03-09", "2026-03-07")).toBe(2);
  });
  it("현지 날짜 성분을 보존", () =>
    expect(localDate(new Date(2026, 9, 21, 0, 1))).toBe("2026-10-21"));
  it("유효한 달력 날짜만 허용", () => {
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2024-02-29")).toBe(true);
  });
});
describe("정렬과 핀", () => {
  const a = task({
      title: "일반",
      dueDate: "2026-10-20",
      priority: "high",
      sortOrder: 0,
    }),
    p = task({
      title: "고정",
      pinned: true,
      dueDate: "2026-12-01",
      priority: "low",
      sortOrder: 9,
    }),
    empty = task({ title: "미설정", sortOrder: 1 });
  for (const sortMode of ["created", "due", "priority", "manual"] as const)
    for (const direction of ["asc", "desc"] as const) {
      it(`${sortMode}/${direction}: 핀 우선`, () =>
        expect(
          sortedTasks([a, p, empty], { ...defaults, sortMode, direction })[0]
            .id,
        ).toBe(p.id));
    }
  for (const sortMode of ["due", "priority"] as const)
    for (const direction of ["asc", "desc"] as const) {
      it(`${sortMode}/${direction}: 미설정 마지막`, () =>
        expect(
          sortedTasks([empty, a], { ...defaults, sortMode, direction })[1].id,
        ).toBe(empty.id));
    }
  it("정렬값이 같으면 ID로 안정적 정렬", () => {
    const b = task();
    expect(sortedTasks([a, b], defaults).map((t) => t.id)).toEqual(
      sortedTasks([b, a], defaults).map((t) => t.id),
    );
  });
  it("고정 완료 항목은 표시 설정에 따르고 데이터는 보존", () => {
    const done = {
      ...p,
      completed: true,
      completedAt: "2020-01-01T00:00:00.000Z",
    };
    const source = [a, done];
    expect(sortedTasks(source, defaults)[0]).toBe(done);
    expect(sortedTasks(source, { ...defaults, showCompleted: false })).toEqual([
      a,
    ]);
    expect(source).toHaveLength(2);
    expect(done.pinned).toBe(true);
  });
  it("다른 그룹으로 드래그를 거부", () =>
    expect(reorderTasks([a, p], defaults, a.id, p.id)).toBeNull());
  it("완료 제외 시 상하단 배치가 핀보다 우선하고 완료 항목은 수동 순서 유지", () => {
    const doneA = task({ completed: true, completedAt: "2026-10-20T00:00:00.000Z", sortOrder: 2, dueDate: "2026-10-01" });
    const doneB = task({ completed: true, completedAt: "2026-10-20T00:00:00.000Z", sortOrder: 1, dueDate: "2026-12-01" });
    const source = [doneA, p, a, doneB];
    const config = { ...defaults, sortMode: "due" as const, completedSort: "top" as const };
    expect(sortedTasks(source, config).map(t => t.id)).toEqual([doneB.id, doneA.id, p.id, a.id]);
    expect(sortedTasks(source, { ...config, completedSort: "bottom" }).map(t => t.id)).toEqual([p.id, a.id, doneB.id, doneA.id]);
    expect(sortedTasks(source, { ...config, showCompleted: false }).map(t => t.id)).toEqual([p.id, a.id]);
    expect(reorderTasks(source, config, a.id, doneA.id)).toBeNull();
  });
  it("표시 순서를 수동 순서로 바꾸고 숨긴 항목도 보존", () => {
    const b = task({ title: "나중", createdAt: "2026-10-22T00:00:00.000Z" }),
      hidden = task({
        completed: true,
        completedAt: "2026-10-20T00:00:00.000Z",
      });
    const settings = { ...defaults, showCompleted: false };
    const next = reorderTasks([a, p, b, hidden], settings, b.id, a.id)!;
    expect(
      sortedTasks(next, { ...settings, sortMode: "manual" }).map((t) => t.id),
    ).toEqual([p.id, b.id, a.id]);
    expect(next).toHaveLength(4);
  });
});
describe("백업과 IndexedDB", () => {
  it("완료 정렬 설정은 백업에 보존하고 잘못된 값은 거부", () => {
    const backup = makeBackup([], { ...defaults, completedSort: "top" });
    expect(parseBackup(JSON.stringify(backup)).settings.completedSort).toBe("top");
    expect(() => parseBackup(JSON.stringify({ ...backup, settings: { ...backup.settings, completedSort: "invalid" } }))).toThrow();
  });
  it("한글, 줄바꿈, 핀, 완료, 설정 왕복", () => {
    const b = makeBackup(
      [task({ memo: "10월 20일: 접수\n10월 21일: 현장 확인", pinned: true })],
      {
        ...defaults,
        sortMode: "priority",
        direction: "desc",
        showCompleted: false,
      },
    );
    expect(parseBackup(JSON.stringify(b))).toEqual(b);
  });
  it("페이지와 소속 할 일을 백업에서 함께 복원함", () => {
    const page: Page = { id: crypto.randomUUID(), name: "공부", sortOrder: 0, updatedAt: "2026-10-20T01:00:00.000Z", deletedAt: null };
    const backup = makeBackup([task({ pageId: page.id })], defaults, [page]);
    expect(parseBackup(JSON.stringify(backup))).toEqual(backup);
    expect(() => parseBackup(JSON.stringify({ ...backup, pages: [] }))).toThrow();
  });
  it.each([
    "invalid-json",
    "version",
    "duplicate",
    "date",
    "priority",
    "timestamp",
    "settings",
    "completed",
  ])("%s 잘못된 백업 거부", (kind) => {
    const b = makeBackup([task()], defaults);
    let raw: unknown = b;
    if (kind === "invalid-json")
      return expect(() => parseBackup("{")).toThrow();
    if (kind === "version") raw = { ...b, version: 99 };
    if (kind === "duplicate") b.tasks.push(b.tasks[0]);
    if (kind === "date") b.tasks[0].dueDate = "2026-02-31";
    if (kind === "priority")
      raw = { ...b, tasks: [{ ...b.tasks[0], priority: "urgent" }] };
    if (kind === "timestamp") b.tasks[0].createdAt = "yesterday";
    if (kind === "settings") raw = { ...b, settings: {} };
    if (kind === "completed") b.tasks[0].completed = true;
    expect(() => parseBackup(JSON.stringify(raw))).toThrow();
  });
  it("저장, 수정, 재연결, 전체 복원, 삭제", async () => {
    const database = new NoteDatabase(`test-${crypto.randomUUID()}`),
      t = task();
    await database.tasks.add(t);
    await database.tasks.update(t.id, { title: "수정됨", pinned: true });
    await database.settings.put({ ...defaults, sortMode: "manual" });
    database.close();
    await database.open();
    expect((await database.tasks.get(t.id))?.pinned).toBe(true);
    expect((await database.tasks.get(t.id))?.title).toBe("수정됨");
    expect((await database.settings.get("preferences"))?.sortMode).toBe(
      "manual",
    );
    const backup = makeBackup([task({ memo: "복원 메모" })], defaults);
    await replaceDatabase(backup, database);
    expect(await database.tasks.toArray()).toEqual(backup.tasks);
    await database.tasks.delete(backup.tasks[0].id);
    expect(await database.tasks.count()).toBe(0);
    await database.delete();
  });
  it("이전 DB의 할 일을 미분류로 이전함", async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(2).stores({ tasks: "id, createdAt, sortOrder", settings: "id", deleted: "id" });
    const previous = { ...task() } as Record<string, unknown>;
    delete previous.pageId;
    await old.table("tasks").put(previous);
    old.close();
    const upgraded = new NoteDatabase(name);
    expect((await upgraded.tasks.get(previous.id as string))?.pageId).toBeNull();
    await upgraded.delete();
  });
  it("버전 1 백업은 미분류로 불러옴", () => {
    const old = { ...makeBackup([task()], defaults), version: 1, pages: undefined, tasks: [task()] };
    old.tasks[0] = { ...old.tasks[0] };
    delete (old.tasks[0] as Partial<Task>).pageId;
    const result = parseBackup(JSON.stringify(old));
    expect(result.version).toBe(2);
    expect(result.tasks[0].pageId).toBeNull();
  });
  it("복원 트랜잭션 실패 시 기존 데이터 보존", async () => {
    const database = new NoteDatabase(`test-${crypto.randomUUID()}`),
      original = task();
    await database.tasks.add(original);
    const broken = { ...task(), id: undefined } as unknown as Task;
    await expect(
      replaceDatabase(makeBackup([broken], defaults), database),
    ).rejects.toThrow();
    expect(await database.tasks.toArray()).toEqual([original]);
    await database.delete();
  });
});
