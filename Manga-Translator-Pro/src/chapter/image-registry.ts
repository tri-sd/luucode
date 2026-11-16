import { canonicalImageUrl, imageIdentity } from './identity';
import { withChapterLock } from './indexeddb-cache';
import type { ChapterImage, ChapterSession, ChapterStore, ImageObservation } from './types';

/** Persistent content records outlive the DOM instances that discovered them. No image decode/fetch happens here. */
export class ImageRegistry {
  constructor(private readonly store: ChapterStore, private readonly now: () => number = Date.now) {}

  observe(session: ChapterSession, observations: readonly ImageObservation[], documentId: string): Promise<ChapterImage[]> {
    return withChapterLock(this.store, session.id, async () => {
      const currentSession = await this.store.getChapter(session.id);
      // A late batch cannot recreate a cleared chapter or append work after collection ended.
      if (!currentSession || (currentSession.createdAt !== session.createdAt || currentSession.incarnation !== session.incarnation)) return [];
      const existing = await this.store.listImages(session.id);
      const records = new Map(existing.map((image) => [image.id, image]));
      let nextOrder = existing.reduce((last, image) => Math.max(last, image.order), 0) + 1;
      for (const observation of observations) {
        if (observation.documentToken !== documentId || !observation.source || observation.source.length > 16_000
          || ![observation.naturalWidth, observation.naturalHeight].every((value) => Number.isInteger(value) && value > 0)) continue;
        let canonicalUrl: string;
        try { canonicalUrl = canonicalImageUrl(observation.source); } catch { continue; }
        const id = imageIdentity(session.id, observation), previous = records.get(id);
        if (!previous && currentSession.status !== session.status) continue;
        const access = /^https?:/i.test(observation.source) ? 'url' as const : 'live-only' as const;
        if (previous && previous.source === observation.source && previous.method === observation.method && previous.access === access) continue;
        const order = previous ? previous.order : observation.pageOrdinal !== undefined && Number.isFinite(observation.pageOrdinal) && observation.pageOrdinal >= 0
          ? observation.pageOrdinal : nextOrder++;
        const record: ChapterImage = previous
          ? { ...previous, source: observation.source, method: observation.method, access, updatedAt: this.now() }
          : { id, chapterId: session.id, order, canonicalUrl, source: observation.source,
            naturalWidth: observation.naturalWidth, naturalHeight: observation.naturalHeight, method: observation.method,
            access, ...(observation.fingerprint ? { fingerprint: observation.fingerprint } : {}), state: 'DISCOVERED', attempts: 0,
            priority: 0, updatedAt: this.now() };
        records.set(id, record);
        await this.store.putImage(record);
      }
      return [...records.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    });
  }
}
