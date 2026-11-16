import { describe, expect, it, vi } from 'vitest';
import { mapCaptureBox, planCaptureCrop, sameCaptureGeometry, validateCaptureGeometry, type CaptureGeometry } from '../../src/translation/capture';
import { captureVisibleImage } from '../../src/extension/capture-service';
import type { ImageSelection } from '../../src/translation/types';

const geometry: CaptureGeometry = {
  clip: { x: 100.3, y: 32.1, width: 500.5, height: 800.2 },
  painted: { x: 100.3, y: -167.9, width: 500.5, height: 1200 },
  viewport: { width: 1200, height: 900, dpr: 2, scale: 1, offsetLeft: 0, offsetTop: 0 },
};
const selected: ImageSelection = { instanceId: 'image-1', generation: 1, sourceKey: 'canvas-1', source: 'canvas:visible',
  documentToken: '0123456789abcdef0123456789abcdef', naturalWidth: 1000, naturalHeight: 2400, method: 'canvas', requiresCapture: true };

describe('screenshot coordinates', () => {
  it.each([1, 1.25, 1.5, 2])('uses actual bitmap scale %s even when DPR differs', (ratio) => {
    const plan = planCaptureCrop(geometry, 1200 * ratio, 900 * ratio);
    expect(plan.pixels.x).toBe(Math.ceil(geometry.clip.x * ratio));
    expect(plan.pixels.y).toBe(Math.ceil(geometry.clip.y * ratio));
    expect(plan.pixels.x + plan.pixels.width).toBeLessThanOrEqual((geometry.clip.x + geometry.clip.width) * ratio);
    const projected = mapCaptureBox({ x: 0.2, y: 0.3, width: 0.4, height: 0.1 }, plan.sourceBox);
    const cssX = geometry.painted.x + projected.x * geometry.painted.width;
    const expectedX = plan.pixels.x / ratio + 0.2 * plan.pixels.width / ratio;
    expect(Math.abs(cssX - expectedX)).toBeLessThan(1e-8);
  });
  it('maps a clipped viewport result back to the complete image', () => {
    expect(mapCaptureBox({ x: 0.2, y: 0.25, width: 0.5, height: 0.1 }, { x: 0.1, y: 0.3, width: 0.8, height: 0.4 }))
      .toEqual({ x: 0.26, y: 0.4, width: 0.4, height: 0.04000000000000001 });
  });
  it('rejects an inconsistent screenshot aspect ratio', () => expect(() => planCaptureCrop(geometry, 2400, 900)).toThrow());
  it('rejects pinch zoom instead of guessing coordinates', () => expect(() => validateCaptureGeometry({ ...geometry, viewport: { ...geometry.viewport, scale: 2 } })).toThrow());
  it('rejects out-of-viewport and non-finite geometry', () => {
    expect(() => validateCaptureGeometry({ ...geometry, clip: { ...geometry.clip, x: -2 } })).toThrow();
    expect(() => validateCaptureGeometry({ ...geometry, painted: { ...geometry.painted, width: NaN } })).toThrow();
    expect(() => planCaptureCrop(geometry, 10000, 10000)).toThrow();
  });
  it('detects scroll, resize, DPR and image movement during capture', () => {
    expect(sameCaptureGeometry(geometry, structuredClone(geometry))).toBe(true);
    expect(sameCaptureGeometry(geometry, { ...geometry, painted: { ...geometry.painted, y: 3 } })).toBe(false);
    expect(sameCaptureGeometry(geometry, { ...geometry, viewport: { ...geometry.viewport, dpr: 1 } })).toBe(false);
  });
});

function tabMock() {
  return {
    get: vi.fn(async () => ({ active: true, windowId: 3 })),
    query: vi.fn(async () => [{ id: 42 }]),
    captureVisibleTab: vi.fn(async () => 'data:image/png;base64,TEST_PRIVATE_SCREENSHOT'),
    sendMessage: vi.fn(async (_tabId: number, message: unknown) => {
      const type = (message as { type: string }).type;
      return type === 'mtp:capture-prepare'
        ? { ok: true, selection: { ...selected, captureTicket: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, geometry }
        : { ok: true };
    }),
  };
}

describe('explicit capture orchestration', () => {
  it('captures once after preparing, and never sends screenshot bytes to the content script', async () => {
    const tabs = tabMock();
    expect(tabs.captureVisibleTab).not.toHaveBeenCalled();
    const result = await captureVisibleImage(tabs, 42, selected);
    expect(tabs.captureVisibleTab).toHaveBeenCalledExactlyOnceWith(3, { format: 'png' });
    expect(result.capture.dataUrl).toContain('TEST_PRIVATE_SCREENSHOT');
    expect(JSON.stringify(tabs.sendMessage.mock.calls)).not.toContain('TEST_PRIVATE_SCREENSHOT');
    expect(tabs.sendMessage.mock.calls.map((call) => (call[1] as { type: string }).type)).toEqual(['mtp:capture-prepare', 'mtp:capture-finish']);
  });
  it('does not capture a different active tab', async () => {
    const tabs = tabMock(); tabs.query.mockResolvedValue([{ id: 99 }]);
    await expect(captureVisibleImage(tabs, 42, selected)).rejects.toThrow();
    expect(tabs.captureVisibleTab).not.toHaveBeenCalled();
  });
  it('restores overlays if the capture API fails', async () => {
    const tabs = tabMock(); tabs.captureVisibleTab.mockRejectedValue(new Error('denied'));
    await expect(captureVisibleImage(tabs, 42, selected)).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
    expect(tabs.sendMessage.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'mtp:capture-cancel' });
  });
  it('discards a screenshot if geometry changes while it is captured', async () => {
    const tabs = tabMock();
    tabs.sendMessage.mockImplementation(async (_id, message) => (message as { type: string }).type === 'mtp:capture-prepare'
      ? { ok: true, selection: { ...selected, captureTicket: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, geometry }
      : { ok: false });
    await expect(captureVisibleImage(tabs, 42, selected)).rejects.toThrow();
    expect(tabs.sendMessage.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'mtp:capture-cancel' });
  });
});
