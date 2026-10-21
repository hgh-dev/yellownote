import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  GripVertical,
  Pin,
  Trash2,
  MessageSquare,
  ChevronUp,
  Check,
  MoreHorizontal,
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
  onDelete,
}: {
  task: Task;
  today: string;
  autoFocus: boolean;
  onDelete: () => void;
}) {
  const [memoOpen, setMemoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const title = useRef<HTMLInputElement>(null),
    memo = useRef<HTMLTextAreaElement>(null),
    menu = useRef<HTMLDivElement>(null);
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
  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-row ${task.completed ? "completed" : ""} ${isDragging ? "dragging" : ""} ${isOver ? "drag-over" : ""}`}
      data-testid="task-row"
      data-pinned={task.pinned}
    >
      <div className="task-main">
        <button
          ref={setActivatorNodeRef}
          className="drag-handle icon-button"
          {...attributes}
          {...listeners}
          aria-label={`${label} 순서 이동`}
          title="드래그하거나 Space와 방향키로 이동"
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
        <div className="task-title-group">
        <span className="task-title-measure" aria-hidden="true">
          {task.title || "새로운 할 일을 적어 보세요"}
        </span>
        <input
          ref={title}
          type="text"
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
        <button
          className={`icon-button memo-toggle ${task.memo ? "has-memo" : ""}`}
          aria-label={memoOpen ? "접기" : task.memo ? "메모" : "메모 추가"}
          title={memoOpen ? "메모 접기" : "메모 열기"}
          aria-expanded={memoOpen}
          aria-controls={`memo-${task.id}`}
          onClick={() => setMemoOpen(!memoOpen)}
        >
          {memoOpen ? <ChevronUp size={17} /> : <MessageSquare size={17} />}
        </button>
        </div>
        <div className="task-details">
          <label className="date-control">
            <span className="sr-only">기한</span>
            <input
              type="date"
              aria-label="기한"
              min="1000-01-01"
              max="9999-12-31"
              value={task.dueDate || ""}
              onChange={(e) => {
                if (!e.target.value || validDate(e.target.value))
                  updateTask(task.id, { dueDate: e.target.value || null }, true);
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
              <button
                className="clear-date"
                aria-label="기한 지우기"
                onClick={() => updateTask(task.id, { dueDate: null }, true)}
              >
                ×
              </button>
            </>
          )}
          <span className="detail-divider" />
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
            <option value="high">상</option>
            <option value="medium">중</option>
            <option value="low">하</option>
          </select>
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
              void flush().catch(() => {});
            }}
          />
        </div>
      )}
    </article>
  );
}
