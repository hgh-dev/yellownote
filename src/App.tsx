import { useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  Settings as SettingsIcon,
  Plus,
  Check,
  BookOpen,
  CloudOff,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  useNote,
  initialize,
  addTask,
  deleteTask,
  saveOrder,
  flush,
  updateTask,
} from "./data/store";
import { sortedTasks, newTask, reorderTasks } from "./lib/tasks";
import { useToday } from "./hooks/useToday";
import { TaskRow } from "./components/TaskRow";
import { SortDialog, sortLabel } from "./components/SortDialog";
import { SettingsDialog, type InstallEvent } from "./components/SettingsDialog";
import { Dialog } from "./components/Dialog";
export default function App() {
  const { tasks, settings, ready, saving, error } = useNote();
  const today = useToday(),
    [panel, setPanel] = useState<"sort" | "settings" | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null),
    [focusId, setFocusId] = useState<string | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine),
    [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [notice, setNotice] = useState(""),
    [updating, setUpdating] = useState(false);
  const lastAdd = useRef(0);
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: () =>
      setNotice(
        "오프라인 준비에 실패했습니다. 인터넷 연결 후 다시 열어 주세요.",
      ),
  });
  useEffect(() => {
    void initialize();
    const online = () => setOffline(!navigator.onLine);
    const install = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    window.addEventListener("beforeinstallprompt", install);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      window.removeEventListener("beforeinstallprompt", install);
    };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      document.documentElement.style.setProperty(
        "--keyboard-offset",
        `${Math.max(0, window.innerHeight - (viewport?.height || window.innerHeight) - (viewport?.offsetTop || 0))}px`,
      );
    };
    viewport?.addEventListener("resize", resize);
    resize();
    return () => viewport?.removeEventListener("resize", resize);
  }, []);
  const visible = sortedTasks(tasks, settings),
    pinned = visible.filter((t) => t.pinned),
    normal = visible.filter((t) => !t.pinned);
  const completed = tasks.filter((t) => t.completed).length;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const collision: CollisionDetection = (args) => {
    const active = tasks.find((t) => t.id === args.active.id);
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => tasks.find((t) => t.id === c.id)?.pinned === active?.pinned,
      ),
    });
  };
  function dragEnd({ active, over }: DragEndEvent) {
    setSelectedId(String(active.id));
    if (!over) return;
    const next = reorderTasks(
      tasks,
      settings,
      String(active.id),
      String(over.id),
    );
    if (next) {
      saveOrder(next);
      setNotice("순서를 저장했습니다. 사용자 지정 정렬로 전환했습니다.");
    }
  }
  useEffect(() => {
    if (selectedId && !visible.some((task) => task.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, visible]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!ready || updating || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || document.querySelector("dialog[open]")) return;
      const target = event.target;
      if (event.key === "Escape") {
        if (selectedId) {
          event.preventDefault();
          setSelectedId(null);
          if (target instanceof HTMLInputElement && target.classList.contains("task-title")) target.blur();
        }
        return;
      }
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, a, button:not(.drag-handle)"))) return;
      if (event.key === " " || event.code === "Space") {
        const active = visible.find((task) => task.id === selectedId);
        if (active && !event.shiftKey) {
          event.preventDefault();
          updateTask(active.id, {
            completed: !active.completed,
            completedAt: active.completed ? null : new Date().toISOString(),
          }, true);
        }
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (!visible.length) return;
      event.preventDefault();
      const index = visible.findIndex((task) => task.id === selectedId);
      if (index < 0) {
        setSelectedId(visible[0].id);
        document.getElementById(`task-${visible[0].id}`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      const nextIndex = index + (event.key === "ArrowUp" ? -1 : 1);
      if (nextIndex < 0 || nextIndex >= visible.length) return;
      if (event.shiftKey) {
        const next = reorderTasks(tasks, settings, visible[index].id, visible[nextIndex].id);
        if (next) {
          saveOrder(next);
          setNotice("순서를 저장했습니다. 사용자 지정 정렬로 전환했습니다.");
        }
      } else {
        setSelectedId(visible[nextIndex].id);
      }
      document.getElementById(`task-${visible[nextIndex].id}`)?.scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ready, updating, selectedId, visible, tasks, settings]);
  function add() {
    if (!ready || updating || Date.now() - lastAdd.current < 500) return;
    lastAdd.current = Date.now();
    const blank = tasks.find((t) => !t.title.trim() && !t.completed);
    if (blank) {
      setFocusId(null);
      requestAnimationFrame(() => setFocusId(blank.id));
      return;
    }
    const task = newTask(Math.max(-1, ...tasks.map((t) => t.sortOrder)) + 1);
    setFocusId(task.id);
    addTask(task);
  }
  useEffect(() => {
    const onEnter = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        event.isComposing ||
        !window.matchMedia("(pointer: fine)").matches ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, button, a, [role='button'], [role='dialog']"))
      ) return;
      event.preventDefault();
      add();
    };
    document.addEventListener("keydown", onEnter);
    return () => document.removeEventListener("keydown", onEnter);
  });
  async function update() {
    setUpdating(true);
    try {
      await flush();
      await updateServiceWorker(true);
    } catch {
      setNotice("저장을 완료하지 못해 업데이트를 보류했습니다.");
      setUpdating(false);
    }
  }
  const group = (items: typeof tasks) => (
    <SortableContext
      items={items.map((t) => t.id)}
      strategy={verticalListSortingStrategy}
    >
      {items.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          today={today}
          autoFocus={focusId === task.id}
          selected={selectedId === task.id}
          onSelect={() => setSelectedId(task.id)}
          onDelete={() => setDeleteId(task.id)}
        />
      ))}
    </SortableContext>
  );
  const dateText = new Date(`${today}T12:00:00`).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  return (
    <div className="notebook">
      <header className="app-header">
        <div className="brand-group">
          <a
            className="brand"
            href={import.meta.env.BASE_URL}
            aria-label="Yellow Note 홈"
          >
            <span className="brand-mark">
              <Check size={20} />
            </span>
            Yellow Note<span className="brand-dot">.</span>
          </a>
          <span className="brand-caption">MY EVERYDAY NOTE</span>
        </div>
        <nav aria-label="노트 도구">
          <button
            className="toolbar-button"
            aria-label="정렬"
            onClick={() => setPanel("sort")}
            disabled={!ready}
          >
            <ArrowDownUp size={18} />
            <span>정렬</span>
          </button>
          <button
            className="toolbar-button"
            aria-label="설정"
            onClick={() => setPanel("settings")}
            disabled={!ready}
          >
            <SettingsIcon size={19} />
            <span>설정</span>
          </button>
        </nav>
        <div className="header-meta">
          <span className="task-counts">
            나의 할 일 <b>{tasks.filter((t) => !t.completed).length}</b>
            <span className="completed-count">완료 {completed}</span>
          </span>
          <time dateTime={today}>{dateText}</time>
          <button className="current-sort" onClick={() => setPanel("sort")} disabled={!ready}>
            {sortLabel(settings)}
            <ArrowDownUp size={13} />
          </button>

        </div>
      </header>
      <main inert={updating}>
        <section
          className="task-section"
          aria-label="할 일 목록"
          aria-busy={!ready || updating}
        >
          <h1 className="sr-only">나의 할 일</h1>

          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => void flush().catch(() => {})}>
                다시 저장
              </button>
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            onDragEnd={dragEnd}
            accessibility={{
              screenReaderInstructions: {
                draggable:
                  "드래그해서 같은 그룹 안에서 순서를 바꾸세요. 줄을 선택한 뒤 Shift와 방향키로도 이동할 수 있습니다.",
              },
            }}
          >
            {!!pinned.length && (
              <div className="task-group">
                {group(pinned)}
              </div>
            )}
            {!!normal.length && (
              <div className="task-group">
                {group(normal)}
              </div>
            )}
          </DndContext>
          {ready && !visible.length && (
            <div className="empty-state">
              <BookOpen size={37} strokeWidth={1} />
              <h2>
                {tasks.length
                  ? "해야 할 일을 모두 마쳤어요."
                  : "가벼운 마음으로, 첫 줄부터."}
              </h2>
              <p>
                {tasks.length
                  ? "완료한 기록은 설정에서 다시 볼 수 있어요."
                  : "아래 + 버튼을 눌러 오늘의 할 일을 적어 보세요."}
              </p>
              <span className="empty-flourish">
                한 가지씩 적고, 하나씩 지워요.
              </span>
            </div>
          )}
        </section>
        <footer className="paper-footer">
          <p>작은 기록이 만드는 가벼운 하루</p>
          <span className="save-state" role="status">
            {offline ? (
              <>
                <CloudOff size={13} />
                오프라인
              </>
            ) : error ? (
              "저장 확인 필요"
            ) : saving ? (
              "저장 중…"
            ) : ready ? (
              <>
                <Check size={13} />
                자동 저장됨
              </>
            ) : (
              "노트를 여는 중…"
            )}
          </span>
        </footer>
      </main>
      <div className="floating-add">
        <button
          aria-label="새 할 일 추가"
          onClick={add}
          disabled={!ready || updating}
        >
          <Plus size={29} strokeWidth={1.7} />
        </button>
        <span>새 할 일</span>
      </div>
      <div className="sr-only" role="status">
        {notice}
      </div>
      {needRefresh && (
        <div className="update-banner" role="status">
          <span>새 버전이 준비되었습니다.</span>
          <button onClick={() => void update()} disabled={updating}>
            {updating ? "저장 중…" : "저장 후 업데이트"}
          </button>
        </div>
      )}
      {offlineReady && (
        <span
          className="offline-ready"
          title="인터넷 없이도 사용할 수 있습니다"
        >
          오프라인 사용 준비 완료
        </span>
      )}
      {panel === "sort" && (
        <SortDialog settings={settings} onClose={() => setPanel(null)} />
      )}
      {panel === "settings" && (
        <SettingsDialog
          onClose={() => setPanel(null)}
          installEvent={installEvent}
          onInstall={() => {
            if (installEvent)
              void installEvent
                .prompt()
                .then(() => installEvent.userChoice)
                .then(() => setInstallEvent(null));
          }}
        />
      )}
      {deleteId && (
        <Dialog
          title="이 할 일을 삭제하시겠습니까?"
          onClose={() => setDeleteId(null)}
        >
          <p className="help">
            할 일과 진행상황 메모가 함께 삭제됩니다. 이 작업은 되돌릴 수
            없습니다.
          </p>
          <div className="button-pair dialog-actions">
            <button onClick={() => setDeleteId(null)}>취소</button>
            <button
              className="danger"
              onClick={() => {
                deleteTask(deleteId);
                setDeleteId(null);
              }}
            >
              삭제
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
