// Сохранённые холсты лежат в IndexedDB (в localStorage лимит ~5 МБ — хватало на 5–10 рисунков).

export type SavedCanvas = {
  id: string;
  name: string;
  createdAt: number;
  blob: Blob;      // полный PNG холста
  thumb: string;   // маленькое превью (data URL)
};

const DB_NAME = 'drawing-board';
const STORE = 'canvases';
const LEGACY_KEY = 'drawing-board-saves';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB недоступна в этом браузере.'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Не удалось открыть хранилище.'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('Ошибка записи в хранилище.'));
      tx.onabort = () => reject(tx.error ?? new Error('Операция прервана (возможно, нет места).'));
    });
  } finally {
    db.close();
  }
}

export async function listSaved(): Promise<SavedCanvas[]> {
  const all = await run<SavedCanvas[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const putSaved = (item: SavedCanvas) => run('readwrite', (s) => s.put(item)).then(() => undefined);
export const deleteSaved = (id: string) => run('readwrite', (s) => s.delete(id)).then(() => undefined);

/** Переносим старые сохранения из localStorage один раз. */
export async function migrateLegacy(): Promise<void> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch { return; }
  if (!raw) return;
  try {
    const items = JSON.parse(raw) as Array<{ name?: string; image?: string; date?: string }>;
    let n = 0;
    for (const it of items) {
      if (!it?.image?.startsWith('data:image/')) continue;
      const blob = await (await fetch(it.image)).blob();
      await putSaved({ id: `legacy-${Date.now()}-${n++}`, name: it.name || 'Рисунок', createdAt: Date.now() - n, blob, thumb: it.image });
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Если не получилось — оставляем старые данные как есть.
  }
}
