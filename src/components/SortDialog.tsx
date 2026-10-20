import { Check } from "lucide-react";
import { Dialog } from "./Dialog";
import type { Settings, SortMode } from "../types";
import { setSettings } from "../data/store";
export const sortOptions: {
  label: string;
  mode: SortMode;
  direction: Settings["direction"];
}[] = [
  { label: "등록순 · 오래된 순", mode: "created", direction: "asc" },
  { label: "등록순 · 최신순", mode: "created", direction: "desc" },
  { label: "기한순 · 빠른 순", mode: "due", direction: "asc" },
  { label: "기한순 · 늦은 순", mode: "due", direction: "desc" },
  { label: "우선순위 · 높은 순", mode: "priority", direction: "desc" },
  { label: "우선순위 · 낮은 순", mode: "priority", direction: "asc" },
  { label: "사용자 지정 정렬", mode: "manual", direction: "asc" },
];
export function sortLabel(settings: Settings) {
  return (
    sortOptions.find(
      (o) =>
        o.mode === settings.sortMode &&
        (o.mode === "manual" || o.direction === settings.direction),
    )?.label || ""
  );
}
export function SortDialog({
  settings,
  onClose,
}: {
  settings: Settings;
  onClose: () => void;
}) {
  return (
    <Dialog title="할 일 정렬" onClose={onClose}>
      <p className="help">고정한 할 일은 어떤 정렬에서도 맨 위에 놓입니다.</p>
      <div className="sort-options">
        {sortOptions.map((o) => (
          <button
            key={o.label}
            aria-pressed={sortLabel(settings) === o.label}
            onClick={() => {
              setSettings({ sortMode: o.mode, direction: o.direction });
              onClose();
            }}
          >
            {o.label}
            {sortLabel(settings) === o.label && <Check size={18} />}
          </button>
        ))}
      </div>
      <p className="help">
        손잡이를 움직이면 현재 순서에서 사용자 지정 정렬로 바뀝니다. 고정 그룹과
        일반 그룹 안에서만 이동할 수 있습니다.
      </p>
    </Dialog>
  );
}
