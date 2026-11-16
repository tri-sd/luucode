import { imageIdentity, stableDigest } from './identity';
import type { ImageObservation } from './types';

/** Metadata only: no image elements, screenshots, bitmaps or provider calls are retained. */
export class ChapterCollector {
  private active = false;
  private readonly observed = new Map<string, ImageObservation>();
  private readonly pending = new Map<string, ImageObservation>();

  constructor(readonly chapterId: string) {}

  begin(): void { this.active = true; }
  finish(): void { this.active = false; }
  get collecting(): boolean { return this.active; }
  get count(): number { return this.observed.size; }
  get pendingCount(): number { return this.pending.size; }

  observe(images: readonly ImageObservation[]): void {
    if (!this.active) return;
    for (const image of images) {
      const id = imageIdentity(this.chapterId, image);
      const previous = this.observed.get(id);
      this.observed.set(id, image);
      // A refreshed signed URL must replace the previous request URL without a new image ID.
      if (!previous || previous.source !== image.source || previous.sourceKey !== image.sourceKey
        || previous.pageOrdinal !== image.pageOrdinal) this.pending.set(id, image);
    }
  }

  drain(limit = 50): ImageObservation[] {
    const result: ImageObservation[] = [];
    for (const [id, image] of this.pending) {
      if (result.length >= limit) break;
      result.push(image); this.pending.delete(id);
    }
    return result;
  }

  /** Keep a failed metadata batch available for the next explicit/background synchronization. */
  requeue(images: readonly ImageObservation[]): void {
    for (const image of images) {
      const id = imageIdentity(this.chapterId, image);
      if (!this.pending.has(id)) this.pending.set(id, this.observed.get(id) ?? image);
    }
  }

  snapshot(): readonly ImageObservation[] { return [...this.observed.values()]; }
}

export interface ScrollEvidence {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** Reaching a scroll boundary is a hint only, never proof that a chapter is complete. */
export function hasReachedScrollEnd(evidence: ScrollEvidence): boolean {
  return [evidence.scrollTop, evidence.scrollHeight, evidence.clientHeight].every(Number.isFinite)
    && evidence.clientHeight > 0 && evidence.scrollHeight > evidence.clientHeight + 64
    && evidence.scrollHeight - evidence.clientHeight - evidence.scrollTop <= 8;
}

export function pageOrdinalFromLabels(values: readonly (string | null | undefined)[]): number | undefined {
  for (const value of values) {
    const raw = value?.trim();
    if (!raw) continue;
    const match = raw.match(/^(?:page|trang|página)?\s*#?\s*(\d{1,6})(?:\s*(?:\/|of)\s*\d+)?$/i);
    if (!match?.[1]) continue;
    const ordinal = Number(match[1]);
    if (Number.isSafeInteger(ordinal) && ordinal >= 0) return ordinal;
  }
  return undefined;
}

/** Small sampled fingerprint: useful for static readable canvas identity, not proof of every pixel. */
export function sampledPixelFingerprint(width: number, height: number, pixels: ArrayLike<number>): string {
  return `sample32-${stableDigest(JSON.stringify([width, height, Array.from(pixels)]))}`;
}
