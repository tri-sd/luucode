import { chapterIdentity } from './identity';
import { withChapterLock } from './indexeddb-cache';
import { chapterProgress } from './progress';
import { DEFAULT_CHAPTER_OPTIONS, type ChapterSession, type ChapterStore, type ChapterView } from './types';

type SessionPatch = Partial<Omit<ChapterSession, 'id' | 'url' | 'createdAt' | 'updatedAt' | 'revision'>>;

export class ChapterSessionManager {
  constructor(private readonly store: ChapterStore, private readonly now: () => number = Date.now) {}

  attach(url: string, documentId: string): Promise<ChapterSession> {
    const identity = chapterIdentity(url);
    return withChapterLock(this.store, identity.id, async () => {
      const previous = await this.store.getChapter(identity.id);
      if (previous && previous.url !== identity.url) throw new Error('Chapter identity collision');
      if (previous?.documentIds.includes(documentId)) return previous;
      const timestamp = this.now();
      const session: ChapterSession = previous
        ? { ...previous, documentIds: [...new Set([...previous.documentIds, documentId])].slice(-64), updatedAt: timestamp, revision: previous.revision + 1 }
        : { ...identity, incarnation: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''), documentIds: [documentId], createdAt: timestamp, updatedAt: timestamp, revision: 1,
          status: 'idle', endObserved: false, completeConfirmed: false,
          collectionNote: 'Cuộn hoặc chuyển trang để thu thập ảnh; chưa xác nhận đủ chương.', options: { ...DEFAULT_CHAPTER_OPTIONS } };
      await this.store.putChapter(session);
      return session;
    });
  }

  update(chapterId: string, patch: SessionPatch): Promise<ChapterSession> {
    return withChapterLock(this.store, chapterId, async () => {
      const current = await this.store.getChapter(chapterId);
      if (!current) throw new Error('Chapter no longer exists');
      const session: ChapterSession = { ...current, ...patch, id: current.id, url: current.url, createdAt: current.createdAt,
        updatedAt: this.now(), revision: current.revision + 1 };
      await this.store.putChapter(session);
      return session;
    });
  }

  async view(chapterId: string): Promise<ChapterView> {
    return withChapterLock(this.store, chapterId, async () => {
      const session = await this.store.getChapter(chapterId);
      if (!session) throw new Error('Chapter no longer exists');
      const images = await this.store.listImages(chapterId);
      return { session, images, progress: chapterProgress(images) };
    });
  }

  startCollection(chapterId: string): Promise<ChapterSession> {
    return this.update(chapterId, { status: 'collecting', completeConfirmed: false, collectionNote: 'Vui lòng cuộn đến cuối chương hoặc chuyển qua các trang để thu thập ảnh.' });
  }
  finishCollection(chapterId: string, endObserved = false): Promise<ChapterSession> {
    return this.update(chapterId, { status: 'ready', endObserved,
      collectionNote: endObserved ? 'Đã thấy cuối vùng cuộn; người dùng kết thúc thu thập. Chưa tự khẳng định đủ ảnh.' : 'Người dùng kết thúc thu thập thủ công; chưa xác nhận đủ chương.' });
  }
}
