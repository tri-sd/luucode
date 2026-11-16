import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapterBackground } from '../../src/extension/chapter-background';
import { chapterIdentity } from '../../src/chapter/identity';
import type { EditableRegionSnapshot } from '../../src/chapter/chapter-service';
import { CredentialStore, type PrivateStorageArea } from '../../src/extension/credentials';
import { DEFAULT_SETTINGS } from '../../src/translation/settings';
import { publicError } from '../../src/translation/errors';

const mocks = vi.hoisted(() => ({
  tab: vi.fn(), tabMessage: vi.fn(), message: vi.fn(), permission: vi.fn(), offscreen: vi.fn(),
}));
vi.mock('wxt/browser', () => ({ browser: {
  tabs: { get: mocks.tab, sendMessage: mocks.tabMessage },
  runtime: { sendMessage: mocks.message },
  permissions: { contains: mocks.permission },
} }));
vi.mock('../../src/extension/offscreen-runner', () => ({ ensureOffscreen: mocks.offscreen }));

const PAGE = 'https://reader.test/title/fixture/chapter-12';
const OTHER_PAGE = 'https://reader.test/title/fixture/chapter-13';
const DOCUMENT = '0123456789abcdef0123456789abcdef';
const SOURCE_KEY = 'source-fixture-v1';
const observation = { source: 'https://cdn.test/fixture.png', sourceKey: SOURCE_KEY, naturalWidth: 800, naturalHeight: 1200,
  method: 'img', documentToken: DOCUMENT, binding: { instanceId: 'image-1', generation: 1, sourceKey: SOURCE_KEY } };
const original = { sourceLanguage: 'en' as const, regions: [] };
const snapshot: EditableRegionSnapshot = { imageId: 'fixture-image', cacheKey: 'fixture-cache', sourceKey: SOURCE_KEY,
  contentHash: 'fixture-content-hash', revision: 'original', output: original, original,
  edits: { revision: 'original', updatedAt: 0, overrides: {}, added: [] } };
const config = { settings: { ...DEFAULT_SETTINGS, model: 'gemini-crop-test' }, apiKey: 'FAKE_CROP_TEST_KEY_1234567890' };

function memoryArea(): PrivateStorageArea {
  return { async setAccessLevel() {}, async get() { return {}; }, async set() {}, async remove() {} };
}
function harness() {
  const credentials = new CredentialStore(memoryArea(), memoryArea());
  const privateConfig = vi.spyOn(credentials, 'privateConfig').mockResolvedValue(config);
  const background = new ChapterBackground({ credentials, activeTab: async () => 7, ensureTab: async () => undefined });
  const regionSnapshot = vi.spyOn(background.service, 'regionSnapshot').mockResolvedValue(snapshot);
  return { background, privateConfig, regionSnapshot };
}
function request() {
  return { type: 'chapter:reprocess-region', url: PAGE, documentToken: DOCUMENT, observation,
    cacheKey: snapshot.cacheKey, expectedRevision: snapshot.revision, crop: { x: .1, y: .2, width: .3, height: .15 } };
}
function cancel(changes: Readonly<Record<string, unknown>> = {}) {
  return { type: 'chapter:cancel-reprocess', url: PAGE, documentToken: DOCUMENT, ...changes };
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function messages(): { type: string; chapterId?: string }[] {
  return mocks.message.mock.calls.map(([message]) => message as { type: string; chapterId?: string });
}

beforeEach(() => {
  vi.resetAllMocks();
  // Snapshot calls are mocked; no IndexedDB access or credentials persistence occurs.
  vi.stubGlobal('indexedDB', {});
  mocks.tab.mockResolvedValue({ id: 7, url: PAGE });
  mocks.tabMessage.mockResolvedValue({ url: PAGE, documentToken: DOCUMENT });
  mocks.permission.mockResolvedValue(true);
  mocks.offscreen.mockResolvedValue(undefined);
  mocks.message.mockResolvedValue({ ok: true, data: { sourceLanguage: 'en', regions: [] } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('chapter crop cancellation boundaries', () => {
  it('derives the cancelled chapter from the verified current tab, ignoring a claimed foreign chapter ID', async () => {
    const h = harness();
    const result = await h.background.content(7, cancel({ chapterId: chapterIdentity(OTHER_PAGE).id }));
    expect(result).toBe(true);
    expect(mocks.message).toHaveBeenCalledExactlyOnceWith({ type: 'offscreen:region-cancel', chapterId: chapterIdentity(PAGE).id });
    expect(h.regionSnapshot).not.toHaveBeenCalled();
    expect(h.privateConfig).not.toHaveBeenCalled();
    expect(mocks.offscreen).not.toHaveBeenCalled();
  });

  it('rejects stale document or page contexts before sending a cancel message', async () => {
    const h = harness();
    await expect(h.background.content(7, cancel({ documentToken: 'abcdef0123456789abcdef0123456789' }))).rejects.toMatchObject({ code: 'STALE_IMAGE' });
    await expect(h.background.content(7, cancel({ url: OTHER_PAGE }))).rejects.toMatchObject({ code: 'STALE_IMAGE' });
    expect(mocks.message).not.toHaveBeenCalled();
    expect(h.privateConfig).not.toHaveBeenCalled();
  });

  it('cancelling a pending snapshot prevents config lookup, offscreen creation and provider start', async () => {
    const h = harness();
    const pending = gate<EditableRegionSnapshot>();
    h.regionSnapshot.mockReturnValue(pending.promise);
    const task = h.background.content(7, request());
    const rejected = expect(task).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(h.regionSnapshot).toHaveBeenCalledOnce());
    await h.background.content(7, cancel());
    pending.resolve(snapshot);
    await rejected;
    expect(h.privateConfig).not.toHaveBeenCalled();
    expect(mocks.offscreen).not.toHaveBeenCalled();
    expect(messages().map((message) => message.type)).toEqual(['offscreen:region-cancel']);
  });

  it('discards a late successful provider result after explicit cancellation', async () => {
    const h = harness();
    const pending = gate<{ ok: boolean; data: unknown }>();
    mocks.message.mockImplementation((message: { type: string }) => message.type === 'offscreen:region-reprocess'
      ? pending.promise : Promise.resolve({ ok: true }));
    const task = h.background.content(7, request());
    const rejected = expect(task).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(messages().some((message) => message.type === 'offscreen:region-reprocess')).toBe(true));
    await h.background.content(7, cancel());
    pending.resolve({ ok: true, data: { output: { sourceLanguage: 'en', regions: [] }, forbiddenLateResult: true } });
    await rejected;
    expect(h.privateConfig).toHaveBeenCalledOnce();
    expect(mocks.offscreen).toHaveBeenCalledOnce();
    expect(messages().map((message) => message.type)).toEqual(['offscreen:region-reprocess', 'offscreen:region-cancel']);
  });
});

describe('chapter crop public error routing', () => {
  it.each(['NETWORK', 'PERMISSION', 'API_DISABLED', 'KEY_BLOCKED', 'IMAGE_TOO_LARGE', 'UNSUPPORTED_IMAGE', 'CANCELLED', 'LIVE_ONLY'])('preserves the safe %s code instead of collapsing it into INTERNAL', async (code) => {
      const h = harness();
      mocks.message.mockResolvedValue({ ok: false, error: { code, message: 'FAKE_RAW_PROVIDER_SECRET_DO_NOT_ECHO' } });
      const failure: unknown = await h.background.content(7, request()).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code });
      expect(publicError(failure).code).toBe(code);
      expect(publicError(failure).message).not.toContain('FAKE_RAW_PROVIDER_SECRET');
    });

  it('maps an unknown provider code to INTERNAL without echoing provider details', async () => {
    const h = harness();
    mocks.message.mockResolvedValue({ ok: false, error: { code: 'UNRECOGNIZED_PROVIDER_ERROR', message: 'FAKE_RAW_PROVIDER_SECRET_DO_NOT_ECHO' } });
    const failure: unknown = await h.background.content(7, request()).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'INTERNAL' });
    expect(publicError(failure).message).not.toContain('FAKE_RAW_PROVIDER_SECRET');
  });
});
