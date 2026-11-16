import { expect, test } from '@playwright/test';
import { alignmentError, assertAligned, frames, recordMetrics, startTracker } from './helpers';

test('one Shadow DOM root, idempotent start, no image attributes or layout changes', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  const before = await page.evaluate(() => ({
    images: [...document.images].map((image) => image.outerHTML),
    height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth,
    rect: document.querySelector('#page-a')!.getBoundingClientRect().toJSON(),
  }));
  await page.addScriptTag({ path: 'work/browser-harness.js' });
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.testTracker.start(); });
  await assertAligned(page, 'page-a');
  await expect(page.locator('[data-mtp-root]')).toHaveCount(1);
  await expect(page.locator('[data-mtp-root] .layer[data-source-element="page-a"]')).toHaveCount(1);
  await expect(page.locator('[data-mtp-root] .region')).toHaveCount(2);
  const after = await page.evaluate(() => ({
    images: [...document.images].map((image) => image.outerHTML),
    height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth,
    rect: document.querySelector('#page-a')!.getBoundingClientRect().toJSON(),
  }));
  expect(after).toEqual(before);
  expect(await page.locator('[data-mtp-root]').evaluate((host) => getComputedStyle(host).pointerEvents)).toBe('none');
  await recordMetrics(info, { layoutChanged: false, maxErrorCssPx: await alignmentError(page, 'page-a') });
});

test('100 bidirectional document scroll positions do not accumulate drift', async ({ page }, info) => {
  await startTracker(page);
  const errors: number[] = [];
  for (let index = 0; index < 100; index++) {
    const y = index % 2 === 0 ? (index % 10) * 80 : 750 - (index % 10) * 65;
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await frames(page, 2);
    errors.push(await assertAligned(page, 'page-a'));
  }
  expect(Math.max(...errors)).toBeLessThanOrEqual(2);
  await recordMetrics(info, { samples: errors.length, maxErrorCssPx: Math.max(...errors) });
});

test('native wheel scrolling keeps the document-anchored surface aligned during motion', async ({ page }, info) => {
  await startTracker(page);
  const samples: number[] = [];
  for (const delta of [140, 140, 140, 140, -140, -140, -140, -140]) {
    await page.mouse.wheel(0, delta);
    for (let frame = 0; frame < 4; frame++) {
      await frames(page, 1);
      samples.push(await alignmentError(page, 'page-a'));
    }
  }
  expect(Math.max(...samples)).toBeLessThanOrEqual(2);
  await recordMetrics(info, { motionSamples: samples.length, maxErrorCssPx: Math.max(...samples) });
});

test('responsive resize preserves normalized coordinates', async ({ page }, info) => {
  await startTracker(page);
  const errors: number[] = [];
  for (const width of [600, 1400, 810, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    await frames(page);
    errors.push(await assertAligned(page, 'page-a'));
  }
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errors), viewportWidths: [600, 1400, 810, 1200] });
});

test('layout shift above an unchanged image is detected without relying on ResizeObserver', async ({ page }, info) => {
  await startTracker(page);
  await page.locator('#late-block').evaluate((element) => { element.style.height = '177.5px'; });
  await frames(page);
  const error = await assertAligned(page, 'page-a');
  await page.locator('#late-block').evaluate((element) => { element.style.height = '0'; });
  await frames(page);
  await assertAligned(page, 'page-a');
  await recordMetrics(info, { shiftCssPx: 177.5, maxErrorCssPx: error });
});

test('native lazy loading, delayed src, inserted and removed images are discovered once', async ({ page }) => {
  await startTracker(page);
  await page.locator('#page-lazy').scrollIntoViewIfNeeded();
  await page.locator('#page-lazy').evaluate(async (image: HTMLImageElement) => image.decode());
  await assertAligned(page, 'page-lazy');
  await page.locator('#page-deferred').evaluate((image: HTMLImageElement) => { image.src = image.dataset['src'] ?? ''; });
  await page.locator('#page-deferred').scrollIntoViewIfNeeded();
  await page.locator('#page-deferred').evaluate(async (image: HTMLImageElement) => image.decode());
  await assertAligned(page, 'page-deferred');
  await page.evaluate(() => {
    const image = document.createElement('img');
    image.id = 'page-inserted'; image.className = 'page'; image.src = '/panel.svg?id=INSERTED';
    document.querySelector('#reader')!.prepend(image);
  });
  await page.locator('#page-inserted').scrollIntoViewIfNeeded();
  await page.locator('#page-inserted').evaluate(async (image: HTMLImageElement) => image.decode());
  await assertAligned(page, 'page-inserted');
  await page.locator('#page-inserted').evaluate((image) => image.remove());
  await frames(page);
  await expect(page.locator('[data-mtp-root] .layer[data-source-element="page-inserted"]')).toHaveCount(0);
  const ids = await page.evaluate(() => window.testTracker.status().images.map((image) => image.instanceId));
  expect(new Set(ids).size).toBe(ids.length);
});

test('recycled image source rejects stale regions and advances the generation', async ({ page }) => {
  await startTracker(page);
  const original = await page.evaluate(() => window.testTracker.status().images.find((image) => image.source.endsWith('id=A'))!);
  const accepted = await page.evaluate((old) => {
    const image = document.querySelector<HTMLImageElement>('#page-a')!;
    image.src = '/panel.svg?id=CHAPTER2';
    return window.testTracker.applyRegions({ ...old, regions: [{ id: 'stale', box: { x: 0, y: 0, width: 1, height: 1 }, text: 'STALE' }] });
  }, original);
  expect(accepted).toBe(false);
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  await assertAligned(page, 'page-a');
  const next = await page.evaluate(() => window.testTracker.status().images.find((image) => image.source.endsWith('id=CHAPTER2'))!);
  expect(next.instanceId).toBe(original.instanceId);
  expect(next.generation).toBeGreaterThan(original.generation);
  expect(await page.evaluate((old) => window.testTracker.applyRegions({ ...old, regions: [] }), original)).toBe(false);
  await expect(page.locator('[data-mtp-root] .layer[data-source-element="page-a"]')).toHaveAttribute('data-source', /CHAPTER2$/);
  await expect(page.locator('[data-mtp-root]')).not.toContainText('STALE');
});

test('identical image URLs remain separate DOM instances with separate overlays', async ({ page }) => {
  await startTracker(page);
  await page.evaluate(() => {
    const reader = document.querySelector('#reader')!;
    reader.replaceChildren();
    const row = document.createElement('div'); row.style.display = 'flex'; row.style.gap = '20px';
    for (const id of ['twin-a', 'twin-b']) {
      const image = document.createElement('img'); image.id = id; image.src = '/panel.svg?id=SAME';
      image.style.width = '320px'; image.style.height = '512px'; row.append(image);
    }
    reader.append(row);
  });
  await page.locator('#twin-a').evaluate(async (image: HTMLImageElement) => image.decode());
  await page.locator('#twin-b').evaluate(async (image: HTMLImageElement) => image.decode());
  await assertAligned(page, 'twin-a');
  await assertAligned(page, 'twin-b');
  const layers = page.locator('[data-mtp-root] .layer');
  await expect(layers).toHaveCount(2);
  const ids = await layers.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-instance-id')));
  expect(new Set(ids).size).toBe(2);
});

test('responsive srcset selection changes the binding without reusing stale overlays', async ({ page }) => {
  await startTracker(page);
  await page.locator('#page-a').evaluate((image: HTMLImageElement) => {
    image.srcset = '/panel.svg?id=SRCSET1 600w, /panel.svg?id=SRCSET2 1800w';
    image.sizes = '400px';
  });
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  await assertAligned(page, 'page-a');
  await expect.poll(() => page.locator('#page-a').evaluate((image: HTMLImageElement) => image.currentSrc)).toContain('SRCSET1');
  const previous = await page.evaluate(() => window.testTracker.status().images.find((image) => image.source.includes('SRCSET1'))!);
  await page.locator('#page-a').evaluate((image: HTMLImageElement) => { image.sizes = '1400px'; });
  await page.locator('#page-a').evaluate(async (image: HTMLImageElement) => image.decode());
  await assertAligned(page, 'page-a');
  await expect.poll(() => page.locator('#page-a').evaluate((image: HTMLImageElement) => image.currentSrc)).toContain('SRCSET2');
  await expect(page.locator('[data-mtp-root] .layer[data-source-element="page-a"]')).toHaveAttribute('data-source', /SRCSET2$/);
  expect(await page.evaluate((old) => window.testTracker.applyRegions({ ...old, regions: [] }), previous)).toBe(false);
});

test('device pixel ratios preserve CSS pixel geometry', async ({ browser }, info) => {
  const errors: number[] = [];
  for (const ratio of [1.25, 1.5, 2]) {
    const context = await browser.newContext({ deviceScaleFactor: ratio, viewport: { width: 1100, height: 900 }, baseURL: 'http://127.0.0.1:4173' });
    const page = await context.newPage();
    try {
      await startTracker(page);
      expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);
      await page.evaluate(() => window.scrollTo(0, 271.5));
      await frames(page);
      errors.push(await assertAligned(page, 'page-a'));
    } finally { await context.close(); }
  }
  await recordMetrics(info, { devicePixelRatios: [1.25, 1.5, 2], maxErrorCssPx: Math.max(...errors) });
});

test('nested scrolling is aligned and clipped to the scroll container', async ({ page }, info) => {
  await startTracker(page);
  await page.evaluate(() => {
    const image = document.querySelector<HTMLElement>('#page-a')!;
    const container = document.createElement('div'); container.id = 'nested';
    Object.assign(container.style, { height: '490px', width: '650px', overflow: 'auto', border: '3px solid black' });
    image.before(container); container.append(image); image.style.width = '600px';
  });
  const errors: number[] = [];
  for (const top of [0, 100, 250, 70, 0]) {
    await page.locator('#nested').evaluate((element, value) => { element.scrollTop = value; }, top);
    await frames(page);
    errors.push(await assertAligned(page, 'page-a'));
    const bounds = await page.evaluate(() => {
      const container = document.querySelector('#nested')!.getBoundingClientRect();
      const layer = document.querySelector('[data-mtp-root]')!.shadowRoot!.querySelector('[data-source-element="page-a"]')!.getBoundingClientRect();
      return { top: layer.top, bottom: layer.bottom, containerTop: container.top + 3, containerBottom: container.bottom - 3 };
    });
    expect(bounds.top).toBeGreaterThanOrEqual(bounds.containerTop - 0.1);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.containerBottom + 0.1);
  }
  await recordMetrics(info, { maxErrorCssPx: Math.max(...errors), nestedScrollSamples: errors.length });
});

for (const fit of ['contain', 'cover'] as const) {
  test(`object-fit ${fit} accounts for padding, border and object-position`, async ({ page }, info) => {
    await startTracker(page);
    await page.locator('#page-a').evaluate((image, value) => {
      Object.assign(image.style, {
        boxSizing: 'content-box', width: '600px', height: '600px',
        padding: '12px', border: '4px solid black', objectFit: value, objectPosition: '25% 75%',
      });
    }, fit);
    await frames(page);
    const error = await page.evaluate((value) => {
      const image = document.querySelector('#page-a')!.getBoundingClientRect();
      const region = document.querySelector('[data-mtp-root]')!.shadowRoot!.querySelector('[data-source-element="page-a"] [data-region-id="mock-1"]')!.getBoundingClientRect();
      // Fixture source is 1000x1600; the content box is exactly 600x600.
      const width = value === 'contain' ? 375 : 600;
      const height = value === 'contain' ? 600 : 960;
      const x = image.x + 16 + (600 - width) * 0.25;
      const y = image.y + 16 + (600 - height) * 0.75;
      return Math.max(Math.abs(region.x - x - width * 0.12), Math.abs(region.y - y - height * 0.15),
        Math.abs(region.width - width * 0.34), Math.abs(region.height - height * 0.11));
    }, fit);
    expect(error).toBeLessThanOrEqual(2);
    await recordMetrics(info, { fit, maxErrorCssPx: error });
  });
}

test('positive ancestor scale works; rotation is skipped instead of drawing wrong geometry', async ({ page }) => {
  await startTracker(page);
  await page.locator('#reader').evaluate((reader) => {
    reader.style.transformOrigin = 'top left'; reader.style.transform = 'translate(8.5px, 12px) scale(.8)';
  });
  await frames(page);
  await assertAligned(page, 'page-a');
  await page.locator('#reader').evaluate((reader) => { reader.style.transform = 'rotate(5deg)'; });
  await frames(page);
  await expect(page.locator('[data-mtp-root] .layer')).toHaveCount(0);
  await page.locator('#reader').evaluate((reader) => { reader.style.transform = 'none'; });
  await assertAligned(page, 'page-a');
});

test('stop cleans up, restart stays unique, and a removed overlay root recovers', async ({ page }) => {
  await startTracker(page);
  await page.evaluate(() => window.testTracker.stop());
  await expect(page.locator('[data-mtp-root]')).toHaveCount(0);
  expect(await page.evaluate(() => window.testTracker.status().trackedCount)).toBe(0);
  await page.evaluate(() => window.testTracker.start());
  await assertAligned(page, 'page-a');
  await page.locator('[data-mtp-root]').evaluate((root) => root.remove());
  await frames(page);
  await expect(page.locator('[data-mtp-root]')).toHaveCount(1);
  await assertAligned(page, 'page-a');
});

test('page CSS cannot style Shadow DOM regions and overlays never intercept pointer events', async ({ page }) => {
  await startTracker(page);
  await page.addStyleTag({ content: '.region { position: fixed !important; width: 9999px !important; color: red !important; } [data-mtp-root] { width: 500px !important; position: fixed !important; }' });
  await frames(page);
  await assertAligned(page, 'page-a');
  const actual = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-mtp-root]')!;
    const region = host.shadowRoot!.querySelector<HTMLElement>('[data-source-element="page-a"] [data-region-id="mock-1"]')!;
    const rect = region.getBoundingClientRect();
    return {
      hostPosition: getComputedStyle(host).position,
      hostWidth: getComputedStyle(host).width,
      regionColor: getComputedStyle(region).color,
      underlyingId: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id,
    };
  });
  expect(actual).toEqual({ hostPosition: 'absolute', hostWidth: '0px', regionColor: 'rgb(18, 48, 76)', underlyingId: 'page-a' });
});
