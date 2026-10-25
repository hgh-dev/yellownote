import { initializeApp, getApps, FirebaseError } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, onAuthStateChanged, setPersistence, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getFirestore, onSnapshot, runTransaction, type DocumentData, type DocumentReference, type Unsubscribe } from 'firebase/firestore';
import { db } from '../data/db';
import { applySynced, flush, getNote } from '../data/store';
import { defaults, type Settings, type Task, type Page } from '../types';
import { parseCloudData, type CloudData, type Deletion } from './cloud';
import { fingerprint, planFirebaseSync } from './syncPlan';

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || 'AIzaSyApnF6NX3DUL354OqZULhqZVt47542oeqc',
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || 'yellownote-85808.firebaseapp.com',
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || 'yellownote-85808',
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) || '1:36916810976:web:b486b0595bd72ae62aec85',
};
const configured = Object.values(firebaseConfig).every(Boolean);
const ownerKey = 'firebase-owner';
const provider = new GoogleAuthProvider();
let setup: Promise<void> | null = null;
let connected = false;
let activeUid: string | null = null;
let authError = '';
let syncing: Promise<void> | null = null;
let syncAgain = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let autoStarted = false;
let readyPromise: Promise<void> | null = null;
let activationPromise: Promise<void> | null = null;
let activatingUid: string | null = null;
let resolveReady: (() => void) | null = null;
let rejectReady: ((error: Error) => void) | null = null;
let subscriptions: Unsubscribe[] = [];
let remote: { tasks?: Task[]; pages?: Page[]; deleted?: Deletion[]; settings?: Settings } = {};

export function firebaseAvailable() { return configured; }
export function firebaseConnected() { return connected; }
export function firebaseError() { return authError; }
export function firebaseAccountEmail() { return configured ? auth().currentUser?.email || '' : ''; }
function notify() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('yellow-note-cloud-status')); }
function fail(error: unknown) {
  authError = error instanceof Error ? error.message : 'Firebase 동기화에 실패했습니다.';
  notify();
}
function store() { return getFirestore(getApps()[0]); }
function auth() { return getAuth(getApps()[0]); }
function userCollection(uid: string, name: 'tasks' | 'pages' | 'deleted') { return collection(store(), 'users', uid, name); }
function settingsRef(uid: string) { return doc(store(), 'users', uid, 'meta', 'settings'); }
function stopListening() {
  for (const unsubscribe of subscriptions) unsubscribe();
  subscriptions = [];
  clearTimeout(timer);
  syncAgain = false;
  if (rejectReady) rejectReady(new Error('로그인이 해제되었습니다.'));
  readyPromise = null;
  resolveReady = null;
  rejectReady = null;
  activeUid = null;
  connected = false;
  remote = {};
  notify();
}
function scheduleSync(delay = 700) {
  if (!connected || !readyPromise || !remote.tasks || !remote.pages || !remote.deleted || !remote.settings) return;
  if (syncing) { syncAgain = true; return; }
  clearTimeout(timer);
  timer = setTimeout(() => { void syncFirebase().catch(fail); }, delay);
}
function startAutoSync() {
  if (autoStarted) return;
  autoStarted = true;
  window.addEventListener('yellow-note-change', () => scheduleSync());
  window.addEventListener('online', () => scheduleSync(0));
  window.addEventListener('focus', () => scheduleSync(0));
  window.setInterval(() => { if (navigator.onLine) scheduleSync(0); }, 30 * 60 * 1000);
}
async function activateUser(user: User): Promise<void> {
  if (activeUid === user.uid && readyPromise) return readyPromise;
  stopListening();
  const owner = await db.meta.get(ownerKey);
  if (auth().currentUser?.uid !== user.uid) return;
  if (owner && owner.value !== user.uid) {
    await signOut(auth());
    throw new Error('이 기기의 노트는 다른 Google 계정에 연결되어 있습니다. 기존 계정으로 로그인해 주세요.');
  }
  if (!owner) await db.meta.put({ key: ownerKey, value: user.uid });
  activeUid = user.uid;
  connected = true;
  authError = '';
  startAutoSync();
  readyPromise = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  notify();
  const updated = () => {
    if (!remote.tasks || !remote.pages || !remote.deleted || !remote.settings) return;
    if (resolveReady) { resolveReady(); resolveReady = null; rejectReady = null; }
    scheduleSync(0);
  };
  const subscriptionError = (error: Error) => {
    const shown = error instanceof FirebaseError && error.code === 'permission-denied'
      ? new Error('Firestore 접근이 거부되었습니다. 보안 규칙을 확인해 주세요.') : error;
    if (rejectReady) { rejectReady(shown); rejectReady = null; resolveReady = null; }
    stopListening();
    fail(shown);
  };
  const listenOptions = { includeMetadataChanges: true };
  for (const name of ['tasks', 'pages', 'deleted'] as const) {
    subscriptions.push(onSnapshot(userCollection(user.uid, name), listenOptions, (snapshot) => {
      if (activeUid !== user.uid || snapshot.metadata.fromCache) return;
      (remote as Record<string, unknown>)[name] = snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
      updated();
    }, subscriptionError));
  }
  subscriptions.push(onSnapshot(settingsRef(user.uid), listenOptions, (snapshot) => {
    if (activeUid !== user.uid || snapshot.metadata.fromCache) return;
    remote.settings = snapshot.exists() ? snapshot.data() as Settings : defaults;
    updated();
  }, subscriptionError));
  return readyPromise;
}
function attachUser(user: User): Promise<void> {
  if (activeUid === user.uid && readyPromise) return readyPromise;
  if (activatingUid === user.uid && activationPromise) return activationPromise;
  activatingUid = user.uid;
  activationPromise = activateUser(user).finally(() => {
    if (activatingUid === user.uid) {
      activatingUid = null;
      activationPromise = null;
    }
  });
  return activationPromise;
}
async function setupFirebase() {
  if (!configured) throw new Error('Firebase 웹 앱 설정이 필요합니다.');
  if (setup) return setup;
  setup = (async () => {
    if (!getApps().length) initializeApp(firebaseConfig);
    await setPersistence(auth(), browserLocalPersistence);
    onAuthStateChanged(auth(), (user) => {
      if (user) void attachUser(user).catch(fail);
      else stopListening();
    }, fail);
  })().catch((error) => { setup = null; throw error; });
  return setup;
}
export async function restoreFirebaseSession() {
  if (!configured) return;
  try { await setupFirebase(); } catch (error) { fail(error); }
}
export async function connectFirebase() {
  await setupFirebase();
  if (auth().currentUser) { await attachUser(auth().currentUser!); return; }
  const result = await signInWithPopup(auth(), provider);
  await attachUser(result.user);
}
export async function disconnectFirebase() {
  await setupFirebase();
  await signOut(auth());
  stopListening();
}

async function writeIfNewer<T extends DocumentData>(reference: DocumentReference, item: T, timestamp: 'updatedAt' | 'deletedAt') {
  await runTransaction(store(), async (transaction) => {
    const current = await transaction.get(reference);
    const previous = current.exists() ? current.data() : null;
    const previousStamp = previous?.[timestamp] || '';
    const nextStamp = item[timestamp] || '';
    if (!previous || previousStamp < nextStamp || (previousStamp === nextStamp && fingerprint(previous) !== fingerprint(item)))
      transaction.set(reference, item);
  });
}
async function deleteTaskIfOlder(uid: string, item: Deletion) {
  const reference = doc(userCollection(uid, 'tasks'), item.id);
  await runTransaction(store(), async (transaction) => {
    const current = await transaction.get(reference);
    if (current.exists() && (current.data().updatedAt || '') <= item.deletedAt)
      transaction.delete(reference);
  });
}
async function runLimited(jobs: Array<() => Promise<void>>, size = 10) {
  for (let index = 0; index < jobs.length; index += size)
    await Promise.all(jobs.slice(index, index + size).map((job) => job()));
}
export function syncFirebase(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    if (!navigator.onLine) throw new Error('인터넷 연결 후 다시 동기화해 주세요.');
    const uid = activeUid;
    if (!uid || !connected) throw new Error('Google 로그인이 필요합니다.');
    await readyPromise;
    await flush();
    const { tasks, settings, pages } = getNote();
    const local: CloudData = { app: 'yellow-note-sync', version: 2, tasks, settings, pages, deleted: await db.deleted.toArray() };
    const cloud = parseCloudData({ app: 'yellow-note-sync', version: 2, tasks: [...remote.tasks!], pages: [...remote.pages!], deleted: [...remote.deleted!], settings: remote.settings! });
    const plan = planFirebaseSync(local, cloud);
    await runLimited(plan.pagesToWrite
      .map((item) => () => writeIfNewer(doc(userCollection(uid, 'pages'), item.id), item, 'updatedAt')));
    await runLimited(plan.tasksToWrite
      .map((item) => () => writeIfNewer(doc(userCollection(uid, 'tasks'), item.id), item, 'updatedAt')));
    await runLimited(plan.deletionsToWrite
      .map((item) => () => writeIfNewer(doc(userCollection(uid, 'deleted'), item.id), item, 'deletedAt')));
    await runLimited(plan.tasksToDelete.map((item) => () => deleteTaskIfOlder(uid, item)));
    if (plan.settingsToWrite)
      await writeIfNewer(settingsRef(uid), plan.settingsToWrite, 'updatedAt');
    if (activeUid !== uid) return;
    if (getNote().tasks !== tasks || getNote().settings !== settings || getNote().pages !== pages) {
      syncAgain = true;
      return;
    }
    if (plan.applyToLocal)
      await applySynced(plan.combined.tasks, plan.combined.settings, plan.combined.deleted, plan.combined.pages);
    authError = '';
    notify();
  })().finally(() => {
    syncing = null;
    if (syncAgain) { syncAgain = false; scheduleSync(0); }
  });
  return syncing;
}
