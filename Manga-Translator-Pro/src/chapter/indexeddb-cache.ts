import { cleanTranslationOutput, cleanUserRegionEdits } from './region-edits';
import type { CachedTranslation, ChapterImage, ChapterSession, ChapterStore } from './types';

const fallbackLocks = new WeakMap<ChapterStore, Map<string, Promise<unknown>>>();

/** Shared extension-origin Web Lock covers read/modify/write across worker and offscreen. Never nest the same chapter lock. */
export async function withChapterLock<T>(store: ChapterStore, chapterId: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(`mtp-v040-chapter:${chapterId}`, operation);
  let locks = fallbackLocks.get(store);
  if (!locks) { locks = new Map(); fallbackLocks.set(store, locks); }
  const previous = locks.get(chapterId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  locks.set(chapterId, current);
  try { return await current; } finally { if (locks.get(chapterId) === current) locks.delete(chapterId); }
}

const chapterFields = ['incarnation', 'id', 'url', 'documentIds', 'createdAt', 'updatedAt', 'revision', 'status', 'endObserved', 'completeConfirmed', 'collectionNote', 'options', 'profile', 'queueOwner'] as const;
const imageFields = ['resultRevision', 'id', 'chapterId', 'order', 'canonicalUrl', 'source', 'naturalWidth', 'naturalHeight', 'method', 'access', 'fingerprint', 'contentHash', 'state', 'attempts', 'priority', 'updatedAt', 'cacheKey', 'profileKey', 'nextAttemptAt', 'errorCode', 'errorMessage', 'startedAt', 'completedAt'] as const;
function fields<T>(value: T, keys: readonly string[]): T {
  return Object.fromEntries(keys.filter((key) => Object.prototype.hasOwnProperty.call(value, key))
    .map((key) => [key, (value as Record<string, unknown>)[key]])) as T;
}
function cleanChapter(session: ChapterSession): ChapterSession {
  const value = fields(session, chapterFields);
  return { ...value, options: fields(value.options, ['concurrency', 'maxAttempts', 'glossary', 'overlayVisible', 'overlayBackground', 'qualityMode']),
    ...(value.profile ? { profile: fields(value.profile, ['key', 'model', 'sourceLanguage', 'targetLanguage', 'ocrVersion', 'promptVersion', 'glossaryVersion', 'glossary', 'qualityMode']) } : {}) };
}
function cleanTranslation(entry: CachedTranslation): CachedTranslation {
  return { key: entry.key, imageId: entry.imageId, chapterId: entry.chapterId, contentHash: entry.contentHash,
    profile: fields(entry.profile, ['key', 'model', 'sourceLanguage', 'targetLanguage', 'ocrVersion', 'promptVersion', 'glossaryVersion', 'glossary', 'qualityMode']),
    output: cleanTranslationOutput(entry.output), createdAt: entry.createdAt,
    ...(entry.userEdits ? { userEdits: cleanUserRegionEdits(entry.userEdits, entry.output) } : {}),
  };
}

/** Instantiate only in trusted extension contexts. No bitmaps or credentials are stored. */
export class IndexedDBCache implements ChapterStore {
  private database: Promise<IDBDatabase> | undefined;
  constructor(private readonly name = 'manga-translator-pro-v040', private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('chapters', { keyPath: 'id' });
        const images = db.createObjectStore('images', { keyPath: 'id' });
        images.createIndex('chapterId', 'chapterId');
        images.createIndex('cacheKey', 'cacheKey');
        const translations = db.createObjectStore('translations', { keyPath: 'key' });
        translations.createIndex('chapterId', 'chapterId');
      };
      request.onerror = () => { this.database = undefined; reject(request.error ?? new Error('IndexedDB open failed')); };
      request.onblocked = () => { blocked = true; this.database = undefined; reject(new Error('IndexedDB upgrade blocked by another extension page')); };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.database = undefined; };
        resolve(db);
      };
    });
    return this.database;
  }

  private async read<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readonly');
      const request = transaction.objectStore(store).get(key) as IDBRequest<T | undefined>;
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB read aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB read failed'));
    });
  }
  private async write(store: string, value: unknown): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readwrite');
      transaction.objectStore(store).put(value);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
    });
  }
  getChapter(id: string): Promise<ChapterSession | undefined> { return this.read('chapters', id); }
  putChapter(session: ChapterSession): Promise<void> { return this.write('chapters', cleanChapter(session)); }
  getTranslation(key: string): Promise<CachedTranslation | undefined> { return this.read('translations', key); }
  async putTranslation(entry: CachedTranslation): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('translations', 'readwrite');
      const translations = transaction.objectStore('translations');
      const request = translations.get(entry.key) as IDBRequest<CachedTranslation | undefined>;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const previous = request.result;
          const userEdits = entry.userEdits ?? previous?.userEdits;
          translations.put(cleanTranslation({ ...entry, ...(userEdits ? { userEdits } : {}) }));
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('IndexedDB translation write aborted'));
      transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('IndexedDB translation write failed'));
    });
  }
  putImage(image: ChapterImage): Promise<void> { return this.write('images', fields(image, imageFields)); }

  async listImages(chapterId: string): Promise<ChapterImage[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('images', 'readonly');
      const request = transaction.objectStore('images').index('chapterId').getAll(chapterId) as IDBRequest<ChapterImage[]>;
      transaction.oncomplete = () => resolve(request.result.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB list aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB list failed'));
    });
  }

  /** Delete a chapter atomically without deleting a translation referenced by another chapter. Caller holds withChapterLock. */
  async deleteChapter(chapterId: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['chapters', 'images', 'translations'], 'readwrite');
      const images = transaction.objectStore('images'), translations = transaction.objectStore('translations');
      const allImages = images.getAll() as IDBRequest<ChapterImage[]>;
      const storedTranslations = translations.getAll() as IDBRequest<CachedTranslation[]>;
      let imageList: ChapterImage[] | undefined, entries: CachedTranslation[] | undefined;
      const remove = (): void => {
        if (!imageList || !entries) return;
        const otherKeys = new Set(imageList.filter((image) => image.chapterId !== chapterId).map((image) => image.cacheKey).filter(Boolean));
        const chapterKeys = new Set(imageList.filter((image) => image.chapterId === chapterId).map((image) => image.cacheKey).filter(Boolean));
        for (const image of imageList) if (image.chapterId === chapterId) images.delete(image.id);
        for (const entry of entries) if ((entry.chapterId === chapterId || chapterKeys.has(entry.key)) && !otherKeys.has(entry.key)) translations.delete(entry.key);
        transaction.objectStore('chapters').delete(chapterId);
      };
      allImages.onsuccess = () => { imageList = allImages.result; remove(); };
      storedTranslations.onsuccess = () => { entries = storedTranslations.result; remove(); };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB deletion aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB deletion failed'));
    });
  }
  async close(): Promise<void> {
    const current = this.database;
    this.database = undefined;
    if (current) (await current).close();
  }
}

/** Clone semantics match IndexedDB; used by deterministic queue/registry unit tests. */
export class MemoryChapterStore implements ChapterStore {
  private readonly chapters = new Map<string, ChapterSession>();
  private readonly images = new Map<string, ChapterImage>();
  private readonly translations = new Map<string, CachedTranslation>();
  async getChapter(id: string): Promise<ChapterSession | undefined> { return structuredClone(this.chapters.get(id)); }
  async putChapter(session: ChapterSession): Promise<void> { this.chapters.set(session.id, structuredClone(cleanChapter(session))); }
  async listImages(chapterId: string): Promise<ChapterImage[]> {
    return structuredClone([...this.images.values()].filter((image) => image.chapterId === chapterId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)));
  }
  async putImage(image: ChapterImage): Promise<void> { this.images.set(image.id, structuredClone(fields(image, imageFields))); }
  async getTranslation(key: string): Promise<CachedTranslation | undefined> { return structuredClone(this.translations.get(key)); }
  async putTranslation(entry: CachedTranslation): Promise<void> {
    const userEdits = entry.userEdits ?? this.translations.get(entry.key)?.userEdits;
    this.translations.set(entry.key, structuredClone(cleanTranslation({ ...entry, ...(userEdits ? { userEdits } : {}) })));
  }
  async deleteChapter(chapterId: string): Promise<void> {
    const otherKeys = new Set([...this.images.values()].filter((image) => image.chapterId !== chapterId).map((image) => image.cacheKey));
    const chapterKeys = new Set([...this.images.values()].filter((image) => image.chapterId === chapterId).map((image) => image.cacheKey));
    for (const [id, image] of this.images) if (image.chapterId === chapterId) this.images.delete(id);
    for (const [key, entry] of this.translations) if ((entry.chapterId === chapterId || chapterKeys.has(key)) && !otherKeys.has(key)) this.translations.delete(key);
    this.chapters.delete(chapterId);
  }
}
