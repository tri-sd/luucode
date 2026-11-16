import type { TranslationSettings } from '../translation/types';
import type { ImageObservation, TranslationProfile } from './types';

const TRACKING_PARAMS = /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid)$/i;
const SIGNED_VENDOR_PARAMS = /^(?:x-amz-(?:algorithm|credential|date|expires|signedheaders|signature|security-token)|x-goog-(?:algorithm|credential|date|expires|signedheaders|signature))$/i;

/** SHA-256 implemented synchronously so identity works in isolated HTTP content contexts too. */
export function stableDigest(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(length - 4, (bytes.length * 8) >>> 0);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const words = new Uint32Array(64);
  const rotate = (value: number, shift: number): number => (value >>> shift) | (value << (32 - shift));
  for (let offset = 0; offset < length; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const left = words[index - 15]!, right = words[index - 2]!;
      words[index] = (words[index - 16]! + (rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3))
        + words[index - 7]! + (rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = Array.from(state) as [number, number, number, number, number, number, number, number];
    for (let index = 0; index < 64; index++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[index]! + words[index]!) >>> 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0; d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < 8; index++) state[index] = (state[index]! + next[index]!) >>> 0;
  }
  return [...state].map((value) => value.toString(16).padStart(8, '0')).join('');
}

function absoluteUrl(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Unsupported chapter/image URL');
  return url;
}
function sortQuery(url: URL): void { url.searchParams.sort(); }

export function canonicalChapterUrl(input: string): string {
  const url = absoluteUrl(input);
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  // Strip reader page positions only when a chapter is explicitly identified; unknown page query stays identity.
  const explicitChapter = /(?:chapter|chap|ch)[-_/]?[0-9]+/i.test(url.pathname)
    || ['chapter', 'chapter_id', 'chapterId'].some((key) => Boolean(url.searchParams.get(key)));
  if (explicitChapter) for (const key of [...url.searchParams.keys()]) if (/^(?:page|reader_page|pageIndex)$/i.test(key)) url.searchParams.delete(key);
  // Preserve hash routers and unknown fragments; only discard known reading-position anchors.
  if (/^#(?:(?:page|p)[-_]?\d+|top|bottom)$/i.test(url.hash)) url.hash = '';
  sortQuery(url);
  return url.href;
}
export function chapterIdentity(input: string): { id: string; url: string } {
  const url = canonicalChapterUrl(input);
  return { id: `chapter-${stableDigest(url)}`, url };
}

export function canonicalImageUrl(input: string): string {
  if (!/^https?:/i.test(input)) return input;
  const url = absoluteUrl(input);
  const cloudFront = url.searchParams.has('Key-Pair-Id') && url.searchParams.has('Signature');
  const legacyS3 = url.searchParams.has('AWSAccessKeyId') && url.searchParams.has('Signature');
  for (const key of [...url.searchParams.keys()]) {
    if (SIGNED_VENDOR_PARAMS.test(key) || (cloudFront && key === 'Policy') || ((cloudFront || legacyS3) && ['Key-Pair-Id', 'Signature', 'Expires', 'AWSAccessKeyId'].includes(key))) url.searchParams.delete(key);
  }
  url.hash = ''; sortQuery(url);
  return url.href;
}

export function imageIdentity(chapterId: string, image: ImageObservation): string {
  const opaque = !/^https?:/i.test(image.source);
  // Unverifiable canvas/blob occurrences remain document-scoped and never pretend to be persistent content identity.
  const content = image.fingerprint ? ['fingerprint', image.fingerprint]
    : opaque ? ['live-only', image.source, image.documentToken, image.sourceKey, image.binding.instanceId, image.binding.generation]
      : ['url', canonicalImageUrl(image.source)];
  return `image-${stableDigest(JSON.stringify([chapterId, content, image.naturalWidth, image.naturalHeight]))}`;
}

export async function contentFingerprint(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  if (!globalThis.crypto?.subtle) throw new Error('Strong content hashing requires a trusted secure extension context');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
export const hashBlob = contentFingerprint;

export function createTranslationProfile(settings: Pick<TranslationSettings, 'model' | 'sourceLanguage'>, glossary = '', qualityMode: 'standard' | 'review' = 'standard'): TranslationProfile {
  const normalized = glossary.trim().slice(0, 4000);
  const profile = { model: settings.model, sourceLanguage: settings.sourceLanguage, targetLanguage: 'vi' as const,
    ocrVersion: 'gemini-vision-v2', promptVersion: 'chapter-vision-v2', qualityMode, glossaryVersion: stableDigest(normalized), glossary: normalized };
  return { ...profile, key: `profile-${stableDigest(JSON.stringify(profile))}` };
}
export function translationCacheKey(contentHash: string, profile: TranslationProfile): string {
  return `translation-${stableDigest(JSON.stringify([contentHash, profile.key]))}`;
}

/** Existing standard chapters retain their exact v0.4 profile/cache, rather than silently paying to upgrade OCR. */
export function resolveChapterProfile(settings: Pick<TranslationSettings,'model'|'sourceLanguage'>, glossary: string, qualityMode: 'standard'|'review' = 'standard', previous?: TranslationProfile): TranslationProfile {
  if (qualityMode === 'standard' && previous?.ocrVersion === 'gemini-vision-v1' && previous.promptVersion === 'chapter-vision-v1'
    && previous.model === settings.model && previous.sourceLanguage === settings.sourceLanguage && previous.targetLanguage === 'vi'
    && previous.glossaryVersion === stableDigest(glossary.trim().slice(0,4000))) return previous;
  return createTranslationProfile(settings,glossary,qualityMode);
}
