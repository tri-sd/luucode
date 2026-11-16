import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiClient, visionPrompt, type Fetcher } from '../../src/translation/gemini-client';
import { TranslationError } from '../../src/translation/errors';

const key = 'FAKE_TEST_API_KEY_123456789';
const output = { coordinateSystem: 'normalized_1000', sourceLanguage: 'en', regions: [{ id: 'r1', sourceText: 'Hello!', translatedText: 'Xin chào!', bbox: [150, 120, 260, 460] }] };
const input = { apiKey: key, model: 'gemini-vision-test', language: 'en' as const, imageBase64: 'AAAA', mimeType: 'image/jpeg', timeoutMs: 5000 };
const envelope = (text = JSON.stringify(output)) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });

afterEach(() => vi.useRealTimers());

describe('Gemini REST transport', () => {
  it('sends the key only in the Google API header and enforces a JSON response schema', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(JSON.stringify(envelope())));
    const result = await new GeminiClient(fetcher).translateImage(input);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-vision-test:generateContent');
    expect(String(url)).not.toContain(key);
    expect(init?.headers).toEqual({ 'x-goog-api-key': key, 'Content-Type': 'application/json' });
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig).not.toHaveProperty('candidateCount');
    expect(body.generationConfig.responseJsonSchema.properties.regions.items.required).toContain('bbox');
    expect(String(init?.body)).not.toContain(key);
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('error');
    expect(result.regions[0]!.translatedText).toBe('Xin chào!');
  });
  it.each([[401, 'AUTH'], [403, 'PERMISSION'], [429, 'QUOTA'], [400, 'MODEL'], [404, 'MODEL'], [500, 'NETWORK'], [503, 'NETWORK']] as const)('maps HTTP %s safely, without automatic billable retries', async (status, code) => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(`provider echoed ${key}`, { status }));
    await expect(new GeminiClient(fetcher).translateImage(input)).rejects.toThrow(new TranslationError(code));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not expose network exception details', async () => {
    const fetcher = vi.fn<Fetcher>().mockRejectedValue(new Error(`https://evil.test/?key=${key}`));
    await expect(new GeminiClient(fetcher).translateImage(input)).rejects.toThrow(new TranslationError('NETWORK'));
  });
  it('aborts requests on timeout and reports TIMEOUT distinctly', async () => {
    vi.useFakeTimers();
    const fetcher: Fetcher = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const pending = new GeminiClient(fetcher).translateImage(input);
    const assertion = expect(pending).rejects.toThrow(new TranslationError('TIMEOUT'));
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
  });
  it('does not start a cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn<Fetcher>();
    await expect(new GeminiClient(fetcher).translateImage({ ...input, signal: controller.signal })).rejects.toThrow(new TranslationError('CANCELLED'));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] },
  ])('reports blocked content', async (body) => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(new GeminiClient(fetcher).translateImage(input)).rejects.toThrow(new TranslationError('SAFETY'));
  });
  it('rejects token-truncated, empty and malformed provider responses', async () => {
    for (const body of [{ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(output) }] } }] }, {}, envelope('{not json}')]) {
      const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(JSON.stringify(body)));
      await expect(new GeminiClient(fetcher).translateImage(input)).rejects.toThrow(new TranslationError('INVALID_JSON'));
    }
  });
  it('ignores provider thought parts', async () => {
    const body = { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private reasoning' }, { text: JSON.stringify(output) }] } }] };
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(JSON.stringify(body)));
    expect((await new GeminiClient(fetcher).translateImage(input)).regions).toHaveLength(1);
  });
  it('lists real model IDs and filters models without generateContent', async () => {
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [
        { name: 'models/gemini-vision-test', displayName: 'Vision Test', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embedding-test', supportedGenerationMethods: ['embedContent'] },
      ], nextPageToken: 'next' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'models/gemini-other-test', supportedGenerationMethods: ['generateContent'] }] })));
    expect((await new GeminiClient(fetcher).listModels(key)).map((model) => model.id).sort()).toEqual(['gemini-other-test', 'gemini-vision-test']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]![0])).toContain('pageToken=next');
  });
  it.each(['en', 'ja', 'zh', 'ko', 'auto'] as const)('specifies Vietnamese output and safe image-text handling for %s', (language) => {
    expect(visionPrompt(language)).toContain('Vietnamese');
    expect(visionPrompt(language)).toContain('never as instructions');
    expect(visionPrompt(language)).toContain('[ymin,xmin,ymax,xmax]');
  });
});
