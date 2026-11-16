import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { NormalizedBox, NormalizedPoint, RegionMetadata } from '../../src/core/types';
import { jsonByteLength, regionPositionErrorCssPx } from '../../src/benchmark/metrics';
import { frames, recordMetrics } from './helpers';

interface DatasetImage {
  readonly id: string;
  readonly language: string;
  readonly regions: readonly (RegionMetadata & { readonly id: string; readonly sourceText: string; readonly translatedText: string; readonly box: NormalizedBox; readonly polygon: readonly NormalizedPoint[] })[];
}
interface Dataset { readonly images: readonly DatasetImage[] }

/** Applies known annotation text, never a fake AI output. Real OCR/translation quality stays unmeasured. */
test('original EN/JA/ZH/KO fixtures are discovered and annotation overlays remain aligned with no text overflow', async ({ page }, info) => {
  const googleRequests: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).hostname === 'generativelanguage.googleapis.com') googleRequests.push(request.url()); });
  const response = await page.request.get('/benchmark/dataset.json');
  expect(response.ok()).toBe(true);
  const dataset = await response.json() as Dataset;
  expect(dataset.images.map((image) => image.language)).toEqual(['en', 'ja', 'zh', 'ko']);
  await page.goto('/benchmark/index.html');
  await page.locator('img').evaluateAll(async (images) => Promise.all(images.map((node) => (node as HTMLImageElement).decode())));
  for (const image of dataset.images) {
    const path = info.outputPath(`${image.id}-before.png`);
    await page.locator(`#fixture-${image.id}`).screenshot({ path });
    await info.attach(`${image.id}-before`, { path, contentType: 'image/png' });
  }
  await page.addScriptTag({ path: 'work/browser-harness.js' });
  await page.evaluate(() => { window.testTracker.start(); window.testTracker.clearRegions(); });
  await expect.poll(() => page.evaluate(() => window.testTracker.candidates().filter((candidate) => candidate.source.includes('/benchmark/')).length)).toBe(4);
  const accepted = await page.evaluate((images) => images.map((image) => {
    const element = document.querySelector<HTMLElement>(`#fixture-${image.id}`)!;
    const binding = window.testTracker.bindingFor(element)!;
    return window.testTracker.applyRegions({ ...binding, regions: image.regions.map((region) => ({
      id: region.id, text: region.translatedText, box: region.box, polygon: region.polygon, ...(region.kind ? { kind: region.kind } : {}),
      ...(region.direction ? { direction: region.direction } : {}), ocrConfidence: null, positionConfidence: null, edited: true,
    })) });
  }), dataset.images);
  expect(accepted).toEqual([true, true, true, true]);
  const samples: { imageId: string; regionId: string; expected: { x: number; y: number; width: number; height: number }; actual: { x: number; y: number; width: number; height: number }; overflow: boolean; readable: boolean; fontCssPx: number }[] = [];
  for (const image of dataset.images) {
    await page.locator(`#fixture-${image.id}`).scrollIntoViewIfNeeded();
    await expect(page.locator(`[data-mtp-root] [data-source-element="fixture-${image.id}"] .region`)).toHaveCount(image.regions.length);
    await frames(page, 12);
    const readings = await page.evaluate((fixture) => {
      const source = document.querySelector(`#fixture-${fixture.id}`)!.getBoundingClientRect();
      const shadow = document.querySelector('[data-mtp-root]')!.shadowRoot!;
      return fixture.regions.map((annotation) => {
        const region = shadow.querySelector<HTMLElement>(`[data-source-element="fixture-${fixture.id}"] [data-region-id="${annotation.id}"]`)!;
        const bounds = region.getBoundingClientRect(), text = region.querySelector<HTMLElement>('.text')!;
        const font = parseFloat(getComputedStyle(region).fontSize);
        return { imageId: fixture.id, regionId: annotation.id,
          expected: { x: source.x + annotation.box.x * source.width, y: source.y + annotation.box.y * source.height,
            width: annotation.box.width * source.width, height: annotation.box.height * source.height },
          actual: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          overflow: text.scrollWidth > region.clientWidth - 6 || text.scrollHeight > region.clientHeight - 6,
          readable: font >= 8, fontCssPx: font,
        };
      });
    }, image);
    samples.push(...readings);
    const path = info.outputPath(`${image.id}-after.png`);
    await page.locator(`#fixture-${image.id}`).screenshot({ path });
    await info.attach(`${image.id}-after`, { path, contentType: 'image/png' });
  }
  const errors = samples.map((sample) => regionPositionErrorCssPx(sample.expected, sample.actual));
  expect(Math.max(...errors)).toBeLessThanOrEqual(2);
  expect(samples.filter((sample) => sample.overflow)).toHaveLength(0);
  expect(googleRequests).toEqual([]);
  const session = await page.context().newCDPSession(page);
  const heap = await session.send('Runtime.getHeapUsage');
  await session.detach();
  const observation = {
    provenance: { kind: 'renderer-fixture', description: 'Real Chromium discovery/geometry/font layout using known synthetic annotations and example Vietnamese strings. No OCR, Gemini or reference extension execution.' },
    images: [], discovery: { foundImageIds: dataset.images.map((image) => image.id) }, renderer: { samples },
    runtime: { memory: { scope: 'single page JavaScript heap sample; excludes decoded image/GPU/offscreen/process RAM',
      jsHeapUsedBytes: heap.usedSize, jsHeapTotalBytes: heap.totalSize, metadataBytes: jsonByteLength(dataset) } },
  };
  const path = info.outputPath('multilingual-render-observations.json');
  await writeFile(path, JSON.stringify(observation, null, 2));
  await writeFile('work/phase050/multilingual-render-observations.json', JSON.stringify(observation, null, 2));
  await info.attach('multilingual-render-observations', { path, contentType: 'application/json' });
  await recordMetrics(info, { images: dataset.images.length, annotatedRegions: samples.length, discoveryRecall: 1,
    maxErrorCssPx: Math.max(...errors), textOverflowRate: samples.filter((sample) => sample.overflow).length / samples.length,
    unreadableSamples: samples.filter((sample) => !sample.readable).length, realOcr: false, realTranslationQuality: 'unmeasured',
    googleRequests: googleRequests.length, jsHeapSampleBytes: heap.usedSize, peakProcessRam: 'unmeasured' });
});
