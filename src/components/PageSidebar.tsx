import { useEffect, useRef, useState } from "react";
import { GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Page, Task } from "../types";
import { addPage, deletePage, reorderPages, renamePage } from "../data/store";
import { Dialog } from "./Dialog";

function PageItem({ page, count, selected, editMode, onSelect, onRename, onDelete }: {
  page: Page;
  count: number;
  selected: boolean;
  editMode: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: page.id, disabled: !editMode });
  return <div ref={setNodeRef} className={`page-item ${editMode ? "editing" : ""} ${isDragging ? "dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
    {editMode && <button ref={setActivatorNodeRef} className="page-drag-handle" {...attributes} {...listeners} aria-label={`${page.name} 순서 이동`} title="드래그해서 페이지 순서 변경"><GripVertical size={18} /></button>}
    <button className={`page-entry ${selected ? "active" : ""}`} onClick={onSelect}><span>{page.name}</span>{!editMode && <b>{count}</b>}</button>
    {editMode && <div className="page-tools">
      <button aria-label={`${page.name} 이름 변경`} title="이름 변경" onClick={onRename}><Pencil size={16} /></button>
      <button aria-label={`${page.name} 삭제`} title="삭제" onClick={onDelete}><Trash2 size={16} /></button>
    </div>}
  </div>;
}

export function PageSidebar({ pages, tasks, selected, onSelect, onClose }: {
  pages: Page[];
  tasks: Task[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [nameDialog, setNameDialog] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const active = pages.filter((p) => !p.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function dragEnd(event: DragEndEvent) {
    if (event.over && event.active.id !== event.over.id) reorderPages(String(event.active.id), String(event.over.id));
  }

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (removeId || nameDialog) return;
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !window.matchMedia("(max-width: 899px)").matches) return;
      const controls = [...(sidebar.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input") || [])];
      const firstControl = controls[0], lastControl = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); lastControl?.focus(); }
      else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); firstControl?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, removeId, nameDialog]);

  function choose(id: string | null) {
    onSelect(id);
    if (window.matchMedia("(max-width: 899px)").matches) onClose();
  }
  function count(id: string | null) { return tasks.filter((t) => !t.completed && (id === "all" || t.pageId === id)).length; }
  function openNameDialog(id: "new" | string) {
    setNameDialog(id);
    setDraft(id === "new" ? "" : pages.find((p) => p.id === id)?.name || "");
    setError("");
  }
  function saveName() {
    if (!nameDialog) return;
    try {
      if (nameDialog === "new") {
        const id = addPage(draft);
        setNameDialog(null);
        choose(id);
      } else {
        renamePage(nameDialog, draft);
        setNameDialog(null);
      }
      setDraft(""); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "페이지를 저장하지 못했습니다."); }
  }

  return <>
    <button className="page-backdrop" aria-label="페이지 목록 닫기" onClick={onClose} />
    <aside ref={sidebar} className="page-sidebar" aria-label="페이지 목록">
      <header className="page-sidebar-head"><strong>페이지</strong><button className="icon-button" aria-label="페이지 목록 닫기" onClick={onClose}><X size={19} /></button></header>
      <nav aria-label="페이지 선택">
        <button ref={first} className={`page-entry ${selected === "all" ? "active" : ""}`} onClick={() => choose("all")}><span>모든 할 일</span>{!editMode && <b>{count("all")}</b>}</button>
        <button className={`page-entry ${selected === null ? "active" : ""}`} onClick={() => choose(null)}><span>미분류</span>{!editMode && <b>{count(null)}</b>}</button>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
          <SortableContext items={active.map((page) => page.id)} strategy={verticalListSortingStrategy}>
            {active.map((page) => <PageItem key={page.id} page={page} count={count(page.id)} selected={selected === page.id} editMode={editMode} onSelect={() => choose(page.id)} onRename={() => openNameDialog(page.id)} onDelete={() => setRemoveId(page.id)} />)}
          </SortableContext>
        </DndContext>
      </nav>
      <div className="page-sidebar-actions">
        <button onClick={() => openNameDialog("new")}><Plus size={17} />페이지 추가</button>
        <button aria-pressed={editMode} onClick={() => setEditMode((value) => !value)}><Pencil size={16} />{editMode ? "수정 완료" : "페이지 수정"}</button>
      </div>
    </aside>
    {nameDialog && <Dialog title={nameDialog === "new" ? "새 페이지 만들기" : "페이지 이름 변경"} onClose={() => setNameDialog(null)}>
      <form className="page-dialog-form" onSubmit={(event) => { event.preventDefault(); saveName(); }}>
        <label htmlFor="page-name">페이지 이름</label>
        <input id="page-name" autoFocus value={draft} maxLength={40} placeholder="예: 업무" onChange={(event) => setDraft(event.target.value)} />
        {error && <p role="alert">{error}</p>}
        <div className="button-pair dialog-actions"><button type="button" onClick={() => setNameDialog(null)}>취소</button><button type="submit" className="primary-button">{nameDialog === "new" ? "만들기" : "저장"}</button></div>
      </form>
    </Dialog>}
    {removeId && <Dialog title="페이지를 삭제하시겠습니까?" onClose={() => setRemoveId(null)}>
      <p className="help">이 페이지의 할 일 {tasks.filter((t) => t.pageId === removeId).length}개는 미분류로 옮겨집니다. 할 일은 삭제되지 않습니다.</p>
      <div className="button-pair dialog-actions"><button onClick={() => setRemoveId(null)}>취소</button><button className="danger" onClick={() => { deletePage(removeId); if (selected === removeId) onSelect(null); setRemoveId(null); }}>페이지 삭제</button></div>
    </Dialog>}
  </>;
}
