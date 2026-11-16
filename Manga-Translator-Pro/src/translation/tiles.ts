import { isNormalizedBox } from '../core/geometry';
import { TranslationError } from './errors';
import type { ImageTile, TranslatedRegion, VisionOutput } from './types';

export function planTiles(width: number, height: number): readonly ImageTile[] {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0)
    || width * height > 40_000_000) throw new TranslationError('IMAGE_TOO_LARGE');
  const size = 2048;
  const step = size - 192;
  const tiles: ImageTile[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      tiles.push({ index: tiles.length, x, y, width: Math.min(size, width - x), height: Math.min(size, height - y), sourceWidth: width, sourceHeight: height });
      if (tiles.length > 12) throw new TranslationError('IMAGE_TOO_LARGE');
      if (x + size >= width) break;
    }
    if (y + size >= height) break;
  }
  return tiles;
}

export function mapTileRegions(output: VisionOutput, tile: ImageTile): readonly TranslatedRegion[] {
  return output.regions.map((region) => {
    const box = {
      x: (tile.x + region.box.x * tile.width) / tile.sourceWidth,
      y: (tile.y + region.box.y * tile.height) / tile.sourceHeight,
      width: region.box.width * tile.width / tile.sourceWidth,
      height: region.box.height * tile.height / tile.sourceHeight,
    };
    if (!isNormalizedBox(box)) throw new TranslationError('INVALID_COORDINATES');
    const { sourceText, translatedText, id: _id, box: _box, polygon: _polygon, ...metadata } = region;
    void _id; void _box; void _polygon;
    return { ...metadata, id: `tile-${tile.index}-${region.id}`, box,
      ...(region.polygon ? { polygon: region.polygon.map((point) => ({ x: (tile.x + point.x * tile.width) / tile.sourceWidth, y: (tile.y + point.y * tile.height) / tile.sourceHeight })) } : {}), text: translatedText, sourceText, sourceLanguage: output.sourceLanguage };
  });
}

export function deduplicateRegions(regions: readonly TranslatedRegion[]): readonly TranslatedRegion[] {
  const result: TranslatedRegion[] = [];
  const canonical = (text: string): string => text.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
  for (const region of regions) {
    const duplicate = result.some((other) => {
      if (canonical(other.sourceText) !== canonical(region.sourceText)) return false;
      const left = Math.max(other.box.x, region.box.x), top = Math.max(other.box.y, region.box.y);
      const right = Math.min(other.box.x + other.box.width, region.box.x + region.box.width);
      const bottom = Math.min(other.box.y + other.box.height, region.box.y + region.box.height);
      const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
      const union = other.box.width * other.box.height + region.box.width * region.box.height - intersection;
      return union > 0 && intersection / union >= 0.65;
    });
    if (!duplicate) result.push(region);
  }
  if (result.length > 500) throw new TranslationError('INVALID_JSON');
  return result;
}
