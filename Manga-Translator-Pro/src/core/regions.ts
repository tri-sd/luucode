import { isValidRegionMetadata } from './region-metadata';
import { isNormalizedBox } from './geometry';
import type { RegionBinding, TextRegion } from './types';

export function matchesBinding(current: RegionBinding, result: RegionBinding): boolean {
  return current.instanceId === result.instanceId
    && current.generation === result.generation && current.sourceKey === result.sourceKey;
}

export function validateRegions(regions: readonly TextRegion[]): boolean {
  const ids = new Set<string>();
  return regions.every((region) => {
    if (!region.id || ids.has(region.id) || !isNormalizedBox(region.box)
      || typeof region.text !== 'string' || !region.text.trim() || !isValidRegionMetadata(region, region.box)) return false;
    ids.add(region.id);
    return true;
  });
}

export function createMockRegions(label: string): readonly TextRegion[] {
  return [
    {
      id: 'mock-1',
      box: { x: 0.12, y: 0.15, width: 0.34, height: 0.11 },
      text: `GIẢ LẬP · ${label}\nChúng ta bắt đầu thôi!`,
    },
    {
      id: 'mock-2',
      box: { x: 0.54, y: 0.57, width: 0.32, height: 0.12 },
      text: 'GIẢ LẬP\nVị trí này bám theo ảnh gốc.',
    },
  ];
}
