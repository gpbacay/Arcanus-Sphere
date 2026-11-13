// One small key-value store in IndexedDB, for what localStorage can't hold: a folder handle (it survives reloads only
// here) and the conversations (localStorage stops at about 5 MB). The database keeps the name it had when only the
// workspace used it, so a folder opened before is still remembered.
export function kept<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const open = indexedDB.open("arcanus-workspace", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = run(open.result.transaction("handles", mode).objectStore("handles"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
}
