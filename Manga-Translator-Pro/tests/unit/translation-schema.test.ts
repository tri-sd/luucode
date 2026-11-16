import { describe, expect, it } from 'vitest';
import { parseVisionJson } from '../../src/translation/schema';
import { TranslationError, publicError } from '../../src/translation/errors';
import { modelId, validateApiKey, validateSettings } from '../../src/translation/settings';
import { imageOrigin } from '../../src/translation/image-pipeline';

function sample() {
  return { coordinateSystem: 'normalized_1000', sourceLanguage: 'ja', regions: [
    { id: 'r1', sourceText: '行こう！', translatedText: 'Đi thôi!', bbox: [150, 120, 260, 460] },
    { id: 'r2', sourceText: '待って', translatedText: 'Đợi đã!', bbox: [570, 540, 690, 860] },
  ] };
}

describe('Gemini structured OCR and translation', () => {
  it('keeps source text, Vietnamese text, multiple regions and image-relative boxes', () => {
    const output = parseVisionJson(JSON.stringify(sample()));
    expect(output.sourceLanguage).toBe('ja');
    expect(output.regions).toHaveLength(2);
    expect(output.regions[0]).toEqual({ id: 'r1', sourceText: '行こう！', translatedText: 'Đi thôi!', box: { x: 0.12, y: 0.15, width: 0.34, height: expect.closeTo(0.11, 10) } });
  });
  it.each(['en', 'ja', 'zh', 'ko', 'mixed', 'unknown'])('accepts source language %s', (language) => {
    expect(parseVisionJson(JSON.stringify({ ...sample(), sourceLanguage: language })).sourceLanguage).toBe(language);
  });
  it('allows a genuinely text-free image without inventing regions', () => {
    expect(parseVisionJson(JSON.stringify({ ...sample(), regions: [] })).regions).toEqual([]);
  });
  it('clamps only small edge-rounding errors before normalization', () => {
    const raw = sample(); raw.regions[0]!.bbox = [-2, -1, 1003, 1001];
    expect(parseVisionJson(JSON.stringify(raw)).regions[0]!.box).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
  it.each([
    [-6, 0, 20, 20], [0, 0, 1006, 20], [100, 10, 50, 90], [0, 80, 100, 20],
    [0, 0, 0, 50], [10, 10, 50, 10],
  ])('rejects invalid geometry %j instead of silently swapping axes', (a, b, c, d) => {
    const raw = sample(); raw.regions[0]!.bbox = [a, b, c, d];
    expect(() => parseVisionJson(JSON.stringify(raw))).toThrow(new TranslationError('INVALID_COORDINATES'));
  });
  it.each(['', '{"regions":', '```json\n{}\n```', 'null', '[]'])('rejects invalid/truncated JSON %s', (input) => {
    expect(() => parseVisionJson(input)).toThrow(new TranslationError('INVALID_JSON'));
  });
  it.each([
    { coordinateSystem: 'pixels' }, { sourceLanguage: 'vi' }, { sourceLanguage: {} },
    { regions: [{ id: 'a', sourceText: 'x', translatedText: 'y', bbox: [0, 0, '10', 10] }] },
    { regions: [{ id: 'a', sourceText: '', translatedText: 'y', bbox: [0, 0, 10, 10] }] },
    { regions: [{ id: 'a', sourceText: 'x', translatedText: '', bbox: [0, 0, 10, 10] }] },
    { regions: [{ id: 'a', sourceText: 'x', translatedText: 'y', bbox: [0, 10, 10] }] },
    { unexpected: true },
  ])('rejects wrong schema or coordinates %j', (change) => {
    expect(() => parseVisionJson(JSON.stringify({ ...sample(), ...change }))).toThrow(TranslationError);
  });
  it('rejects duplicate IDs and excessive region counts', () => {
    const raw = sample();
    expect(() => parseVisionJson(JSON.stringify({ ...raw, regions: [raw.regions[0], raw.regions[0]] }))).toThrow(TranslationError);
    expect(() => parseVisionJson(JSON.stringify({ ...raw, regions: Array.from({ length: 101 }, (_, i) => ({ ...raw.regions[0], id: `r${i}` })) }))).toThrow(TranslationError);
  });
});

describe('configuration validation and safe errors', () => {
  it('supports a Gemini ID without accepting arbitrary URLs or paths', () => {
    expect(modelId('models/gemini-vision-test')).toBe('gemini-vision-test');
    expect(() => modelId('https://example.test/steal-key')).toThrow(TranslationError);
    expect(() => modelId('gemini-../../x')).toThrow(TranslationError);
  });
  it('checks key syntax without putting the key in error messages', () => {
    expect(validateApiKey('  TEST_SECRET_KEY_123456789  ')).toBe('TEST_SECRET_KEY_123456789');
    expect(() => validateApiKey('secret\nheader')).toThrow(new TranslationError('KEY_FORMAT'));
    expect(publicError(new Error('SECRET_KEY in a fetch URL'))).toEqual({ code: 'INTERNAL', message: expect.not.stringContaining('SECRET_KEY') });
  });
  it('accepts supported language and bounded timeout settings', () => {
    expect(validateSettings({ model: 'gemini-vision-test', sourceLanguage: 'ko', timeoutSeconds: 60, rememberKey: false }).sourceLanguage).toBe('ko');
    expect(() => validateSettings({ model: 'gemini-vision-test', sourceLanguage: 'vi', timeoutSeconds: 60, rememberKey: false })).toThrow(TranslationError);
    expect(() => validateSettings({ model: '', sourceLanguage: 'auto', timeoutSeconds: 99999, rememberKey: true })).toThrow(TranslationError);
  });
  it('scopes image permission to the origin and rejects privileged/credential-bearing URLs', () => {
    expect(imageOrigin('https://cdn.example.test/page.jpg?token=private')).toBe('https://cdn.example.test/*');
    for (const url of ['file:///D:/secret', 'chrome://settings', 'https://user:pass@example.test/x', 'data:image/png;base64,AA']) {
      expect(() => imageOrigin(url)).toThrow(TranslationError);
    }
  });
});
