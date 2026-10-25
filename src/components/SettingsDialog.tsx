import { useEffect, useRef, useState } from "react";
import { Download, Upload, Smartphone, Cloud } from "lucide-react";
import { Dialog } from "./Dialog";
import { useNote, setSettings, restore } from "../data/store";
import { makeBackup, parseBackup } from "../lib/backup";
import { localDate } from "../lib/tasks";
import type { Backup } from "../types";
import { cloudAvailable, cloudConnected, connectGoogle, disconnectGoogle, syncGoogle } from "../lib/cloud";
export interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export function SettingsDialog({
  onClose,
  installEvent,
  onInstall,
}: {
  onClose: () => void;
  installEvent: InstallEvent | null;
  onInstall: () => void;
}) {
  const { tasks, settings } = useNote();
  const input = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<Backup | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(cloudConnected());
  const [cloudMessage, setCloudMessage] = useState("");
  useEffect(() => {
    const update = () => setConnected(cloudConnected());
    window.addEventListener("yellow-note-cloud-status", update);
    return () => window.removeEventListener("yellow-note-cloud-status", update);
  }, []);
  async function cloudAction(connect: boolean) {
    setBusy(true);
    setCloudMessage("");
    try {
      if (connect) await connectGoogle();
      await syncGoogle();
      setConnected(cloudConnected());
      setCloudMessage("Google Drive와 동기화했습니다.");
    } catch (e) {
      setCloudMessage(e instanceof Error ? e.message : "동기화하지 못했습니다.");
      setConnected(cloudConnected());
    } finally { setBusy(false); }
  }
  function download() {
    // Export the current in-memory content even if browser storage is full.
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(makeBackup(tasks, settings), null, 2)], {
        type: "application/json;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `yellow-note-backup-${localDate()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("백업 파일을 내려받았습니다. 안전한 곳에 보관해 주세요.");
  }
  async function read(file?: File) {
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024)
        throw new Error("50MB 이하의 백업 파일을 선택해 주세요.");
      setCandidate(parseBackup(await file.text()));
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "파일을 읽지 못했습니다.");
    }
    if (input.current) input.current.value = "";
  }
  async function apply() {
    if (!candidate) return;
    setBusy(true);
    try {
      await restore(candidate);
      setCandidate(null);
      setMessage("백업을 복원했습니다. 할 일과 설정을 모두 불러왔습니다.");
    } catch {
      setMessage(
        "복원하지 못했습니다. 저장 공간을 확인해 주세요. 기존 데이터는 유지됩니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="노트 설정"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="setting-line">
        <label htmlFor="show-completed">
          완료된 할 일 표시<span>숨겨도 기록은 그대로 보관됩니다.</span>
        </label>
        <input
          id="show-completed"
          type="checkbox"
          checked={settings.showCompleted}
          onChange={(e) => setSettings({ showCompleted: e.target.checked })}
        />
      </div>
      <section className="settings-section">
        <h3><Cloud size={17} /> Google Drive 동기화</h3>
        <p className="help">
          로그인하면 할 일과 설정을 Google Drive의 앱 전용 공간에 저장하고,
          온라인일 때 다른 기기의 변경사항을 주기적으로 합칩니다.
          오프라인에서도 이 기기에 저장됩니다.
        </p>
        {cloudAvailable() ? (
          <div className="button-pair">
            <button disabled={busy} onClick={() => void cloudAction(!connected)}>
              {connected ? "지금 동기화" : "Google 계정으로 연결"}
            </button>
            {connected && <button disabled={busy} onClick={() => { disconnectGoogle(); setConnected(false); setCloudMessage("연결을 해제했습니다. 기기와 Drive의 기록은 유지됩니다."); }}>연결 해제</button>}
          </div>
        ) : <p className="help">Google OAuth 클라이언트 ID 설정 후 사용할 수 있습니다.</p>}
        {cloudMessage && <p className="feedback" role="status">{cloudMessage}</p>}
      </section>
      <section className="settings-section">
        <h3>백업과 복원</h3>
        <p className="help">
          이 노트는 현재 기기의 브라우저에 저장됩니다. 소중한 기록을 JSON 파일로
          가끔 백업해 주세요.
        </p>
        <div className="button-pair">
          <button onClick={download}>
            <Download size={17} />
            내보내기
          </button>
          <button onClick={() => input.current?.click()}>
            <Upload size={17} />
            가져오기
          </button>
        </div>
        <input
          ref={input}
          className="sr-only"
          type="file"
          accept=".json,application/json"
          aria-label="JSON 백업 파일"
          onChange={(e) => void read(e.target.files?.[0])}
        />
        {candidate && (
          <div className="restore-confirm" role="alert">
            <strong>기존 노트를 덮어쓰시겠습니까?</strong>
            <p>
              현재 할 일 {tasks.length}개와 설정이 백업의 할 일{" "}
              {candidate.tasks.length}개와 설정으로 교체됩니다. 먼저 현재 노트를
              내보내는 것을 권장합니다.
            </p>
            <div className="button-pair">
              <button disabled={busy} onClick={() => setCandidate(null)}>
                취소
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => void apply()}
              >
                {busy ? "복원 중…" : "덮어쓰기 및 복원"}
              </button>
            </div>
          </div>
        )}
        {message && (
          <p className="feedback" role="status">
            {message}
          </p>
        )}
      </section>
      <section className="settings-section">
        <h3>
          <Smartphone size={17} />
          앱으로 사용하기
        </h3>
        {installEvent ? (
          <button className="primary-button" onClick={onInstall}>
            Yellow Note 설치
          </button>
        ) : (
          <p className="help">
            iPhone: Safari의 공유 버튼 → ‘홈 화면에 추가’
            <br />
            Android·PC: 브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를
            선택하세요.
          </p>
        )}
        <p className="help">
          처음 온라인으로 열고 오프라인 준비가 완료되면 인터넷 없이도 사용할 수
          있습니다.
        </p>
      </section>
      <footer className="settings-footer">
        YELLOW NOTE · v1.0
        <br />
        오늘의 기록을, 차곡차곡.
        <br />
        <a href={`${import.meta.env.BASE_URL}privacy.html`}>개인정보처리방침</a>
        {" · "}
        <a href={`${import.meta.env.BASE_URL}terms.html`}>서비스 약관</a>
      </footer>
    </Dialog>
  );
}
