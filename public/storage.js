import { APP_CONFIG } from './config.js';

const DB_VERSION = 1;
let databasePromise;

function openDatabase() {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB não está disponível neste navegador.'));
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(APP_CONFIG.databaseName, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(APP_CONFIG.queueStore)) {
          const queue = db.createObjectStore(APP_CONFIG.queueStore, { keyPath: 'id' });
          queue.createIndex('status', 'status', { unique: false });
          queue.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(APP_CONFIG.draftStore)) {
          db.createObjectStore(APP_CONFIG.draftStore, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Falha ao abrir o armazenamento local.'));
    });
  }

  return databasePromise;
}

function transaction(storeName, mode, executor) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Falha na operação local.'));
    tx.onabort = () => reject(tx.error || new Error('Operação local cancelada.'));

    result = executor(store);
  }));
}

export function saveDraft(value) {
  return transaction(APP_CONFIG.draftStore, 'readwrite', (store) => store.put({
    key: 'carbon-form',
    value,
    updatedAt: new Date().toISOString()
  }));
}

export function loadDraft() {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(APP_CONFIG.draftStore, 'readonly');
    const request = tx.objectStore(APP_CONFIG.draftStore).get('carbon-form');
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error || new Error('Falha ao carregar o rascunho.'));
  }));
}

export function clearDraft() {
  return transaction(APP_CONFIG.draftStore, 'readwrite', (store) => store.delete('carbon-form'));
}

export function enqueueOperation(operation) {
  return transaction(APP_CONFIG.queueStore, 'readwrite', (store) => store.put(operation));
}

export function updateOperation(operation) {
  return enqueueOperation(operation);
}

export function removeOperation(id) {
  return transaction(APP_CONFIG.queueStore, 'readwrite', (store) => store.delete(id));
}

export function listPendingOperations() {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(APP_CONFIG.queueStore, 'readonly');
    const request = tx.objectStore(APP_CONFIG.queueStore).getAll();
    request.onsuccess = () => {
      const items = (request.result || [])
        .filter((item) => item.status !== 'synced')
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      resolve(items);
    };
    request.onerror = () => reject(request.error || new Error('Falha ao consultar a fila.'));
  }));
}
