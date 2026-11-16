import { RegionReprocessor } from '../src/chapter/region-reprocessor';
import { contentFingerprint,createTranslationProfile,translationCacheKey,stableDigest } from '../src/chapter/identity';
import { ChapterExecutor } from '../src/chapter/chapter-executor';
import { ChapterService } from '../src/chapter/chapter-service';
import { chapterIdentity } from '../src/chapter/identity';
import { IndexedDBCache } from '../src/chapter/indexeddb-cache';
import { dispatchChapterRpc } from '../src/chapter/rpc';
import { ChapterContentController } from '../src/chapter/content-controller';
import { RegionTracker } from '../src/tracking/region-tracker';
import { DEFAULT_SETTINGS } from '../src/translation/settings';
import type { ImageObservation,TranslationProfile } from '../src/chapter/types';

const store = new IndexedDBCache('mtp-pipeline-tests-v040');
const reprocessor=new RegionReprocessor(store);
const tracker = new RegionTracker({ initialRegions: 'empty' });
let controller: ChapterContentController;
const config = { settings: { ...DEFAULT_SETTINGS, model: 'gemini-pipeline-test' }, apiKey: 'FAKE_CHAPTER_PIPELINE_TEST_KEY_123456789' };
let executor = makeExecutor();
function makeExecutor(): ChapterExecutor { return new ChapterExecutor({ store, retryBaseMs: 5, changed: () => { controller?.refresh(); } }); }
function makeService(): ChapterService { return new ChapterService({ store, privateConfig: async () => config,
  execute: (request) => executor.command(request), permitted: async () => true, changed: () => controller?.refresh() }); }
let service = makeService();
function makeController(): ChapterContentController {
  return new ChapterContentController(tracker,async(request)=>{
    if(request['type']==='chapter:reprocess-region'){
      const observation=request['observation'] as ImageObservation;
      const snapshot=await service.regionSnapshot(location.href,tracker.documentToken,observation);
      if(snapshot.revision!==request['expectedRevision'])throw new Error('STALE_IMAGE');
      return reprocessor.run({chapterId:chapterIdentity(location.href).id,imageId:snapshot.imageId,cacheKey:snapshot.cacheKey,expectedRevision:snapshot.revision,
        crop:request['crop'] as import('../src/core/types').NormalizedBox,...config},new AbortController().signal);
    }
    return dispatchChapterRpc(service,{url:location.href,documentToken:tracker.documentToken},{...request});
  });
}
controller = makeController();
controller.start();

function observations(sources: readonly string[]): ImageObservation[] {
  return sources.map((source, index) => {
    const sourceKey = JSON.stringify([source, 400, 640]);
    return { source: new URL(source, location.origin).href, sourceKey, naturalWidth: 400, naturalHeight: 640, method: 'img',
      documentToken: tracker.documentToken, binding: { instanceId: `image-${index + 1}`, generation: 1, sourceKey }, pageOrdinal: index + 1 };
  });
}
const harness = {
  tracker,
  async edit(){await controller.command('edit');},
  async quickTranslate(){await controller.command('quick-translate');},
  async readSnapshot(){
    const binding=tracker.bindings().find((item)=>item.candidate.element.id==='page-a')!;
    const observation:ImageObservation={...binding.candidate,sourceKey:binding.binding.sourceKey,binding:binding.binding,documentToken:tracker.documentToken};
    return service.regionSnapshot(location.href,tracker.documentToken,observation);
  },
  async retryCrop(crop:import('../src/core/types').NormalizedBox){const snapshot=await this.readSnapshot();return reprocessor.run({chapterId:chapterIdentity(location.href).id,imageId:snapshot.imageId,cacheKey:snapshot.cacheKey,expectedRevision:snapshot.revision,crop,...config},new AbortController().signal);},
  async seedLegacy(count:number){
    await this.collect(count);const view=await this.command('finish');
    const current=createTranslationProfile(config.settings,'');
    const {qualityMode:_qualityMode,...rest}=current;void _qualityMode;
    const base={...rest,ocrVersion:'gemini-vision-v1',promptVersion:'chapter-vision-v1'};
    const profile:TranslationProfile={...base,key:`legacy-${stableDigest(JSON.stringify(base))}`};
    for(const image of view.images){
      const hash=await contentFingerprint(await(await fetch(image.source)).blob());const key=translationCacheKey(`${view.session.id}:${hash}`,profile);
      await store.putTranslation({key,imageId:image.id,chapterId:view.session.id,profile,contentHash:hash,createdAt:Date.now(),output:{sourceLanguage:'en',regions:[{id:'legacy-1',sourceText:'SOURCE',sourceLanguage:'en',text:'Bản cache 0.4',box:{x:.12,y:.15,width:.34,height:.11}}]}});
      await store.putImage({...image,state:'COMPLETED',contentHash:hash,cacheKey:key,profileKey:profile.key});
    }
    await store.putChapter({...view.session,profile,status:'completed',revision:view.session.revision+1});controller.refresh();return this.view();
  },
  async collect(count: number) {
    await service.command(location.href, tracker.documentToken, 'collect');
    const items = observations(Array.from({ length: count }, (_, index) => `/panel.svg?id=PAGE${index}&width=400&height=640`));
    for (let start = 0; start < items.length; start += 50) await service.observe(location.href, tracker.documentToken, items.slice(start, start + 50));
    return this.view();
  },
  async sources(sources: readonly string[]) {
    await service.command(location.href, tracker.documentToken, 'collect');
    await service.observe(location.href, tracker.documentToken, observations(sources));
    return this.view();
  },
  async command(command: string, value?: unknown) {
    const result = await service.command(location.href, tracker.documentToken, command, value);
    controller.refresh(); return result;
  },
  async view() { return service.attach(location.href, tracker.documentToken); },
  async wait() { await executor.waitForIdle(); controller.refresh(); return this.view(); },
  async restartService() { service = makeService(); controller.refresh(); return this.view(); },
  async restartExecutor() { executor.dispose(); executor = makeExecutor(); },
  closeClient() { controller.stop(); },
  reopenClient() { controller = makeController(); controller.start(); },
  async stats() {
    const view = await this.view();
    return { images: view.images.length, completed: view.progress.completed, failed: view.progress.failed,
      attempts: view.images.map((image) => ({ id: image.id, attempts: image.attempts, state: image.state })), profile: view.session.profile,
      persistedBytes: JSON.stringify(view).length };
  },
  async clear() { await this.command('clear'); },
  async id() { return chapterIdentity(location.href).id; },
};
Object.assign(window, { chapterPipeline: harness });
declare global { interface Window { chapterPipeline: typeof harness } }
