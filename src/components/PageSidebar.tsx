import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Page, Task } from "../types";
import { addPage, deletePage, movePage, renamePage } from "../data/store";
import { Dialog } from "./Dialog";

export function PageSidebar({ pages, tasks, selected, onSelect, onClose }: {
  pages: Page[];
  tasks: Task[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const active = pages.filter((p) => !p.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  useEffect(() => {
    first.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (removeId) return;
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !window.matchMedia("(max-width: 899px)").matches) return;
      const controls = [...(sidebar.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input") || [])];
      const firstControl = controls[0], lastControl = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); lastControl?.focus(); }
      else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); firstControl?.focus(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, removeId]);
  function submit() {
    try {
      if (editing) renamePage(editing, draft);
      else choose(addPage(draft));
      setDraft(""); setEditing(null); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "페이지를 저장하지 못했습니다."); }
  }
  function choose(id: string | null) {
    onSelect(id);
    setEditing(null); setDraft(""); setError("");
    if (window.matchMedia("(max-width: 899px)").matches) onClose();
  }
  function count(id: string | null) { return tasks.filter((t) => !t.completed && (id === "all" || t.pageId === id)).length; }
  return <>
    <button className="page-backdrop" aria-label="페이지 목록 닫기" onClick={onClose} />
    <aside ref={sidebar} className="page-sidebar" aria-label="페이지 목록">
      <header className="page-sidebar-head"><strong>페이지</strong><button className="icon-button" aria-label="페이지 목록 닫기" onClick={onClose}><X size={19} /></button></header>
      <nav aria-label="페이지 선택">
        <button ref={first} className={`page-entry ${selected === "all" ? "active" : ""}`} onClick={() => choose("all")}><span>모든 할 일</span><b>{count("all")}</b></button>
        <button className={`page-entry ${selected === null ? "active" : ""}`} onClick={() => choose(null)}><span>미분류</span><b>{count(null)}</b></button>
        {active.map((page, index) => <div className="page-item" key={page.id}>
          <button className={`page-entry ${selected === page.id ? "active" : ""}`} onClick={() => choose(page.id)}><span>{page.name}</span><b>{count(page.id)}</b></button>
          <div className="page-tools">
            <button aria-label={`${page.name} 이름 변경`} title="이름 변경" onClick={() => { setEditing(page.id); setDraft(page.name); setError(""); }}><Pencil size={14} /></button>
            <button aria-label={`${page.name} 위로`} title="위로" disabled={index === 0} onClick={() => movePage(page.id, -1)}><ArrowUp size={14} /></button>
            <button aria-label={`${page.name} 아래로`} title="아래로" disabled={index === active.length - 1} onClick={() => movePage(page.id, 1)}><ArrowDown size={14} /></button>
            <button aria-label={`${page.name} 삭제`} title="삭제" onClick={() => setRemoveId(page.id)}><Trash2 size={14} /></button>
          </div>
        </div>)}
      </nav>
      <form className="page-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label htmlFor="page-name">{editing ? "페이지 이름 변경" : "새 페이지"}</label>
        <div><input id="page-name" value={draft} maxLength={40} placeholder="예: 업무" onChange={(event) => setDraft(event.target.value)} /><button type="submit" aria-label={editing ? "이름 저장" : "페이지 추가"}>{editing ? <Check size={18} /> : <Plus size={18} />}</button></div>
        {editing && <button type="button" className="page-cancel" onClick={() => { setEditing(null); setDraft(""); setError(""); }}>취소</button>}
        {error && <p role="alert">{error}</p>}
      </form>
    </aside>
    {removeId && <Dialog title="페이지를 삭제하시겠습니까?" onClose={() => setRemoveId(null)}>
      <p className="help">이 페이지의 할 일 {tasks.filter((t) => t.pageId === removeId).length}개는 미분류로 옮겨집니다. 할 일은 삭제되지 않습니다.</p>
      <div className="button-pair dialog-actions"><button onClick={() => setRemoveId(null)}>취소</button><button className="danger" onClick={() => { deletePage(removeId); if (selected === removeId) onSelect(null); setRemoveId(null); }}>페이지 삭제</button></div>
    </Dialog>}
  </>;
}
