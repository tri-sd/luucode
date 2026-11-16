import { RegionTracker } from '../src/tracking/region-tracker';
import { translateSourceImage } from '../src/translation/image-pipeline';
import { publicError, TranslationError } from '../src/translation/errors';
import { GeminiClient } from '../src/translation/gemini-client';
import { DEFAULT_SETTINGS } from '../src/translation/settings';
import type { TranslationOutput } from '../src/translation/types';

const tracker = new RegionTracker({ initialRegions: 'empty' });
let controller: AbortController | undefined;
const harness = {
  tracker,
  start: (): void => tracker.start(),
  cancel: (): void => controller?.abort(),
  async translate(timeoutMs = 5000): Promise<{ ok: true; output: TranslationOutput } | { ok: false; code: string; message: string }> {
    const selection = tracker.currentImage();
    if (!selection) return { ok: false, ...publicError(new TranslationError('NO_IMAGE')) };
    controller = new AbortController();
    // Only the test harness uses this fake key. This entrypoint is excluded from the extension.
    const client = new GeminiClient();
    const adapter = {
      translateImage: (input: Parameters<GeminiClient['translateImage']>[0]) => client.translateImage({ ...input, timeoutMs }),
    };
    try {
      const output = await translateSourceImage({
        selection, apiKey: 'FAKE_BROWSER_TEST_KEY_123456789',
        settings: { ...DEFAULT_SETTINGS, model: 'gemini-vision-test' }, signal: controller.signal,
        onProgress: () => undefined,
      }, adapter);
      if (!tracker.applyRegions({ ...selection, regions: output.regions })) throw new TranslationError('STALE_IMAGE');
      return { ok: true, output };
    } catch (error) { return { ok: false, ...publicError(error) }; }
  },
};
Object.assign(window, { translationHarness: harness });

declare global { interface Window { translationHarness: typeof harness } }
