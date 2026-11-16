import { describe, expect, it } from 'vitest';
import { createMockRegions, matchesBinding, validateRegions } from '../../src/core/regions';
import { isTrackingMessage } from '../../src/core/messages';
import type { RegionResult } from '../../src/core/types';

describe('image/source binding', () => {
  const current = { instanceId: 'image-1', generation: 2, sourceKey: 'chapter-2' };
  const result: RegionResult = { ...current, regions: createMockRegions('test') };
  it('accepts the exact current source generation', () => expect(matchesBinding(current, result)).toBe(true));
  it.each([
    { instanceId: 'image-2' }, { generation: 1 }, { sourceKey: 'chapter-1' },
  ])('rejects a stale or incorrect binding %j', (change) => {
    expect(matchesBinding(current, { ...result, ...change })).toBe(false);
  });
  it('generates unique valid mock regions with explicit demo labels', () => {
    expect(validateRegions(result.regions)).toBe(true);
    expect(result.regions.every((region) => region.text.includes('GIẢ LẬP'))).toBe(true);
  });
  it('rejects duplicate region IDs', () => {
    const region = result.regions[0]!;
    expect(validateRegions([region, region])).toBe(false);
  });
  it('rejects blank text and out-of-image geometry', () => {
    const region = result.regions[0]!;
    expect(validateRegions([{ ...region, text: ' ' }])).toBe(false);
    expect(validateRegions([{ ...region, box: { x: 0.9, y: 0, width: 0.2, height: 0.1 } }])).toBe(false);
  });
  it.each([null, 'start', {}, { type: 'mtp:tracking', command: 'eval' }, { type: 'mtp:tracking', command: {} }])('rejects malformed messages %j', (value) => {
    expect(isTrackingMessage(value)).toBe(false);
  });
  it('accepts the typed tracking protocol', () => {
    expect(isTrackingMessage({ type: 'mtp:tracking', command: 'start' })).toBe(true);
  });
});
