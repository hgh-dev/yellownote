import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  GripVertical,
  Pin,
  Trash2,
  MessageSquare,
  ChevronUp,
  Check,
  MoreHorizontal,
  CalendarDays,
  ChevronDown,
  FolderInput,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task, Priority } from "../types";
import { updateTask, flush } from "../data/store";
import { dDay, dayDifference } from "../lib/tasks";
import { validDate } from "../lib/backup";
function resize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "44px";
  el.style.height = `${Math.max(44, Math.ceil(el.scrollHeight / 44) * 44)}px`;
}
export function TaskRow({
  task,
  today,
  autoFocus,
  selected,
  onSelect,
  onDelete,
  onMove,
}: {
  task: Task;
  today: string;
  autoFocus: boolean;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  const [memoOpen, setMemoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const title = useRef<HTMLInputElement>(null),
    memo = useRef<HTMLTextAreaElement>(null),
    menu = useRef<HTMLDivElement>(null),
    dateInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: task.id });
  useLayoutEffect(() => {
    resize(memo.current);
  }, [task.memo, memoOpen]);
  useLayoutEffect(() => {
    if (autoFocus) {
      title.current?.focus();
      requestAnimationFrame(() =>
        title.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
      );
    }
  }, [autoFocus]);
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
  };
  const label = task.title.trim() || "제목 없는 할 일";
  const hasMemo = !!task.memo.trim();
  return (
    <article
      id={`task-${task.id}`}
      ref={setNodeRef}
      style={style}
      className={`task-row ${task.completed ? "completed" : ""} ${selected ? "selected" : ""} ${isDragging ? "dragging" : ""} ${isOver ? "drag-over" : ""}`}
      data-testid="task-row"
      data-pinned={task.pinned}
      data-selected={selected}
      tabIndex={-1}
      onClick={(event) => {
        onSelect();
        const target = event.target as HTMLElement;
        if (target.classList.contains("task-title") && !selected) {
          (target as HTMLInputElement).blur();
          event.currentTarget.focus({ preventScroll: true });
        } else if (!target.closest("input, textarea, select, button, a")) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
    >
      <div className="task-main">
        <button
          ref={setActivatorNodeRef}
          className="drag-handle icon-button"
          {...attributes}
          {...listeners}
          aria-label={`${label} 순서 이동`}
          title="드래그하거나 리스트 활성화 후 shift+방향키로 순서 변경"
        >
          <GripVertical size={17} />
        </button>
        <label className="task-checkbox">
          <input
            type="checkbox"
            checked={task.completed}
            aria-label={`${label} 완료`}
            onChange={(e) =>
              updateTask(
                task.id,
                {
                  completed: e.target.checked,
                  completedAt: e.target.checked
                    ? new Date().toISOString()
                    : null,
                },
                true,
              )
            }
          />
          <span>{task.completed && <Check size={16} strokeWidth={2.2} />}</span>
        </label>
        <div className={`task-title-group ${hasMemo ? "has-memo" : ""}`}>
        <span className="task-title-measure" aria-hidden="true">
          {task.title.replace(/[\r\n]+/g, " ") || "새로운 할 일을 적어 보세요"}
        </span>
        <input
          ref={title}
          type="text"
          size={1}
          className="task-title"
          aria-label="할 일 제목"
          spellCheck={false}
          placeholder="새로운 할 일을 적어 보세요"
          value={task.title.replace(/[\r\n]+/g, " ")}
          onChange={(e) => updateTask(task.id, { title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            void flush().catch(() => {});
          }}
          onFocus={(e) => {
            const el = e.currentTarget;
            setTimeout(
              () =>
                el.isConnected &&
                el.scrollIntoView({ block: "nearest", behavior: "smooth" }),
              300,
            );
          }}
        />
        {hasMemo && <button
          className="icon-button memo-toggle has-memo"
          aria-label={memoOpen ? "접기" : "메모"}
          title={memoOpen ? "메모 접기" : "메모 열기"}
          aria-expanded={memoOpen}
          aria-controls={`memo-${task.id}`}
          onClick={() => setMemoOpen(!memoOpen)}
        >
          {memoOpen ? <ChevronUp size={17} /> : <MessageSquare size={17} />}
        </button>}
        </div>
        <div className="task-details">
          <div className={`date-stack ${task.dueDate ? "has-date" : ""}`}>
          <label className="date-control">
            <span className="date-display" aria-hidden="true">
              {task.dueDate || "처리기한"}
            </span>
            <CalendarDays className="date-icon" size={14} aria-hidden="true" />
            <input
              ref={dateInput}
              type="date"
              aria-label="기한"
              min="1000-01-01"
              max="9999-12-31"
              value={task.dueDate || ""}
              onChange={(e) => {
                if (!e.target.value || validDate(e.target.value))
                  updateTask(task.id, { dueDate: e.target.value || null }, true);
              }}
              onClick={() => {
                try {
                  dateInput.current?.showPicker();
                } catch {
                  // The native date field remains available when showPicker is unsupported.
                }
              }}
            />
          </label>
          {task.dueDate && (
            <>
              <span
                className={`d-day ${!task.completed && dayDifference(task.dueDate, today) < 0 ? "overdue" : ""}`}
              >
                {dDay(task.dueDate, today)}
              </span>
            </>
          )}
          </div>
          <span className="detail-divider" />
          <label className={`priority-control ${task.priority || ""}`}>
          <span className="priority-display" aria-hidden="true">
            {task.priority && <span className="priority-dot" />}
            {task.priority === "high" ? "상" : task.priority === "medium" ? "중" : task.priority === "low" ? "하" : "우선순위"}
          </span>
          <ChevronDown size={13} aria-hidden="true" />
          <select
            className={`priority ${task.priority || ""}`}
            aria-label="우선순위"
            value={task.priority || ""}
            onChange={(e) =>
              updateTask(
                task.id,
                { priority: (e.target.value || null) as Priority },
                true,
              )
            }
          >
            <option value="">우선순위</option>
            <option value="high">🔴 상</option>
            <option value="medium">🟠 중</option>
            <option value="low">🟢 하</option>
          </select>
          </label>
        </div>
        <div className="row-actions" ref={menu}>
          <button
            className="icon-button more-toggle"
            aria-label={`${label} 더보기`}
            aria-expanded={menuOpen}
            aria-controls={`actions-${task.id}`}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <MoreHorizontal size={20} />
          </button>
          {menuOpen && <div className="row-menu" id={`actions-${task.id}`}>
          <button
            className={`menu-action pin ${task.pinned ? "active" : ""}`}
            aria-label={`${label} ${task.pinned ? "고정 해제" : "상단 고정"}`}
            onClick={() => {
              updateTask(task.id, { pinned: !task.pinned }, true);
              setMenuOpen(false);
            }}
          >
            <Pin size={17} fill={task.pinned ? "currentColor" : "none"} />
            {task.pinned ? "고정 해제" : "상단 고정"}
          </button>
          <button className="menu-action" aria-label={`${label} 페이지 이동`} onClick={() => { setMenuOpen(false); onMove(); }}>
            <FolderInput size={17} aria-hidden="true" />
            페이지 이동
          </button>
          <button
            className={`menu-action ${hasMemo ? "delete" : ""}`}
            aria-label={`${label} ${hasMemo ? "메모 삭제" : "메모 추가"}`}
            onClick={() => {
              setMenuOpen(false);
              if (hasMemo) {
                updateTask(task.id, { memo: "" }, true);
                setMemoOpen(false);
              } else {
                setMemoOpen(true);
                requestAnimationFrame(() => memo.current?.focus());
              }
            }}
          >
            {hasMemo ? <Trash2 size={17} /> : <MessageSquare size={17} />}
            {hasMemo ? "메모 삭제" : "메모 추가"}
          </button>
          <button
            className="menu-action delete"
            aria-label={`${label} 삭제`}
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={17} />
            삭제
          </button>
          </div>}
        </div>
      </div>
      {memoOpen && (
        <div className="memo-area" id={`memo-${task.id}`}>
          <textarea
            ref={memo}
            rows={1}
            aria-label="진행상황 메모"
            spellCheck={false}
            placeholder="진행상황을 자유롭게 기록하세요…"
            value={task.memo}
            onChange={(e) => updateTask(task.id, { memo: e.target.value })}
            onBlur={() => {
              if (!hasMemo) {
                if (task.memo) updateTask(task.id, { memo: "" });
                setMemoOpen(false);
              }
              void flush().catch(() => {});
            }}
          />
        </div>
      )}
    </article>
  );
}
