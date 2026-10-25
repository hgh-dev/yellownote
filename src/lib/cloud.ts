import { db } from "../data/db";
import { applySynced, flush, getNote } from "../data/store";
import { normalizeTask, validPage, validSettings } from "./backup";
import type { Settings, Task, Page } from "../types";

type Deletion = { id: string; deletedAt: string };
type CloudData = { app: "yellow-note-sync"; version: 2; tasks: Task[]; settings: Settings; deleted: Deletion[]; pages: Page[] };
type TokenResponse = { access_token?: string; error?: string };
type TokenClient = { requestAccessToken(options?: { prompt?: string }): void };
declare global {
  interface Window {
    google?: { accounts: { oauth2: {
      initTokenClient(options: { client_id: string; scope: string; callback: (response: TokenResponse) => void }): TokenClient;
      revoke(token: string): void;
    } } };
  }
}

const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ||
  "829935199700-3f04te123lbub99p7i2lb1q1dthbm345.apps.googleusercontent.com";
const filename = "yellow-note-sync.json";
const scope = "https://www.googleapis.com/auth/drive.appdata";
const serverSync = import.meta.env.VITE_SERVER_SYNC === "true";
const api = (import.meta.env.VITE_SYNC_API_URL as string | undefined)?.replace(/\/$/, "") || "";
const sessionKey = "yellow-note-session";
let token: string | null = null;
let serverConnected = false;
let syncing: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let autoStarted = false;

export function cloudAvailable() { return serverSync ? !!api : !!clientId; }
export function cloudConnected() { return serverSync ? serverConnected : !!token; }

export async function restoreGoogleSession() {
  if (!serverSync) return;
  try {
    const code = new URLSearchParams(window.location.hash.slice(1)).get("login");
    if (code) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      const exchanged = await fetch(`${api}/api/auth/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (!exchanged.ok) throw new Error("Google 연결을 완료하지 못했습니다.");
      localStorage.setItem(sessionKey, (await exchanged.json() as { session: string }).session);
    }
    const saved = localStorage.getItem(sessionKey);
    if (!saved) return;
    const response = await fetch(`${api}/api/session`, { headers: { Authorization: `Bearer ${saved}` }, cache: "no-store" });
    serverConnected = response.ok && (await response.json() as { connected: boolean }).connected;
    if (serverConnected) {
      startAutoSync();
      void syncGoogle().catch(() => {});
    }
  } catch { serverConnected = false; }
  window.dispatchEvent(new Event("yellow-note-cloud-status"));
}

function loadGoogle(): Promise<void> {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => window.google?.accounts.oauth2 ? resolve() : reject(new Error("Google 로그인을 불러오지 못했습니다."));
    script.onerror = () => reject(new Error("Google 로그인을 불러오지 못했습니다."));
    document.head.append(script);
  });
}

export async function connectGoogle() {
  if (serverSync) { window.location.assign(`${api}/api/auth/start`); return; }
  if (!clientId) throw new Error("Google 로그인 설정이 아직 없습니다. VITE_GOOGLE_CLIENT_ID를 설정해 주세요.");
  await loadGoogle();
  return new Promise<void>((resolve, reject) => {
    window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (response) => {
        if (response.error || !response.access_token) reject(new Error("Google 로그인이 취소되었거나 실패했습니다."));
        else { token = response.access_token; startAutoSync(); resolve(); }
      },
    }).requestAccessToken();
  });
}

export async function disconnectGoogle() {
  if (serverSync) {
    const saved = localStorage.getItem(sessionKey);
    const response = await fetch(`${api}/api/logout`, { method: "POST", headers: { Authorization: `Bearer ${saved}` } });
    if (!response.ok) throw new Error("로그아웃하지 못했습니다. 다시 시도해 주세요.");
    localStorage.removeItem(sessionKey);
    serverConnected = false;
    clearTimeout(timer);
    window.dispatchEvent(new Event("yellow-note-cloud-status"));
    return;
  }
  if (token) window.google?.accounts.oauth2.revoke(token);
  token = null;
  clearTimeout(timer);
  window.dispatchEvent(new Event("yellow-note-cloud-status"));
}

async function request(path: string, init: RequestInit = {}) {
  if (!token) throw new Error("Google 로그인이 필요합니다.");
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  if (response.status === 401) { token = null; throw new Error("Google 로그인 시간이 만료되었습니다. 다시 로그인해 주세요."); }
  if (!response.ok) throw new Error(`Google Drive 동기화 실패 (${response.status}).`);
  return response;
}

export function parseCloudData(data: unknown): CloudData {
  const d = data as Partial<CloudData> & { version?: number };
  if (!d || d.app !== "yellow-note-sync" || ![1, 2].includes(d.version || 0) || !Array.isArray(d.tasks) ||
    !d.tasks.every((task) => normalizeTask(task) !== null) || !validSettings(d.settings) || !Array.isArray(d.deleted) ||
    !d.deleted.every((item) => item && typeof item.id === "string" && typeof item.deletedAt === "string" && Number.isFinite(Date.parse(item.deletedAt))) ||
    (d.version === 2 && (!Array.isArray(d.pages) || !d.pages.every(validPage))) ||
    new Set(d.tasks.map((task) => task.id)).size !== d.tasks.length)
    throw new Error("Drive에 저장된 동기화 데이터 형식이 올바르지 않습니다.");
  return { app: "yellow-note-sync", version: 2, tasks: d.tasks.map((t) => normalizeTask(t)!), settings: d.settings!, deleted: d.deleted, pages: d.version === 2 ? d.pages! : [] };
}

async function findFile(): Promise<string | null> {
  const params = new URLSearchParams({ spaces: "appDataFolder", fields: "nextPageToken,files(id,name)", q: `name = '${filename}' and trashed = false`, pageSize: "100" });
  const list = await (await request(`files?${params}`)).json() as { files?: { id: string; name: string }[] };
  return list.files?.find((file) => file.name === filename)?.id || null;
}

async function serverRequest(method: "GET" | "PUT", data?: CloudData): Promise<CloudData | null> {
  const response = await fetch(`${api}/api/cloud`, {
    method, cache: "no-store",
    headers: { Authorization: `Bearer ${localStorage.getItem(sessionKey) || ""}`, ...(data ? { "Content-Type": "application/json" } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (response.status === 401) {
    serverConnected = false;
    localStorage.removeItem(sessionKey);
    window.dispatchEvent(new Event("yellow-note-cloud-status"));
    throw new Error("Google 연결이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (!response.ok) throw new Error(`Google Drive 동기화 실패 (${response.status}).`);
  return method === "GET" ? ((await response.json()) as CloudData | null) : null;
}

export function mergeCloudData(local: CloudData, remote: CloudData): CloudData {
  const tasks = new Map<string, Task>();
  const deleted = new Map<string, Deletion>();
  const pages = new Map<string, Page>();
  for (const page of [...local.pages, ...remote.pages]) {
    const old = pages.get(page.id);
    if (!old || old.updatedAt <= page.updatedAt) pages.set(page.id, page);
  }
  for (const item of [...local.deleted, ...remote.deleted]) {
    const old = deleted.get(item.id);
    if (!old || old.deletedAt < item.deletedAt) deleted.set(item.id, item);
  }
  for (const task of [...local.tasks, ...remote.tasks]) {
    const old = tasks.get(task.id);
    if (!old || old.updatedAt < task.updatedAt) tasks.set(task.id, task);
  }
  for (const [id, task] of tasks) {
    const removal = deleted.get(id);
    if (removal && removal.deletedAt >= task.updatedAt) tasks.delete(id);
    else deleted.delete(id);
  }
  for (const [id, task] of tasks) {
    if (task.pageId && (!pages.has(task.pageId) || pages.get(task.pageId)?.deletedAt))
      tasks.set(id, { ...task, pageId: null });
  }
  const settings = (local.settings.updatedAt || "") > (remote.settings.updatedAt || "") ? local.settings : remote.settings;
  return { app: "yellow-note-sync", version: 2, tasks: [...tasks.values()], deleted: [...deleted.values()], pages: [...pages.values()], settings };
}

async function upload(fileId: string | null, data: CloudData) {
  const metadata = { name: filename, mimeType: "application/json", parents: ["appDataFolder"] };
  const boundary = `yellow_note_${crypto.randomUUID()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(fileId ? { name: filename } : metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const response = await fetch(url, { method: fileId ? "PATCH" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  if (!response.ok) throw new Error(`Google Drive에 저장하지 못했습니다 (${response.status}).`);
}

export function syncGoogle(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    if (!navigator.onLine) throw new Error("인터넷 연결 후 다시 동기화해 주세요.");
    await flush();
    const { tasks, settings, pages } = getNote();
    const local: CloudData = { app: "yellow-note-sync", version: 2, tasks, settings, pages, deleted: await db.deleted.toArray() };
    const fileId = serverSync ? null : await findFile();
    const serverData = serverSync ? await serverRequest("GET") : null;
    const remote = serverSync ? serverData ? parseCloudData(serverData) : null : fileId ? parseCloudData(await (await request(`files/${encodeURIComponent(fileId)}?alt=media`)).json()) : null;
    const combined = remote ? mergeCloudData(local, remote) : local;
    if (serverSync) await serverRequest("PUT", combined);
    else await upload(fileId, combined);
    if (getNote().tasks !== tasks || getNote().settings !== settings || getNote().pages !== pages) {
      window.dispatchEvent(new Event("yellow-note-change"));
      return;
    }
    await applySynced(combined.tasks, combined.settings, combined.deleted, combined.pages);
    window.dispatchEvent(new Event("yellow-note-cloud-status"));
  })().finally(() => { syncing = null; });
  return syncing;
}

function startAutoSync() {
  if (autoStarted) return;
  autoStarted = true;
  const schedule = () => {
    if (!cloudConnected()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void syncGoogle().catch(() => {}); }, 2000);
  };
  window.addEventListener("yellow-note-change", schedule);
  window.addEventListener("online", schedule);
  window.addEventListener("focus", schedule);
  window.setInterval(() => { if (cloudConnected() && navigator.onLine) void syncGoogle().catch(() => {}); }, 60000);
}
