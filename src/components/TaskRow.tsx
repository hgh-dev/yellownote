import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  GripVertical,
  Pin,
  Trash2,
  MessageSquare,
  ChevronUp,
  Check,
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
  const title = useRef<HTMLTextAreaElement>(null),
    memo = useRef<HTMLTextAreaElement>(null);
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
    resize(title.current);
  }, [task.title]);
  useLayoutEffect(() => {
    resize(memo.current);
  }, [task.memo, memoOpen]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      resize(title.current);
      resize(memo.current);
    });
    if (title.current) observer.observe(title.current);
    return () => observer.disconnect();
  }, []);
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
        <textarea
          ref={title}
          className="task-title"
          rows={1}
          aria-label="할 일 제목"
          spellCheck={false}
          placeholder="새로운 할 일을 적어 보세요"
          value={task.title}
          onChange={(e) => updateTask(task.id, { title: e.target.value })}
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
        <div className="row-actions">
          <button
            className={`icon-button pin ${task.pinned ? "active" : ""}`}
            aria-label={`${label} ${task.pinned ? "고정 해제" : "상단 고정"}`}
            aria-pressed={task.pinned}
            onClick={() => updateTask(task.id, { pinned: !task.pinned }, true)}
          >
            <Pin size={18} fill={task.pinned ? "currentColor" : "none"} />
          </button>
          <button
            className="icon-button delete"
            aria-label={`${label} 삭제`}
            onClick={onDelete}
          >
            <Trash2 size={17} />
          </button>
        </div>
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
        <button
          className={`memo-toggle ${task.memo ? "has-memo" : ""}`}
          aria-expanded={memoOpen}
          aria-controls={`memo-${task.id}`}
          onClick={() => setMemoOpen(!memoOpen)}
        >
          {memoOpen ? <ChevronUp size={15} /> : <MessageSquare size={15} />}
          <span>{memoOpen ? "접기" : task.memo ? "메모" : "메모 추가"}</span>
        </button>
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
