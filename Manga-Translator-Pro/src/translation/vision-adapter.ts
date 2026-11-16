import type { NormalizedBox } from '../core/types';
import type { VisionOutput, VisionRegion } from './types';

/** The cloud adapter performs detection/OCR/translation in one call; it is not a separate local detector. */
export interface VisionAdapterCapabilities {
  readonly languages: readonly ['en','ja','zh','ko'];
  readonly polygon: boolean;
  readonly confidence: 'self-reported';
  readonly localRuntimeRequired: false;
  readonly inpainting: false;
}
export const GEMINI_VISION_CAPABILITIES: VisionAdapterCapabilities = {
  languages: ['en','ja','zh','ko'], polygon: true, confidence: 'self-reported', localRuntimeRequired: false, inpainting: false,
};
function intersectionOverUnion(a: NormalizedBox,b: NormalizedBox): number {
  const width = Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
  const height = Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  const intersection = width*height;
  return intersection/(a.width*a.height+b.width*b.height-intersection || 1);
}
/** An audit may add missed regions, but never replaces another speaker's existing dialogue. */
export function mergeVisionAudit(first: VisionOutput, audit: VisionOutput): VisionOutput {
  const regions: VisionRegion[] = [...first.regions];
  const canonical = (text: string): string => text.normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase();
  for (const region of audit.regions) {
    if (regions.some((previous) => {
      const overlap = intersectionOverUnion(previous.box,region.box);
      return overlap >= .85 || (overlap >= .55 && canonical(previous.sourceText) === canonical(region.sourceText));
    })) continue;
    let id = `audit-${region.id}`;
    while (regions.some((previous) => previous.id === id)) id = `audit-${id}`;
    regions.push({ ...region,id });
  }
  return { sourceLanguage: first.sourceLanguage === audit.sourceLanguage ? first.sourceLanguage : 'mixed',regions };
}
