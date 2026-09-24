// Where the browser keeps the account key between page loads.
//
// IndexedDB can store a CryptoKey object as-is, and a non-extractable one
// comes back non-extractable: page script can encrypt and decrypt with it
// but never read its bytes. That is why the key lives here and not in
// localStorage as a string. It is per origin and per browser profile, so a
// second browser has to unlock again from the password, once.
//
// The viewer script (public/artifact-view.v1.js) reads the same store with
// the same three names. Change one and change both.
//
// Browser only: every function touches `indexedDB` and must be called from
// an effect or a handler, never during render.

const DB = "artifact-keys";
const STORE = "keys";
const ID = "account";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, act) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = act(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

export async function put(key) {
  await run("readwrite", (store) => store.put(key, ID));
}

// The stored CryptoKey, or null. A browser that refuses IndexedDB (private
// windows in some engines) reads as empty, which just means unlocking again.
export async function get() {
  try {
    const key = await run("readonly", (store) => store.get(ID));
    return key instanceof CryptoKey ? key : null;
  } catch {
    return null;
  }
}

export async function clear() {
  try {
    await run("readwrite", (store) => store.delete(ID));
  } catch {
    // Nothing stored, or no store to clear.
  }
}
