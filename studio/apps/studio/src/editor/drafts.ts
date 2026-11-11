import { parseAnimation, type Animation } from "@gas/core";

/**
 * Borrador local en IndexedDB: copia del trabajo aún no confirmado por el servidor.
 * Si la pestaña se cierra, el móvil mata el navegador o se corta la red, el trabajo se recupera al volver.
 */
export interface Draft {
  baseRevision: number;
  savedAt: number;
  doc: Animation;
}

const DB = "gas-drafts";
const STORE = "drafts";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(undefined);
      };
    } catch {
      db.close();
      resolve(undefined);
    }
  });
}

export const draftKey = (projectId: string, episodeId: string) => `${projectId}/${episodeId}`;

export async function putDraft(key: string, draft: Draft): Promise<boolean> {
  return (await run("readwrite", (s) => s.put(draft, key))) !== undefined;
}

export async function getDraft(key: string): Promise<Draft | null> {
  const d = await run<unknown>("readonly", (s) => s.get(key));
  if (!d || typeof d !== "object") return null;
  const raw = d as Partial<Draft>;
  try {
    if (typeof raw.baseRevision !== "number") return null;
    return { baseRevision: raw.baseRevision, savedAt: Number(raw.savedAt ?? 0), doc: parseAnimation(raw.doc) };
  } catch {
    return null; // borrador ilegible: se ignora, el servidor manda
  }
}

export async function deleteDraft(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key));
}
