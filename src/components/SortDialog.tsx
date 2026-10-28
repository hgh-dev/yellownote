import { Check } from "lucide-react";
import { Dialog } from "./Dialog";
import type { Settings, SortMode } from "../types";
import { setSettings } from "../data/store";

const criteria: { mode: Exclude<SortMode, "manual">; label: string; defaultDirection: Settings["direction"] }[] = [
  { mode: "created", label: "등록일", defaultDirection: "asc" },
  { mode: "due", label: "처리기한", defaultDirection: "asc" },
  { mode: "priority", label: "우선순위", defaultDirection: "desc" },
];
const directions: Record<Exclude<SortMode, "manual">, { direction: Settings["direction"]; label: string }[]> = {
  created: [
    { direction: "asc", label: "오래된 순" },
    { direction: "desc", label: "최신순" },
  ],
  due: [
    { direction: "asc", label: "빠른 순" },
    { direction: "desc", label: "늦은 순" },
  ],
  priority: [
    { direction: "desc", label: "높은 순" },
    { direction: "asc", label: "낮은 순" },
  ],
};

export function sortLabel(settings: Settings) {
  if (settings.sortMode === "manual") return "사용자 지정 정렬";
  return `${criteria.find((item) => item.mode === settings.sortMode)?.label ?? ""} · ${directions[settings.sortMode].find((item) => item.direction === settings.direction)?.label ?? ""}`;
}

export function SortDialog({
  settings,
  onClose,
  completedCount,
  onDeleteCompleted,
  pageTitle,
}: {
  settings: Settings;
  onClose: () => void;
  completedCount: number;
  onDeleteCompleted: () => void;
  pageTitle: string;
}) {
  const selected = settings.sortMode === "manual" ? null : settings.sortMode;
  return (
    <Dialog title="할 일 정렬" onClose={onClose}>
      <p className="help">고정한 할 일은 정렬 대상 안에서 맨 위에 놓입니다.</p>
      <div className="sort-section-title">완료한 일 정렬</div>
      <div className="sort-options sort-directions completion-options">
        <button aria-pressed={settings.showCompleted && (!settings.completedSort || settings.completedSort === "include")}
          onClick={() => setSettings({ showCompleted: true, completedSort: "include" })}>포함하여 정렬</button>
        <button aria-pressed={settings.showCompleted && (settings.completedSort === "top" || settings.completedSort === "bottom")}
          onClick={() => setSettings({ showCompleted: true, completedSort: settings.completedSort === "top" ? "top" : "bottom" })}>제외하고 따로 배치</button>
        <button aria-pressed={!settings.showCompleted}
          onClick={() => setSettings({ showCompleted: false })}>완료한 일 표시 안함</button>
      </div>
      {settings.showCompleted && (settings.completedSort === "top" || settings.completedSort === "bottom") && <>
        <div className="sort-section-title">완료한 일 위치</div>
        <div className="sort-options sort-directions">
          <button aria-pressed={settings.completedSort === "top"} onClick={() => setSettings({ completedSort: "top" })}>상단</button>
          <button aria-pressed={settings.completedSort === "bottom"} onClick={() => setSettings({ completedSort: "bottom" })}>하단</button>
        </div>
        <p className="help">완료한 일은 선택한 기준으로 정렬하지 않고 기존 수동 순서로 모아 표시합니다.</p>
      </>}
      {!settings.showCompleted && <p className="help">완료한 일은 삭제되지 않으며, 다른 표시 방법을 선택하면 다시 볼 수 있습니다.</p>}
      <div className="sort-section-title">정렬 기준</div>
      <div className="sort-options sort-criteria">
        {criteria.map((item) => (
          <button
            key={item.mode}
            aria-pressed={selected === item.mode}
            onClick={() => setSettings({ sortMode: item.mode, direction: selected === item.mode ? settings.direction : item.defaultDirection })}
          >
            {item.label}
            {selected === item.mode && <Check size={18} />}
          </button>
        ))}
      </div>
      <div className="sort-section-title">순서</div>
      {selected ? (
        <div className="sort-options sort-directions">
          {directions[selected].map((item) => (
            <button
              key={item.direction}
              aria-pressed={settings.direction === item.direction}
              onClick={() => setSettings({ direction: item.direction })}
            >
              {item.label}
              {settings.direction === item.direction && <Check size={18} />}
            </button>
          ))}
        </div>
      ) : (
        <p className="help">현재 사용자 지정 정렬입니다. 정렬 기준을 선택하면 해당 순서로 표시됩니다.</p>
      )}
      <p className="help">드래그하거나 할 일을 선택한 뒤 Shift+방향키로 순서를 바꿀 수 있습니다. 순서를 바꾸면 사용자 지정 정렬로 전환됩니다.</p>
      <div className="sort-section-title">완료한 기록 정리</div>
      <p className="help">삭제 범위: {pageTitle}</p>
      <div className="button-pair">
        <button className="danger" disabled={!completedCount} onClick={onDeleteCompleted}>
          현재 페이지의 완료한 일 {completedCount}개 삭제
        </button>
      </div>
    </Dialog>
  );
}
