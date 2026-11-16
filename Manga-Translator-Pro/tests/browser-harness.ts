import { CaptureSession } from '../src/tracking/capture-session';
import { translateCapturedImage } from '../src/translation/image-pipeline';
import { DEFAULT_SETTINGS } from '../src/translation/settings';
import type { CapturedImage } from '../src/translation/capture';
import { RegionTracker } from '../src/tracking/region-tracker';

// Test-only entrypoint, bundled into work/ and never included in the extension.
const tracker = new RegionTracker();
const captureSession = new CaptureSession(tracker);
const readerHarness = {
  captureSession,
  async translateCapture(capture: CapturedImage) {
    const selection = tracker.currentImage()!;
    const result = await translateCapturedImage(capture, {
      selection, settings: { ...DEFAULT_SETTINGS, model: 'fake-test-model' }, apiKey: 'FAKE_TEST_KEY_123456789',
      signal: new AbortController().signal, onProgress: () => undefined,
    }, { translateImage: async (input) => {
      const image = new Image(); image.src = `data:image/png;base64,${input.imageBase64}`; await image.decode();
      Object.assign(window, { sentImageDimensions: [image.naturalWidth, image.naturalHeight] });
      return { sourceLanguage: 'en', regions: [{ id: 'capture-region', sourceText: 'SYNTHETIC', translatedText: 'Bản dịch kiểm thử',
        box: { x: 0.2, y: 0.25, width: 0.3, height: 0.1 } }] };
    } });
    tracker.applyRegions({ ...selection, regions: result.regions });
    return result;
  },
};
Object.assign(window, { testTracker: tracker, readerHarness });

declare global {
  interface Window { testTracker: RegionTracker; readerHarness: typeof readerHarness; sentImageDimensions: number[] }
}
