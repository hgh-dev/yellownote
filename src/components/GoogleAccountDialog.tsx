import { useEffect, useState } from "react";
import { Cloud } from "lucide-react";
import { Dialog } from "./Dialog";
import {
  firebaseAvailable,
  firebaseConnected,
  firebaseAccountEmail,
  firebaseError,
  connectFirebase,
  disconnectFirebase,
  syncFirebase,
} from "../lib/firebaseSync";

export function GoogleAccountDialog({ onClose }: { onClose: () => void }) {
  const [connected, setConnected] = useState(firebaseConnected);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const update = () => {
      setConnected(firebaseConnected());
      if (firebaseError()) setMessage(firebaseError());
    };
    window.addEventListener("yellow-note-cloud-status", update);
    update();
    return () => window.removeEventListener("yellow-note-cloud-status", update);
  }, []);

  async function sync(connect: boolean) {
    setBusy(true);
    setMessage("");
    try {
      if (connect) await connectFirebase();
      await syncFirebase();
      setMessage("동기화했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "동기화하지 못했습니다.");
    } finally {
      setConnected(firebaseConnected());
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setMessage("");
    try {
      await disconnectFirebase();
      setConnected(false);
      setMessage("로그아웃했습니다. 이 기기의 기록은 유지됩니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그아웃하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Google 계정" onClose={() => { if (!busy) onClose(); }}>
      <section className="settings-section">
        <h3><Cloud size={17} /> Google 계정 동기화</h3>
        <p className="help">
          Google 계정으로 로그인하면 할 일과 설정을 Firebase에 저장하고,
          온라인일 때 다른 기기의 변경사항을 자동으로 합칩니다. 로그아웃 전까지 로그인 상태가 유지됩니다.
          오프라인에서도 이 기기에 저장됩니다.
        </p>
        {connected && firebaseAccountEmail() && <p className="help">연결된 계정: {firebaseAccountEmail()}</p>}
        {firebaseAvailable() ? (
          <div className="button-pair">
            <button disabled={busy} onClick={() => void sync(!connected)}>
              {connected ? "지금 동기화" : "Google 계정으로 연결"}
            </button>
            {connected && <button disabled={busy} onClick={() => void logout()}>로그아웃</button>}
          </div>
        ) : <p className="help">Firebase 웹 앱 설정 후 사용할 수 있습니다.</p>}
        {message && <p className="feedback" role="status">{message}</p>}
      </section>
    </Dialog>
  );
}
