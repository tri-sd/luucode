import { describe, expect, it } from 'vitest';
import { CredentialStore, type PrivateStorageArea } from '../../src/extension/credentials';
import { isBackgroundSender, isOffscreenSender, isTrustedUi, validateSelection } from '../../src/extension/security';
import { isRunning, JobStore } from '../../src/extension/jobs';
import { DEFAULT_SETTINGS } from '../../src/translation/settings';
import type { PublicJob } from '../../src/translation/types';

class MemoryArea implements PrivateStorageArea {
  readonly data: Record<string, unknown> = {};
  readonly events: string[] = [];
  async setAccessLevel(): Promise<void> { this.events.push('trusted'); }
  async get(keys: string[]): Promise<Record<string, unknown>> { this.events.push('get'); return Object.fromEntries(keys.map((key) => [key, structuredClone(this.data[key])])); }
  async set(items: Record<string, unknown>): Promise<void> { this.events.push('set'); Object.assign(this.data, structuredClone(items)); }
  async remove(keys: string[]): Promise<void> { this.events.push('remove'); keys.forEach((key) => delete this.data[key]); }
}

describe('credential isolation', () => {
  const key = 'FAKE_SECRET_API_KEY_123456789';
  it('defaults to session-only storage, protects both areas first and never returns the key in public config', async () => {
    const local = new MemoryArea(), session = new MemoryArea();
    const store = new CredentialStore(local, session);
    const result = await store.save(DEFAULT_SETTINGS, key);
    expect(result.hasKey).toBe(true);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(local.data['mtp.private.apiKey']).toBeUndefined();
    expect(session.data['mtp.private.apiKey']).toBe(key);
    expect(local.events[0]).toBe('trusted'); expect(session.events[0]).toBe('trusted');
    expect(JSON.stringify(await store.publicConfig())).not.toContain(key);
    expect((await store.privateConfig()).apiKey).toBe(key);
  });
  it('moves remembered keys between trusted storage areas and erases both on clear', async () => {
    const local = new MemoryArea(), session = new MemoryArea();
    const store = new CredentialStore(local, session);
    await store.save({ ...DEFAULT_SETTINGS, rememberKey: true }, key);
    expect(local.data['mtp.private.apiKey']).toBe(key);
    expect(session.data['mtp.private.apiKey']).toBeUndefined();
    await store.save(DEFAULT_SETTINGS, '');
    expect(local.data['mtp.private.apiKey']).toBeUndefined();
    expect(session.data['mtp.private.apiKey']).toBe(key);
    await store.clearKey();
    expect((await store.publicConfig()).hasKey).toBe(false);
    expect(local.data['mtp.private.apiKey']).toBeUndefined();
    expect(session.data['mtp.private.apiKey']).toBeUndefined();
  });
  it('serializes concurrent saves without returning secrets', async () => {
    const store = new CredentialStore(new MemoryArea(), new MemoryArea());
    const results = await Promise.all([store.save(DEFAULT_SETTINGS, key), store.save(DEFAULT_SETTINGS, `${key}_SECOND`)]);
    expect((await store.privateConfig()).apiKey).toBe(`${key}_SECOND`);
    expect(JSON.stringify(results)).not.toContain(key);
  });
});

describe('runtime message authorization', () => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  it('allows only exact extension UI pages to use private configuration RPC', () => {
    expect(isTrustedUi({ id, url: `chrome-extension://${id}/options.html` }, id)).toBe(true);
    expect(isTrustedUi({ id, url: `chrome-extension://${id}/popup.html` }, id)).toBe(true);
  });
  it.each([
    { url: 'https://example.test/' }, { url: 'https://example.test/?next=chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html' },
    { url: 'chrome-extension://other/options.html' }, { url: `chrome-extension://${id}/offscreen.html` }, {},
  ])('denies website/content/unknown callers %j', (sender) => {
    expect(isTrustedUi({ id, ...sender }, id)).toBe(false);
  });
  it('separates offscreen completion and background key transport from content scripts', () => {
    expect(isOffscreenSender({ id, url: `chrome-extension://${id}/offscreen.html` }, id)).toBe(true);
    expect(isOffscreenSender({ id, url: 'https://reader.test/' }, id)).toBe(false);
    expect(isBackgroundSender({ id }, id)).toBe(true);
    expect(isBackgroundSender({ id, tab: {}, url: 'https://reader.test/' }, id)).toBe(false);
    expect(isBackgroundSender({ id, url: `chrome-extension://${id}/options.html` }, id)).toBe(false);
  });
  it('requires a document token before accepting a serialized image selection', () => {
    const image = { instanceId: 'image-1', generation: 1, sourceKey: 'source', source: 'https://cdn.test/a.jpg', naturalWidth: 1000, naturalHeight: 1600 };
    expect(() => validateSelection(image)).toThrow();
    expect(validateSelection({ ...image, documentToken: 'DOCUMENT_TOKEN_123456789' }).documentToken).toBe('DOCUMENT_TOKEN_123456789');
  });
});

describe('public job lifecycle', () => {
  const job: PublicJob = { id: 'test-job', tabId: 1, phase: 'preparing', tile: 0, tiles: 0, message: 'loading', createdAt: 1 };
  it('cannot resurrect a cancelled job with late progress or completion', async () => {
    const jobs = new JobStore(new MemoryArea());
    await jobs.update(job);
    expect(await jobs.transition({ ...job, phase: 'cancelled' })).toBe(true);
    expect(await jobs.transition({ ...job, phase: 'translating' })).toBe(false);
    expect(await jobs.transition({ ...job, phase: 'done' })).toBe(false);
    expect((await jobs.forTab(1))?.phase).toBe('cancelled');
  });
  it('keeps one recent job per tab and bounds session storage', async () => {
    const jobs = new JobStore(new MemoryArea());
    for (let tabId = 1; tabId <= 5; tabId++) await jobs.update({ ...job, id: `job-${tabId}`, tabId });
    expect(await jobs.all()).toHaveLength(3);
    await jobs.update({ ...job, id: 'replacement', tabId: 5 });
    expect((await jobs.all()).filter((item) => item.tabId === 5)).toHaveLength(1);
    expect(isRunning({ ...job, phase: 'error' })).toBe(false);
  });
});
