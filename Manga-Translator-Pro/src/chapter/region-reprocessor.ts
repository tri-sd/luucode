import { isNormalizedBox } from '../core/geometry';
import type { NormalizedBox } from '../core/types';
import { downloadImage, translateRegionCrop } from '../translation/image-pipeline';
import { planRegionCrop } from '../translation/preprocessing';
import { GeminiClient, type Fetcher } from '../translation/gemini-client';
import { throwIfAborted, TranslationError } from '../translation/errors';
import type { TranslationOutput, TranslationSettings } from '../translation/types';
import { contentFingerprint, stableDigest } from './identity';
import { withChapterLock } from './indexeddb-cache';
import type { ChapterStore } from './types';

export interface RegionReprocessRequest {
  readonly chapterId: string; readonly imageId: string; readonly cacheKey: string; readonly expectedRevision: string;
  readonly crop: NormalizedBox; readonly settings: TranslationSettings; readonly apiKey: string;
}
/** Trusted offscreen-only crop retry. Raw page results and user overrides are never overwritten. */
export class RegionReprocessor {
  private readonly flights = new Map<string,Promise<TranslationOutput>>();
  constructor(private readonly store: ChapterStore, private readonly client: Pick<GeminiClient,'translateImage'> = new GeminiClient(), private readonly fetcher: Fetcher = fetch) {}

  async run(request: RegionReprocessRequest, signal: AbortSignal): Promise<TranslationOutput> {
    if (!isNormalizedBox(request.crop)) throw new TranslationError('INVALID_COORDINATES');
    const session = await this.store.getChapter(request.chapterId);
    const image = (await this.store.listImages(request.chapterId)).find((item) => item.id === request.imageId);
    const entry = await this.store.getTranslation(request.cacheKey);
    if (!session?.profile || image?.state !== 'COMPLETED' || image.cacheKey !== request.cacheKey || !entry
      || entry.chapterId !== session.id || entry.profile.key !== session.profile.key || entry.contentHash !== image.contentHash
      || (entry.userEdits?.revision ?? '') !== request.expectedRevision
      || request.settings.model !== session.profile.model || request.settings.sourceLanguage !== session.profile.sourceLanguage) throw new TranslationError('STALE_IMAGE');
    if (image.access !== 'url') throw new TranslationError('LIVE_ONLY');
    // Equivalent floating-point boxes that select the same source pixels share a crop.
    const pixels = planRegionCrop(request.crop,image.naturalWidth,image.naturalHeight).pixels;
    const key = `crop-${stableDigest(JSON.stringify([session.id,entry.contentHash,session.profile.key,pixels,'crop-vision-v2']))}`;
    const current = await this.store.getTranslation(key);
    if (current?.chapterId === session.id && current.contentHash === image.contentHash && current.profile.key === session.profile.key) return current.output;
    const existing = this.flights.get(key);
    if (existing) return existing;
    const operation = (async ():Promise<TranslationOutput> => {
      const blob = await downloadImage(image.source,signal,this.fetcher);
      if (await contentFingerprint(blob) !== entry.contentHash) throw new TranslationError('STALE_IMAGE');
      throwIfAborted(signal);
      const output = await translateRegionCrop(blob,request.crop,{
        selection: {instanceId:'image-1',generation:1,sourceKey:image.id,documentToken:'trusted-region-reprocessor',source:image.source,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight},
        settings:request.settings,apiKey:request.apiKey,signal,onProgress:()=>undefined,
        contextText:JSON.stringify({glossary:session.profile!.glossary,scope:'Only the explicitly selected crop; keep dialogue from separate speakers in separate regions.'}),
      },this.client);
      await withChapterLock(this.store,session.id,async()=>{
        const latest = await this.store.getChapter(session.id), saved = await this.store.getTranslation(entry.key);
        const live = (await this.store.listImages(session.id)).find((item)=>item.id===image.id);
        if (!latest || latest.incarnation!==session.incarnation || latest.createdAt!==session.createdAt || latest.profile?.key!==entry.profile.key
          || live?.cacheKey!==entry.key || live.contentHash!==entry.contentHash || live.source!==image.source
          || !saved || (saved.userEdits?.revision??'')!==request.expectedRevision) throw new TranslationError('STALE_IMAGE');
        throwIfAborted(signal);
        await this.store.putTranslation({key,imageId:image.id,chapterId:session.id,contentHash:entry.contentHash,profile:entry.profile,output,createdAt:Date.now()});
      });
      return output;
    })();
    this.flights.set(key,operation);
    try{return await operation;}finally{if(this.flights.get(key)===operation)this.flights.delete(key);}
  }
}
