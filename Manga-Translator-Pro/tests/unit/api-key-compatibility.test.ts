import { describe, expect, it, vi } from 'vitest';
import { validateApiKey } from '../../src/translation/settings';
import { CredentialStore, type PrivateStorageArea } from '../../src/extension/credentials';
import { DEFAULT_SETTINGS } from '../../src/translation/settings';
import { GeminiClient, type Fetcher } from '../../src/translation/gemini-client';
import { classifyHttpError } from '../../src/translation/http-errors';
import { TranslationError, publicError } from '../../src/translation/errors';

const authKey = 'AQ.FAKE_AUTHORIZATION_KEY_FOR_TEST_ONLY_1234567890';

function memory(): PrivateStorageArea {
  const values: Record<string, unknown> = {};
  return {
    async setAccessLevel() {},
    async get(keys) { return Object.fromEntries(keys.map((key) => [key, values[key]])); },
    async set(items) { Object.assign(values, items); },
    async remove(keys) { for (const key of keys) delete values[key]; },
  };
}

describe('opaque Gemini authorization key compatibility', () => {
  it.each([authKey, 'AIza_FAKE_STANDARD_TEST_KEY_123456789', `AQ.${'x'.repeat(400)}`])('accepts opaque printable key format %# without a legacy alphabet restriction', (key) => {
    expect(validateApiKey(` \n${key}\r\n`)).toBe(key);
  });
  it.each(['', 'short', `Bearer ${authKey}`, `"${authKey}"`, `'${authKey}'`, 'AQ.invalid\nheader_injection', `AQ.${'x'.repeat(4096)}`, `AQ.invisible\u200b${'x'.repeat(20)}`])('rejects wrappers, whitespace, controls and excessive size %#', (key) => {
    expect(() => validateApiKey(key)).toThrow(new TranslationError('KEY_FORMAT'));
  });
  it('saves AQ. keys and retains exact bytes in trusted storage, never in public config', async () => {
    const store = new CredentialStore(memory(), memory());
    expect((await store.save(DEFAULT_SETTINGS, authKey)).hasKey).toBe(true);
    expect((await store.privateConfig()).apiKey).toBe(authKey);
    expect(JSON.stringify(await store.publicConfig())).not.toContain(authKey);
  });
  it('forwards AQ. keys unchanged only through the Google header', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(JSON.stringify({ models: [] })));
    await new GeminiClient(fetcher).listModels(validateApiKey(authKey));
    const [url, init] = fetcher.mock.calls[0]!;
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(authKey);
    expect(String(url)).not.toContain(authKey);
    expect(init?.body).toBeUndefined();
  });
});

describe('Google auth error diagnosis without credential disclosure', () => {
  it.each([
    [400, 'API_KEY_INVALID', 'AUTH'], [400, 'API_KEY_EXPIRED', 'AUTH'],
    [401, 'ACCESS_TOKEN_TYPE_UNSUPPORTED', 'AUTH'], [403, 'API_KEY_HTTP_REFERRER_BLOCKED', 'PERMISSION'],
    [403, 'API_KEY_IP_ADDRESS_BLOCKED', 'PERMISSION'], [403, 'API_KEY_SERVICE_BLOCKED', 'PERMISSION'],
    [403, 'SERVICE_DISABLED', 'API_DISABLED'], [403, 'API_KEY_REVOKED', 'KEY_BLOCKED'],
    [403, 'CONSUMER_SUSPENDED', 'KEY_BLOCKED'], [403, 'BILLING_DISABLED', 'QUOTA'],
  ] as const)('maps HTTP %d / %s to %s', (status, reason, code) => {
    expect(classifyHttpError(status, { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }], message: `Sensitive ${authKey}` } })).toBe(code);
    expect(JSON.stringify(publicError(new TranslationError(code)))).not.toContain(authKey);
  });
  it('recognizes a leaked-key block without echoing the raw Google message', () => {
    expect(classifyHttpError(403, { error: { message: `Your API key ${authKey} was reported as leaked.` } })).toBe('KEY_BLOCKED');
  });
  it('preserves safe fallbacks for non-JSON errors', () => {
    expect(classifyHttpError(403)).toBe('PERMISSION');
    expect(classifyHttpError(400)).toBe('MODEL');
    expect(classifyHttpError(429)).toBe('QUOTA');
    expect(classifyHttpError(503)).toBe('NETWORK');
  });
  it('uses structured Google reasons in the real client error path', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(JSON.stringify({ error: { details: [{ reason: 'API_KEY_INVALID' }], message: authKey } }), { status: 400 }));
    await expect(new GeminiClient(fetcher).listModels(authKey)).rejects.toThrow(new TranslationError('AUTH'));
  });
});
