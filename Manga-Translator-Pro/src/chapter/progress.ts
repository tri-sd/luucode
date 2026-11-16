import type { ChapterImage, ChapterProgress } from './types';

const ACTIVE = new Set(['FETCHING', 'OCR_PROCESSING', 'TRANSLATING', 'RENDER_READY']);
export function chapterProgress(images: readonly ChapterImage[]): ChapterProgress {
  const count = (state: ChapterImage['state']): number => images.filter((image) => image.state === state).length;
  const completed = count('COMPLETED'), failed = count('FAILED'), cancelled = count('CANCELLED');
  const settled = completed + failed + cancelled;
  return { total: images.length, discovered: count('DISCOVERED'), queued: count('QUEUED'),
    active: images.filter((image) => ACTIVE.has(image.state)).length, completed, failed, cancelled, settled,
    percent: images.length ? Math.min(100, settled / images.length * 100) : 0 };
}
export const deriveProgress = chapterProgress;
export class ProgressStateManager {
  snapshot(images: readonly ChapterImage[]): ChapterProgress { return chapterProgress(images); }
}
