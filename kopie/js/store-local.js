// Opslag in de browser zelf: IndexedDB met het spel (JSON) en de foto's (Blobs).
const DB_NAME = 'kwartetmaker';
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getMeta(key) {
  const db = await openDb();
  return wrap(db.transaction('meta').objectStore('meta').get(key));
}

export async function setMeta(key, value) {
  const db = await openDb();
  return wrap(db.transaction('meta', 'readwrite').objectStore('meta').put(value, key));
}

export async function getPhoto(id) {
  const db = await openDb();
  return wrap(db.transaction('photos').objectStore('photos').get(id));
}

export async function putPhoto(id, blob) {
  const db = await openDb();
  return wrap(db.transaction('photos', 'readwrite').objectStore('photos').put(blob, id));
}

export async function deletePhoto(id) {
  const db = await openDb();
  return wrap(db.transaction('photos', 'readwrite').objectStore('photos').delete(id));
}

export async function photoIds() {
  const db = await openDb();
  return wrap(db.transaction('photos').objectStore('photos').getAllKeys());
}
