import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import {
  ArrowDownUp,
  Settings as SettingsIcon,
  Plus,
  Check,
  BookOpen,
  CloudOff,
  Menu,
  ChevronLeft,
  ChevronRight,
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
  deleteCompletedTasks,
  saveOrder,
  flush,
  updateTask,
} from "./data/store";
import { sortedTasks, newTask, reorderTasks, localDate } from "./lib/tasks";
import { useToday } from "./hooks/useToday";
import { TaskRow } from "./components/TaskRow";
import { SortDialog, sortLabel } from "./components/SortDialog";
import { SettingsDialog, type InstallEvent } from "./components/SettingsDialog";
import { GoogleAccountDialog } from "./components/GoogleAccountDialog";
import { Dialog } from "./components/Dialog";
import { PageSidebar } from "./components/PageSidebar";
import { firebaseAccountEmail, firebaseSaveStatus, restoreFirebaseSession } from "./lib/firebaseSync";
function savedDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((value) => String(value).padStart(2, "0")).join(":");
  return `${localDate(date)} ${time}`;
}
export default function App() {
  const { tasks, pages, settings, ready, saving, lastSavedAt, error } = useNote();
  const [cloudStatus, setCloudStatus] = useState(firebaseSaveStatus);
  const today = useToday(),
    [panel, setPanel] = useState<"sort" | "settings" | "account" | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null),
    [deleteCompletedOpen, setDeleteCompletedOpen] = useState(false),
    [moveTaskId, setMoveTaskId] = useState<string | null>(null),
    [focusId, setFocusId] = useState<string | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine),
    [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [notice, setNotice] = useState(""),
    [updating, setUpdating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedPage, setSelectedPage] = useState<string | null>(() => {
    try { const saved = localStorage.getItem("yellow-note-page"); return saved === null ? "all" : saved || null; } catch { return "all"; }
  });
  const swipeStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const swipeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeAnimating, setSwipeAnimating] = useState(false);
  const swipeLocked = useRef(false);
  useEffect(() => () => { if (swipeTimer.current) clearTimeout(swipeTimer.current); }, []);
  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".page-toggle")?.focus());
  }, []);
  function choosePage(id: string | null) {
    setSelectedPage(id);
    lastAdd.current = 0;
    try { localStorage.setItem("yellow-note-page", id || ""); } catch { /* UI selection can remain in memory. */ }
  }
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
    void initialize().then(restoreFirebaseSession);
    const online = () => {
      setOffline(!navigator.onLine);
    };
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
    const updateCloudStatus = () => setCloudStatus(firebaseSaveStatus());
    window.addEventListener("yellow-note-cloud-status", updateCloudStatus);
    return () => window.removeEventListener("yellow-note-cloud-status", updateCloudStatus);
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
  useEffect(() => {
    if (ready && selectedPage !== "all" && selectedPage !== null && !pages.some((p) => p.id === selectedPage && !p.deletedAt)) choosePage(null);
  }, [ready, selectedPage, pages]);
  const scopedTasks = selectedPage === "all" ? tasks : tasks.filter((t) => t.pageId === selectedPage);
  const visible = sortedTasks(scopedTasks, settings);
  const completed = scopedTasks.filter((t) => t.completed).length;
  const pageTitle = selectedPage === "all" ? "모든 할 일" : selectedPage === null ? "미분류" : pages.find((p) => p.id === selectedPage)?.name || "미분류";
  const pageOrder: (string | null)[] = ["all", null, ...pages.filter((page) => !page.deletedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).map((page) => page.id)];
  const pageIndex = Math.max(0, pageOrder.indexOf(selectedPage));
  const previousPage = pageIndex > 0 ? pageOrder[pageIndex - 1] : undefined;
  const nextPage = pageIndex < pageOrder.length - 1 ? pageOrder[pageIndex + 1] : undefined;
  const titleForPage = (id: string | null) => id === "all" ? "모든 할 일" : id === null ? "미분류" : pages.find((page) => page.id === id)?.name || "미분류";
  const previewPage = (id: string | null | undefined) => {
    if (id === undefined) return null;
    const previewTasks = sortedTasks(id === "all" ? tasks : tasks.filter((task) => task.pageId === id), settings);
    return <div className="swipe-preview" aria-hidden="true">
      <div className="swipe-preview-heading">{titleForPage(id)}</div>
      <div className="swipe-preview-tasks">
        {previewTasks.map((task) => <div className={`swipe-preview-row ${task.completed ? "completed" : ""}`} key={task.id}>
          <span className="swipe-preview-check" />
          <span className="swipe-preview-title">{task.title}</span>
        </div>)}
      </div>
    </div>;
  };
  function resetSwipe() {
    swipeStart.current = null;
    setSwipeAnimating(true);
    setSwipeOffset(0);
    swipeTimer.current = setTimeout(() => { setSwipeAnimating(false); swipeLocked.current = false; swipeTimer.current = null; }, 240);
  }
  function startSwipe(event: TouchEvent<HTMLDivElement>) {
    swipeStart.current = null;
    if (!ready || updating || sidebarOpen || swipeLocked.current || event.touches.length !== 1 || document.querySelector("dialog[open]")) return;
    if ((event.target as Element).closest("input, textarea, select, button, a, [contenteditable='true'], .drag-handle")) return;
    swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, time: Date.now() };
  }
  function moveSwipe(event: TouchEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    if (!start || event.touches.length !== 1) return;
    const dx = event.touches[0].clientX - start.x;
    const dy = event.touches[0].clientY - start.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) { swipeStart.current = null; return; }
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    const destination = dx < 0 ? nextPage : previousPage;
    const width = window.innerWidth;
    setSwipeOffset(destination === undefined ? Math.sign(dx) * Math.min(Math.abs(dx) * .22, 48) : Math.max(-width, Math.min(width, dx)));
  }
  function endSwipe(event: TouchEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || sidebarOpen || document.querySelector("dialog[open]")) return;
    const touch = event.changedTouches[0];
    if (!touch) { resetSwipe(); return; }
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const destination = dx < 0 ? nextPage : previousPage;
    const shouldChange = destination !== undefined && Math.abs(dx) > Math.abs(dy) * 1.2 &&
      (Math.abs(dx) > window.innerWidth * .25 || (Math.abs(dx) > 45 && Date.now() - start.time < 350));
    if (!shouldChange) { resetSwipe(); return; }
    swipeLocked.current = true;
    setSwipeAnimating(true);
    setSwipeOffset(dx < 0 ? -window.innerWidth : window.innerWidth);
    swipeTimer.current = setTimeout(() => {
      choosePage(destination);
      setSwipeAnimating(false);
      setSwipeOffset(0);
      swipeLocked.current = false;
      swipeTimer.current = null;
    }, 240);
  }
  const movingTask = tasks.find((task) => task.id === moveTaskId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const collision: CollisionDetection = (args) => {
    const active = tasks.find((t) => t.id === args.active.id);
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => {
          const candidate = tasks.find((t) => t.id === c.id);
          return candidate?.pageId === active?.pageId && candidate?.pinned === active?.pinned &&
            (!settings.completedSort || settings.completedSort === "include" || candidate?.completed === active?.completed);
        },
      ),
    });
  };
  function dragEnd({ active, over }: DragEndEvent) {
    setSelectedId(String(active.id));
    if (!over) return;
    const next = reorderTasks(
      scopedTasks,
      settings,
      String(active.id),
      String(over.id),
    );
    if (next) {
      saveOrder([...tasks.filter((t) => !next.some((item) => item.id === t.id)), ...next]);
      setNotice("순서를 저장했습니다. 사용자 지정 정렬로 전환했습니다.");
    }
  }
  useEffect(() => {
    if (selectedId && !visible.some((task) => task.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, visible]);
  useEffect(() => {
    const clearSelection = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".task-row, dialog, button, a, input, textarea, select, [contenteditable='true']")) return;
      setSelectedId(null);
    };
    document.addEventListener("pointerdown", clearSelection);
    return () => document.removeEventListener("pointerdown", clearSelection);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!ready || updating || sidebarOpen || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || document.querySelector("dialog[open]")) return;
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
        const next = reorderTasks(scopedTasks, settings, visible[index].id, visible[nextIndex].id);
        if (next) {
          saveOrder([...tasks.filter((t) => !next.some((item) => item.id === t.id)), ...next]);
          setNotice("순서를 저장했습니다. 사용자 지정 정렬로 전환했습니다.");
        }
      } else {
        setSelectedId(visible[nextIndex].id);
      }
      document.getElementById(`task-${visible[nextIndex].id}`)?.scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ready, updating, sidebarOpen, selectedId, visible, tasks, scopedTasks, settings]);
  function add() {
    if (!ready || updating || Date.now() - lastAdd.current < 500) return;
    lastAdd.current = Date.now();
    const blank = scopedTasks.find((t) => !t.title.trim() && !t.completed);
    if (blank) {
      setFocusId(null);
      requestAnimationFrame(() => setFocusId(blank.id));
      return;
    }
    const task = newTask(Math.max(-1, ...tasks.map((t) => t.sortOrder)) + 1);
    task.pageId = selectedPage === "all" ? null : selectedPage;
    setFocusId(task.id);
    addTask(task);
  }
  useEffect(() => {
    const onEnter = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" || sidebarOpen ||
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
        (target.isContentEditable || sidebarOpen ||
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
  const localTime = savedDateTime(lastSavedAt);
  const todayLabel = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })
    .format(new Date(`${today}T12:00:00`));
  const synced = cloudStatus.connected && !cloudStatus.syncing && !cloudStatus.error &&
    cloudStatus.lastSyncedAt && lastSavedAt && cloudStatus.lastSyncedAt >= lastSavedAt;
  const statusText = !ready ? "노트를 여는 중…" : error ? "저장 확인 필요" : saving ? "저장 중…" :
    offline ? `오프라인 · 자동 저장됨(${localTime})` :
    cloudStatus.error ? `자동 저장됨(${localTime}) · 동기화 확인 필요` :
    cloudStatus.syncing ? `자동 저장됨(${localTime}) · 동기화 중…` :
    synced ? `자동 저장 및 동기화됨(${savedDateTime(cloudStatus.lastSyncedAt)})` : `자동 저장됨(${localTime})`;
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
          onMove={() => setMoveTaskId(task.id)}
        />
      ))}
    </SortableContext>
  );
  return (
    <div className={`notebook ${sidebarOpen ? "sidebar-open" : ""}`} onTouchStart={startSwipe} onTouchMove={moveSwipe} onTouchEnd={endSwipe} onTouchCancel={resetSwipe}>
      <header className="app-header">
        <div className="brand-group">
          <button className="page-toggle icon-button" aria-label="페이지 목록 열기" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu size={22} /></button>
          <div>
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
          <span className="brand-caption">작은 기록이 만드는 가벼운 하루</span>
          </div>
        </div>
        <nav aria-label="노트 도구">
          <button
            className={`account-button ${cloudStatus.connected ? "signed-in" : "signed-out"}`}
            aria-label={cloudStatus.connected ? `Google 계정 (${firebaseAccountEmail() || "로그인됨"})` : "로그인"}
            title={cloudStatus.connected ? firebaseAccountEmail() || "Google 계정" : "Google 계정 로그인"}
            onClick={() => setPanel("account")}
            disabled={!ready}
          >
            {cloudStatus.connected ? <span className="account-avatar" aria-hidden="true">G</span> : "로그인"}
          </button>
          <button
            className="toolbar-button"
            aria-label="설정"
            onClick={() => setPanel("settings")}
            disabled={!ready}
          >
            <SettingsIcon size={19} />
          </button>
        </nav>
        <div className="header-meta">
          <span className="task-counts">
            나의 할 일 <b>{scopedTasks.filter((t) => !t.completed).length}</b>
            <span className="completed-count">완료 {completed}</span>
          </span>
          <div className="page-switcher">
            <button aria-label="이전 페이지" title="이전 페이지" disabled={previousPage === undefined} onClick={() => { if (previousPage !== undefined) choosePage(previousPage); }}><ChevronLeft size={17} /></button>
            <strong className="current-page-name" title={pageTitle}>{pageTitle}</strong>
            <button aria-label="다음 페이지" title="다음 페이지" disabled={nextPage === undefined} onClick={() => { if (nextPage !== undefined) choosePage(nextPage); }}><ChevronRight size={17} /></button>
          </div>
          <button className="current-sort" onClick={() => setPanel("sort")} disabled={!ready}>
            {sortLabel(settings)}
            <ArrowDownUp size={13} />
          </button>

        </div>
      </header>
      <div className="swipe-viewport"><div className={`swipe-track ${swipeAnimating ? "swipe-animating" : ""}`} style={{ transform: `translate3d(${swipeOffset}px, 0, 0)` }}>
      {previousPage !== undefined && <div className="swipe-adjacent swipe-previous">{previewPage(previousPage)}</div>}
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
            <div className="task-group">{group(visible)}</div>
          </DndContext>
          {ready && !visible.length && (
            <div className="empty-state">
              <BookOpen size={37} strokeWidth={1} />
              <h2>
                {scopedTasks.length
                  ? "해야 할 일을 모두 마쳤어요."
                  : "가벼운 마음으로, 첫 줄부터."}
              </h2>
              <p>
                {scopedTasks.length
                  ? "완료한 기록은 정렬 메뉴에서 다시 볼 수 있어요."
                  : "아래 + 버튼을 눌러 오늘의 할 일을 적어 보세요."}
              </p>
              <span className="empty-flourish">
                한 가지씩 적고, 하나씩 지워요.
              </span>
            </div>
          )}
        </section>
        <footer className="paper-footer">
          <p>{todayLabel}</p>
          <span className="save-state" role="status">
            {offline && ready && !error && !saving ? <CloudOff size={13} /> : ready && !error && !saving ? <Check size={13} /> : null}
            {statusText}
          </span>
        </footer>
      </main>
      {nextPage !== undefined && <div className="swipe-adjacent swipe-next">{previewPage(nextPage)}</div>}
      </div></div>
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
        <SortDialog settings={settings} completedCount={scopedTasks.filter((task) => task.completed).length} pageTitle={pageTitle}
          onDeleteCompleted={() => { setPanel(null); setDeleteCompletedOpen(true); }} onClose={() => setPanel(null)} />
      )}
      {panel === "account" && <GoogleAccountDialog onClose={() => setPanel(null)} />}
      {sidebarOpen && <PageSidebar pages={pages} tasks={tasks} selected={selectedPage} onSelect={choosePage} onClose={closeSidebar} />}
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
      {deleteCompletedOpen && (
        <Dialog title="완료한 일을 모두 삭제하시겠습니까?" onClose={() => setDeleteCompletedOpen(false)}>
          <p className="help">‘{pageTitle}’ 목록의 완료한 일 {scopedTasks.filter((task) => task.completed).length}개와 메모가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p>
          <div className="button-pair dialog-actions">
            <button onClick={() => setDeleteCompletedOpen(false)}>취소</button>
            <button className="danger" onClick={() => { deleteCompletedTasks(selectedPage); setDeleteCompletedOpen(false); }}>모두 삭제</button>
          </div>
        </Dialog>
      )}
      {movingTask && (
        <Dialog title="페이지 이동" onClose={() => setMoveTaskId(null)}>
          <p className="help">{movingTask.title.trim() || "제목 없는 할 일"}을(를) 어느 페이지로 옮길까요?</p>
          <div className="move-page-options">
            {[{ id: null, name: "미분류" }, ...pages.filter((page) => !page.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder)].map((page) => (
              <button key={page.id || "unfiled"} className="move-page-option" aria-pressed={movingTask.pageId === page.id} onClick={() => {
                if (movingTask.pageId !== page.id) updateTask(movingTask.id, { pageId: page.id }, true);
                setMoveTaskId(null);
              }}>
                <span>{page.name}</span>
                {movingTask.pageId === page.id && <Check size={17} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
