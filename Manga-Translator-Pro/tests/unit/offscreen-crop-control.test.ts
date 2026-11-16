import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/translation/settings';
import type { TranslationOutput } from '../../src/translation/types';

type Reply = (value: unknown) => void;
type Listener = (message: unknown, sender: { id: string; url?: string; tab?: object }, reply: Reply) => unknown;
const mocks = vi.hoisted(() => ({ crop: vi.fn(), busy: vi.fn(), command: vi.fn(), addListener: vi.fn(), sendMessage: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'test-extension', onMessage: { addListener: mocks.addListener }, sendMessage: mocks.sendMessage } } }));
vi.mock('../../src/chapter/region-reprocessor', () => ({ RegionReprocessor: class { run = mocks.crop; } }));
vi.mock('../../src/chapter/chapter-executor', () => ({ ChapterExecutor: class { isBusy = mocks.busy; command = mocks.command; } }));
vi.mock('../../src/chapter/indexeddb-cache', () => ({ IndexedDBCache: class {} }));

const chapterId = `chapter-${'a'.repeat(64)}`;
const output: TranslationOutput = { sourceLanguage: 'en', regions: [] };
const trusted = { id: 'test-extension', url: 'chrome-extension://test-extension/background.js' };
const request = { type: 'offscreen:region-reprocess', request: { chapterId, imageId: 'image-1', cacheKey: 'cache-1', expectedRevision: '',
  crop: { x: .1, y: .2, width: .3, height: .1 }, settings: { ...DEFAULT_SETTINGS, model: 'gemini-test' }, apiKey: 'SYNTHETIC_TEST_KEY_ONLY' } };
let listener: Listener;
let cancellationError: () => Error;
function send(message: unknown, sender = trusted): Promise<unknown> {
  return new Promise((resolve) => { listener(message, sender, resolve); });
}
function cancellableCrop(): void {
  mocks.crop.mockImplementation((_request: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(cancellationError()), { once: true });
  }));
}

beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks();
  mocks.busy.mockResolvedValue(false); mocks.command.mockResolvedValue(undefined); mocks.sendMessage.mockResolvedValue({ ok: true });
  mocks.crop.mockResolvedValue(output);
  const { TranslationError } = await import('../../src/translation/errors');
  cancellationError = () => new TranslationError('CANCELLED');
  await import('../../src/entrypoints/offscreen/main');
  listener = mocks.addListener.mock.calls[0]![0] as Listener;
});

describe('trusted offscreen crop controls', () => {
  it('aborts an active crop outside the serialized operation queue', async () => {
    cancellableCrop();
    const pending = send(request);
    await vi.waitFor(() => expect(mocks.crop).toHaveBeenCalledOnce());
    await expect(send({ type: 'offscreen:region-cancel', chapterId })).resolves.toEqual({ ok: true });
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    mocks.crop.mockResolvedValue(output);
    await expect(send(request)).resolves.toEqual({ ok: true, data: output });
  });

  it.each(['pause', 'cancel'])('aborts crop before queuing chapter %s', async (command) => {
    cancellableCrop();
    const pending = send(request);
    await vi.waitFor(() => expect(mocks.crop).toHaveBeenCalledOnce());
    const control = send({ type: 'offscreen:chapter-command', request: { chapterId, command } });
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    await expect(control).resolves.toEqual({ ok: true, data: undefined });
    expect(mocks.command).toHaveBeenCalledWith({ chapterId, command });
  });

  it('checks cancellation before a cached crop lookup after a slow busy check', async () => {
    let finish!: (busy: boolean) => void;
    mocks.busy.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const pending = send(request);
    await vi.waitFor(() => expect(mocks.busy).toHaveBeenCalledOnce());
    await send({ type: 'offscreen:region-cancel', chapterId }); finish(false);
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(mocks.crop).not.toHaveBeenCalled();
  });

  it('discards a cached or completed response returned after cancellation', async () => {
    let finish!: (value: TranslationOutput) => void;
    mocks.crop.mockImplementation(() => new Promise<TranslationOutput>((resolve) => { finish = resolve; }));
    const pending = send(request);
    await vi.waitFor(() => expect(mocks.crop).toHaveBeenCalledOnce());
    await send({ type: 'offscreen:region-cancel', chapterId }); finish(output);
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });

  it('cancels a queued crop without cancelling a different active chapter', async () => {
    let finish!: (value: TranslationOutput) => void;
    mocks.crop.mockImplementationOnce(() => new Promise<TranslationOutput>((resolve) => { finish = resolve; }));
    const first = send(request);
    await vi.waitFor(() => expect(mocks.crop).toHaveBeenCalledOnce());
    const nextChapter = `chapter-${'b'.repeat(64)}`;
    const queued = send({ ...request, request: { ...request.request, chapterId: nextChapter } });
    await send({ type: 'offscreen:region-cancel', chapterId: nextChapter });
    finish(output);
    await expect(first).resolves.toEqual({ ok: true, data: output });
    await expect(queued).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(mocks.crop).toHaveBeenCalledOnce();
    await expect(send({ ...request, request: { ...request.request, chapterId: nextChapter } })).resolves.toEqual({ ok: true, data: output });
  });

  it('ignores another chapter or an untrusted sender and validates cancel IDs', async () => {
    let finish!: (value: TranslationOutput) => void, signal!: AbortSignal;
    mocks.crop.mockImplementation((_request: unknown, input: AbortSignal) => { signal = input; return new Promise<TranslationOutput>((resolve) => { finish = resolve; }); });
    const pending = send(request);
    await vi.waitFor(() => expect(mocks.crop).toHaveBeenCalledOnce());
    await send({ type: 'offscreen:region-cancel', chapterId: `chapter-${'b'.repeat(64)}` });
    const reply = vi.fn();
    listener({ type: 'offscreen:region-cancel', chapterId }, { id: 'test-extension', url: 'https://reader.test/', tab: {} }, reply);
    expect(reply).not.toHaveBeenCalled(); expect(signal.aborted).toBe(false);
    await expect(send({ type: 'offscreen:region-cancel', chapterId: 'invalid' })).resolves.toMatchObject({ ok: false, error: { code: 'CONFIG' } });
    expect(signal.aborted).toBe(false); finish(output);
    await expect(pending).resolves.toEqual({ ok: true, data: output });
  });

  it('retains TIMEOUT when its own deadline aborts a crop', async () => {
    vi.useFakeTimers();
    try {
      cancellableCrop();
      const pending = send(request);
      await vi.advanceTimersByTimeAsync(180_000);
      await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    } finally { vi.useRealTimers(); }
  });
});
