/**
 * Hands the visitor's export file from the public /switch page to the signed-in import, even if signup opens in another tab
 * or goes through an email link. sessionStorage cannot do that (it is per tab and capped around 5 MB); IndexedDB can hold the
 * file itself. The file never leaves the device until the user confirms the import after signing in. Expires after 24 hours.
 */
const DB = 'bukmarkz-pending', STORE = 'kv', KEY = 'import', TTL_MS = 24 * 3600_000;
export interface PendingImport { file: Blob; name: string; source: string | null; count: number; savedAt: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode); const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

/** false when storage is unavailable (private mode, quota): the caller tells the user they will pick the file again after signing in. */
export async function savePending(p: Omit<PendingImport, 'savedAt'>): Promise<boolean> {
  try { await tx('readwrite', (s) => s.put({ ...p, savedAt: Date.now() }, KEY)); return true; } catch { return false; }
}
export async function loadPending(): Promise<PendingImport | null> {
  try {
    const v = (await tx('readonly', (s) => s.get(KEY))) as PendingImport | undefined;
    if (!v || !(v.file instanceof Blob) || Date.now() - v.savedAt > TTL_MS) { if (v) await clearPending(); return null; }
    return v;
  } catch { return null; }
}
export async function clearPending(): Promise<void> { try { await tx('readwrite', (s) => s.delete(KEY)); } catch { /* nothing to clear */ } }
