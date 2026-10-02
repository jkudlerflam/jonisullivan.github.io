// Small IndexedDB wrapper. Two stores:
//   kv     - the unsaved draft and other small values
//   blobs  - image files waiting to be uploaded, keyed by their future repo path
// Everything here lives only in this browser, so a draft survives a closed tab
// or a crash but never leaves Joni's computer until she saves.

const DB_NAME = 'site-editor';
const VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const kv = {
  get: key => run('kv', 'readonly', s => s.get(key)),
  set: (key, value) => run('kv', 'readwrite', s => s.put(value, key)),
  del: key => run('kv', 'readwrite', s => s.delete(key)),
};

export const blobs = {
  get: path => run('blobs', 'readonly', s => s.get(path)),
  set: (path, blob) => run('blobs', 'readwrite', s => s.put(blob, path)),
  del: path => run('blobs', 'readwrite', s => s.delete(path)),
  keys: () => run('blobs', 'readonly', s => s.getAllKeys()),
};

// Falls back gracefully when storage is unavailable (private windows, blocked
// site data): the editor still works, it just cannot keep a draft.
export async function storageAvailable() {
  try {
    await kv.set('__probe', 1);
    await kv.del('__probe');
    return true;
  } catch {
    return false;
  }
}
