import { RegionReprocessor } from '../../chapter/region-reprocessor';
import { isNormalizedBox } from '../../core/geometry';
import type { NormalizedBox } from '../../core/types';
import { ChapterExecutor } from '../../chapter/chapter-executor';
import { IndexedDBCache } from '../../chapter/indexeddb-cache';
import type { ChapterExecutorRequest, ExecutorCommand } from '../../chapter/chapter-service';
import { browser } from 'wxt/browser';
import { isBackgroundSender, validateSelection } from '../../extension/security';
import { publicError, throwIfAborted, TranslationError } from '../../translation/errors';
import { translateCapturedImage, translateSourceImage } from '../../translation/image-pipeline';
import { objectValue } from '../../translation/schema';
import { validateApiKey, validateSettings } from '../../translation/settings';
import { validateCaptureGeometry } from '../../translation/capture';
import type { PrivateJob } from '../../translation/types';

const regionReprocessor = new RegionReprocessor(new IndexedDBCache());
const active = new Map<string, AbortController>();
let activeCrop: { readonly chapterId: string; readonly controller: AbortController } | undefined;
const cropCancellationGenerations = new Map<string, number>();
const chapters = new ChapterExecutor({ store: new IndexedDBCache(), changed: async (chapterId) => {
  await browser.runtime.sendMessage({ type: 'private:chapter-changed', chapterId }).catch(() => undefined);
} });
let operations: Promise<unknown> = Promise.resolve();

function cancelCrop(chapterId: string): void {
  cropCancellationGenerations.set(chapterId, (cropCancellationGenerations.get(chapterId) ?? 0) + 1);
  if (activeCrop?.chapterId === chapterId) activeCrop.controller.abort();
}

async function report(data: Record<string, unknown>): Promise<void> {
  await browser.runtime.sendMessage({ type: 'private:progress', ...data }).catch(() => undefined);
}

async function run(job: PrivateJob): Promise<void> {
  const controller = new AbortController();
  active.set(job.id, controller);
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, 5 * 60_000);
  try {
    const input = {
      ...job, signal: controller.signal,
      onProgress: (tile: number, tiles: number) => { void report({ id: job.id, phase: 'translating', tile, tiles }); },
    };
    const output = job.capture ? await translateCapturedImage(job.capture, input) : await translateSourceImage(input);
    if (controller.signal.aborted) throw new TranslationError('CANCELLED');
    if (JSON.stringify(output).length > 1_000_000) throw new TranslationError('INVALID_JSON');
    await report({ id: job.id, phase: 'complete', selection: job.selection, output });
  } catch (error) {
    await report({ id: job.id, phase: 'error', error: publicError(expired ? new TranslationError('TIMEOUT') : error) });
  } finally {
    clearTimeout(timer);
    active.delete(job.id);
  }
}

async function dispatch(message: Record<string, unknown>): Promise<unknown> {
  if (message['type'] === 'offscreen:region-reprocess') {
    if (activeCrop) throw new TranslationError('BUSY');
    const request = objectValue(message['request']);
    if (!request || typeof request['chapterId'] !== 'string' || typeof request['imageId'] !== 'string'
      || !/^chapter-[a-f0-9]{64}$/.test(request['chapterId'])
      || typeof request['cacheKey'] !== 'string' || typeof request['expectedRevision'] !== 'string'
      || !objectValue(request['crop']) || !isNormalizedBox(request['crop'] as NormalizedBox)) throw new TranslationError('INVALID_COORDINATES');
    const settings = validateSettings(request['settings']), apiKey = validateApiKey(request['apiKey']);
    const controller = new AbortController();
    const crop = { chapterId: request['chapterId'], controller };
    activeCrop = crop;
    let expired = false;
    const timer = setTimeout(()=>{expired=true;controller.abort();},180_000);
    try {
      if (active.size || await chapters.isBusy()) throw new TranslationError('BUSY');
      // Cancellation also applies while checking the chapter or returning a cached crop.
      throwIfAborted(controller.signal);
      const output = await regionReprocessor.run({chapterId:request['chapterId'],imageId:request['imageId'],cacheKey:request['cacheKey'],expectedRevision:request['expectedRevision'],
        crop:request['crop'] as NormalizedBox,settings,apiKey},controller.signal);
      throwIfAborted(controller.signal);
      return output;
    }
    catch(error){throw expired?new TranslationError('TIMEOUT'):error;}
    finally {clearTimeout(timer);if(activeCrop===crop)activeCrop=undefined;}
  }
  if (message['type'] === 'offscreen:chapter-command') {
    const request = objectValue(message['request']);
    const commands = ['translate', 'resume', 'retry', 'pause', 'cancel'];
    if (!request || typeof request['chapterId'] !== 'string' || !/^chapter-[a-f0-9]{64}$/.test(request['chapterId'])
      || !commands.includes(String(request['command']))) throw new TranslationError('CONFIG');
    const command = request['command'] as ExecutorCommand;
    if (active.size && ['translate', 'resume', 'retry'].includes(command)) throw new TranslationError('BUSY');
    const task: ChapterExecutorRequest = { chapterId: request['chapterId'], command,
      ...(['translate', 'resume', 'retry'].includes(command) ? { settings: validateSettings(request['settings']), apiKey: validateApiKey(request['apiKey']) } : {}),
    };
    await chapters.command(task); return;
  }
  const rawJob = objectValue(message['job']);
  if (!rawJob || typeof rawJob['id'] !== 'string' || typeof rawJob['tabId'] !== 'number') throw new TranslationError('INTERNAL');
  if (active.size > 0 || await chapters.isBusy()) throw new TranslationError('BUSY');
  const capture = objectValue(rawJob['capture']);
  if (capture && (typeof capture['dataUrl'] !== 'string' || !capture['dataUrl'].startsWith('data:image/png;base64,') || capture['dataUrl'].length > 32 * 1024 * 1024)) throw new TranslationError('UNSUPPORTED_IMAGE');
  const job: PrivateJob = {
    ...(capture ? { capture: { dataUrl: capture['dataUrl'] as string, geometry: validateCaptureGeometry(capture['geometry']) } } : {}),
    id: rawJob['id'], tabId: rawJob['tabId'], selection: validateSelection(rawJob['selection']),
    settings: validateSettings(rawJob['settings']), apiKey: validateApiKey(rawJob['apiKey']),
  };
  void run(job);
}

browser.runtime.onMessage.addListener((raw: unknown, sender, reply) => {
  const message = objectValue(raw);
  if (!message || !isBackgroundSender(sender, browser.runtime.id)) return;
  if (message['type'] === 'offscreen:cancel' && typeof message['id'] === 'string') {
    active.get(message['id'])?.abort(); reply({ ok: true }); return;
  }
  // Control messages must bypass a crop's pending provider/cache operation.
  if (message['type'] === 'offscreen:region-cancel') {
    if (typeof message['chapterId'] !== 'string' || !/^chapter-[a-f0-9]{64}$/.test(message['chapterId'])) {
      reply({ ok: false, error: publicError(new TranslationError('CONFIG')) }); return;
    }
    cancelCrop(message['chapterId']);
    reply({ ok: true }); return;
  }
  if (message['type'] === 'offscreen:chapter-command') {
    const request = objectValue(message['request']);
    if (request && ['pause', 'cancel'].includes(String(request['command']))
      && typeof request['chapterId'] === 'string' && /^chapter-[a-f0-9]{64}$/.test(request['chapterId'])) cancelCrop(request['chapterId']);
  }
  if (message['type'] !== 'offscreen:start' && message['type'] !== 'offscreen:chapter-command' && message['type'] !== 'offscreen:region-reprocess') return;
  const cropChapter = message['type'] === 'offscreen:region-reprocess' ? objectValue(message['request'])?.['chapterId'] : undefined;
  const generation = typeof cropChapter === 'string' ? cropCancellationGenerations.get(cropChapter) ?? 0 : undefined;
  const operation = operations.catch(() => undefined).then(() => {
    // A cancel may arrive before a queued crop has its own active controller.
    if (typeof cropChapter === 'string' && generation !== (cropCancellationGenerations.get(cropChapter) ?? 0)) throw new TranslationError('CANCELLED');
    return dispatch(message);
  });
  operations = operation.catch(() => undefined);
  void operation.then((data) => reply({ ok: true, data }), (error: unknown) => reply({ ok: false, error: publicError(error) }));
  return true;
});
