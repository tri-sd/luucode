import { planRegionCrop, sampleRegionBackground } from './preprocessing';
import { mergeVisionAudit } from './vision-adapter';
import type { NormalizedBox } from '../core/types';
import { mapCaptureBox, mapCapturePoint, planCaptureCrop, type CapturedImage } from './capture';
import { TranslationError, throwIfAborted } from './errors';
import { GeminiClient, type Fetcher } from './gemini-client';
import { deduplicateRegions, mapTileRegions, planTiles } from './tiles';
import type { ImageSelection, TranslatedRegion, TranslationOutput, TranslationSettings } from './types';

const MAX_BYTES = 12 * 1024 * 1024;

export function imageOrigin(source: string): string {
  let url: URL;
  try { url = new URL(source); } catch { throw new TranslationError('IMAGE_ACCESS'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TranslationError('IMAGE_ACCESS');
  return `${url.origin}/*`;
}

export async function downloadImage(source: string, signal: AbortSignal, fetcher: Fetcher): Promise<Blob> {
  imageOrigin(source);
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 25_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    throwIfAborted(signal);
    const response = await fetcher(source, { signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body) throw new TranslationError('IMAGE_ACCESS');
    if (Number(response.headers.get('Content-Length')) > MAX_BYTES) throw new TranslationError('IMAGE_TOO_LARGE');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let total = 0;
    reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new TranslationError('IMAGE_TOO_LARGE');
      chunks.push(new Uint8Array(value));
    }
    return new Blob(chunks, { type: response.headers.get('Content-Type')?.split(';')[0] ?? 'application/octet-stream' });
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof TranslationError) throw error;
    throw new TranslationError('IMAGE_ACCESS');
  } finally {
    await reader?.cancel().catch(() => undefined);
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

async function imageElement(blob: Blob): Promise<{ image: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try { await image.decode(); } catch { URL.revokeObjectURL(url); throw new TranslationError('UNSUPPORTED_IMAGE'); }
  return { image, release: () => { image.src = ''; URL.revokeObjectURL(url); } };
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob) reject(new TranslationError('UNSUPPORTED_IMAGE'));
    else if (blob.size > 13 * 1024 * 1024) reject(new TranslationError('IMAGE_TOO_LARGE'));
    else resolve(blob);
  }, 'image/png'));
}

async function encode(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await pngBlob(canvas);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new TranslationError('UNSUPPORTED_IMAGE'));
    reader.onload = () => {
      const data = typeof reader.result === 'string' ? reader.result.split(',')[1] : undefined;
      if (!data) reject(new TranslationError('UNSUPPORTED_IMAGE'));
      else resolve(data);
    };
    reader.readAsDataURL(blob);
  });
}

export interface PipelineInput {
  readonly selection: ImageSelection;
  readonly settings: TranslationSettings;
  readonly apiKey: string;
  readonly signal: AbortSignal;
  readonly onProgress: (tile: number, total: number) => void;
  readonly contextText?: string;
  readonly visionMode?: 'legacy' | 'detailed';
  readonly qualityMode?: 'standard' | 'review';
  readonly allowEmpty?: boolean;
  readonly onState?: (state: 'OCR_PROCESSING' | 'TRANSLATING') => void | Promise<void>;
}

/** Runs only in a trusted offscreen document, never in the website's content script. */
export async function translateSourceImage(input: PipelineInput, client: Pick<GeminiClient, 'translateImage'> = new GeminiClient(), fetcher: Fetcher = fetch): Promise<TranslationOutput> {
  planTiles(input.selection.naturalWidth, input.selection.naturalHeight);
  const blob = await downloadImage(input.selection.source, input.signal, fetcher);
  throwIfAborted(input.signal);
  return translateRasterImage(blob, input, client);
}

export async function translateRasterImage(blob: Blob, input: PipelineInput, client: Pick<GeminiClient, 'translateImage'> = new GeminiClient()): Promise<TranslationOutput> {
  throwIfAborted(input.signal);
  const decoded = await imageElement(blob);
  const canvas = document.createElement('canvas');
  try {
    const width = decoded.image.naturalWidth, height = decoded.image.naturalHeight;
    if (!width || !height || Math.abs((width / height) / (input.selection.naturalWidth / input.selection.naturalHeight) - 1) > 0.01) {
      throw new TranslationError('STALE_IMAGE');
    }
    const tiles = planTiles(width, height);
    const regions: TranslatedRegion[] = [];
    const languages = new Set<TranslationOutput['sourceLanguage']>();
    for (const tile of tiles) {
      throwIfAborted(input.signal);
      input.onProgress(tile.index + 1, tiles.length);
      const ratio = Math.min(1, 2048 / Math.max(tile.width, tile.height));
      canvas.width = Math.max(1, Math.round(tile.width * ratio));
      canvas.height = Math.max(1, Math.round(tile.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new TranslationError('UNSUPPORTED_IMAGE');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.image, tile.x, tile.y, tile.width, tile.height, 0, 0, canvas.width, canvas.height);
      const imageBase64 = await encode(canvas);
      throwIfAborted(input.signal);
      await input.onState?.('OCR_PROCESSING');
      let output = await client.translateImage({
        apiKey: input.apiKey, model: input.settings.model, language: input.settings.sourceLanguage,
        ...(input.contextText ? { contextText: input.contextText } : {}),
        mode: input.visionMode ?? 'detailed',
        imageBase64, mimeType: 'image/png', timeoutMs: input.settings.timeoutSeconds * 1000, signal: input.signal,
      });
      if (input.qualityMode === 'review') {
        const audit = await client.translateImage({
          apiKey: input.apiKey, model: input.settings.model, language: input.settings.sourceLanguage,
          imageBase64, mimeType: 'image/png', timeoutMs: input.settings.timeoutSeconds*1000, signal: input.signal,
          mode: 'detailed', task: 'audit',
          contextText: JSON.stringify({ reference: input.contextText ?? '', existingRegions: output.regions.map((region) => ({ sourceText: region.sourceText, box: region.box })) }).slice(0,12000),
        });
        output = mergeVisionAudit(output,audit);
      }
      output = { ...output, regions: output.regions.map((region) => ({ ...region, ...sampleRegionBackground(context,region.box) })) };
      await input.onState?.('TRANSLATING');
      languages.add(output.sourceLanguage);
      regions.push(...mapTileRegions(output, tile));
    }
    const deduplicated = deduplicateRegions(regions);
    if (deduplicated.length === 0 && !input.allowEmpty) throw new TranslationError('NO_TEXT');
    return { sourceLanguage: languages.size === 1 ? [...languages][0]! : languages.size ? 'mixed' : 'unknown', regions: deduplicated };
  } finally {
    canvas.width = 0; canvas.height = 0;
    decoded.release();
  }
}

/** Crop in a trusted context. Only the selected visible image pixels reach Gemini. */
export async function translateCapturedImage(capture: CapturedImage, input: PipelineInput, client: Pick<GeminiClient, 'translateImage'> = new GeminiClient()): Promise<TranslationOutput> {
  if (!capture.dataUrl.startsWith('data:image/png;base64,') || capture.dataUrl.length > 32 * 1024 * 1024) throw new TranslationError('IMAGE_TOO_LARGE');
  const decoded = await imageElement(await (await fetch(capture.dataUrl)).blob());
  const canvas = document.createElement('canvas');
  try {
    const plan = planCaptureCrop(capture.geometry, decoded.image.naturalWidth, decoded.image.naturalHeight);
    canvas.width = plan.pixels.width; canvas.height = plan.pixels.height;
    const context = canvas.getContext('2d');
    if (!context) throw new TranslationError('UNSUPPORTED_IMAGE');
    context.drawImage(decoded.image, plan.pixels.x, plan.pixels.y, plan.pixels.width, plan.pixels.height, 0, 0, canvas.width, canvas.height);
    throwIfAborted(input.signal);
    const blob = await pngBlob(canvas);
    const output = await translateRasterImage(blob, { ...input, selection: { ...input.selection, naturalWidth: canvas.width, naturalHeight: canvas.height } }, client);
    return { ...output, regions: output.regions.map((region) => ({ ...region, box: mapCaptureBox(region.box, plan.sourceBox), ...(region.polygon ? { polygon: region.polygon.map((point) => mapCapturePoint(point,plan.sourceBox)) } : {}) })) };
  } finally { canvas.width = canvas.height = 0; decoded.release(); }
}

/** Explicit difficult-region retry. Sends one upscaled crop, never the full page or tab. */
export async function translateRegionCrop(blob: Blob, box: NormalizedBox, input: PipelineInput, client: Pick<GeminiClient,'translateImage'> = new GeminiClient()): Promise<TranslationOutput> {
  throwIfAborted(input.signal);
  const decoded = await imageElement(blob), canvas = document.createElement('canvas');
  try {
    const width = decoded.image.naturalWidth, height = decoded.image.naturalHeight;
    if (Math.abs((width/height)/(input.selection.naturalWidth/input.selection.naturalHeight)-1) > .01) throw new TranslationError('STALE_IMAGE');
    const plan = planRegionCrop(box,width,height);
    canvas.width = plan.outputWidth; canvas.height = plan.outputHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new TranslationError('UNSUPPORTED_IMAGE');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff'; context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(decoded.image,plan.pixels.x,plan.pixels.y,plan.pixels.width,plan.pixels.height,0,0,canvas.width,canvas.height);
    const output = await translateRasterImage(await pngBlob(canvas), { ...input, qualityMode: 'standard', visionMode: 'detailed',
      selection: { ...input.selection, naturalWidth: canvas.width,naturalHeight: canvas.height } },client);
    return { ...output, regions: output.regions.map((region) => ({ ...region,box: mapCaptureBox(region.box,plan.normalized),
      ...(region.polygon ? {polygon: region.polygon.map((point) => mapCapturePoint(point,plan.normalized))} : {}) })) };
  } finally {canvas.width = canvas.height = 0; decoded.release();}
}
