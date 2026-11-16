import type { NormalizedBox, NormalizedPoint, RegionMetadata, TextRegion } from './types';

const EPSILON = 1e-9;
function point(value: unknown): value is NormalizedPoint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as NormalizedPoint;
  return [candidate.x, candidate.y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1);
}
const samePoint = (a: NormalizedPoint, b: NormalizedPoint): boolean => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
const cross = (a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function onSegment(a: NormalizedPoint, b: NormalizedPoint, p: NormalizedPoint): boolean {
  return Math.abs(cross(a, b, p)) < EPSILON && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON
    && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
}
function intersects(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint, d: NormalizedPoint): boolean {
  const first = cross(a, b, c), second = cross(a, b, d), third = cross(c, d, a), fourth = cross(c, d, b);
  const opposite = (left: number, right: number): boolean => (left > EPSILON && right < -EPSILON) || (left < -EPSILON && right > EPSILON);
  if (opposite(first, second) && opposite(third, fourth)) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/** Reject crossing/degenerate polygons; bounds remain relative to the full source image. */
export function isValidPolygon(value: unknown, box?: NormalizedBox): value is readonly NormalizedPoint[] {
  if (box && (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0
    || box.x + box.width > 1 + EPSILON || box.y + box.height > 1 + EPSILON)) return false;
  if (!Array.isArray(value) || value.length < 3 || value.length > 16 || !value.every(point)) return false;
  const vertices: readonly NormalizedPoint[] = samePoint(value[0]!, value[value.length - 1]!) ? value.slice(0, -1) : value;
  if (vertices.length < 3) return false;
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i]!;
    if (vertices.some((other, j) => i !== j && samePoint(vertex, other))) return false;
    if (box && (vertex.x < box.x - 1e-7 || vertex.y < box.y - 1e-7
      || vertex.x > box.x + box.width + 1e-7 || vertex.y > box.y + box.height + 1e-7)) return false;
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i + 1 || (i === 0 && j === vertices.length - 1)) continue;
      if (intersects(vertex, vertices[(i + 1) % vertices.length]!, vertices[j]!, vertices[(j + 1) % vertices.length]!)) return false;
    }
  }
  const area = vertices.reduce((total, vertex, i) => {
    const next = vertices[(i + 1) % vertices.length]!;
    return total + vertex.x * next.y - next.x * vertex.y;
  }, 0);
  return Math.abs(area) > 1e-10;
}

/** Confidence is uncalibrated model self-report. Unknown confidence is retained as null. */
export function isValidRegionMetadata(input: unknown, box?: NormalizedBox): input is RegionMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const metadata = input as RegionMetadata;
  if (metadata.polygon !== undefined && !isValidPolygon(metadata.polygon, box)) return false;
  if (metadata.kind !== undefined && !['dialogue', 'narration', 'sfx', 'other'].includes(metadata.kind)) return false;
  if (metadata.direction !== undefined && !['horizontal', 'vertical', 'rotated'].includes(metadata.direction)) return false;
  for (const confidence of [metadata.ocrConfidence, metadata.positionConfidence]) {
    if (confidence !== undefined && confidence !== null && !(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1)) return false;
  }
  if (metadata.reviewRequired !== undefined && typeof metadata.reviewRequired !== 'boolean') return false;
  if (metadata.edited !== undefined && typeof metadata.edited !== 'boolean') return false;
  if (metadata.backgroundColor !== undefined && (typeof metadata.backgroundColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(metadata.backgroundColor))) return false;
  return metadata.backgroundVariance === undefined || (Number.isFinite(metadata.backgroundVariance) && metadata.backgroundVariance >= 0 && metadata.backgroundVariance <= 1);
}
export const validateRegionMetadata = isValidRegionMetadata;

export function isRegionPositionTrusted(region: RegionMetadata): boolean {
  return region.edited === true || region.positionConfidence === undefined || region.positionConfidence === null || region.positionConfidence >= 0.5;
}

/** Only render-relevant fields: equality must include edited geometry and appearance. */
export function regionRenderKey(region: TextRegion): string {
  return JSON.stringify([region.id, region.text, region.box, region.polygon, region.kind, region.direction, region.ocrConfidence,
    region.positionConfidence, region.reviewRequired, region.backgroundColor, region.backgroundVariance, region.edited]);
}

export function polygonClipPath(polygon: readonly NormalizedPoint[], box: NormalizedBox): string {
  if (!isValidPolygon(polygon, box) || box.width <= 0 || box.height <= 0) throw new RangeError('Invalid source polygon');
  const percent = (value: number): string => `${Math.max(0, Math.min(100, value)).toFixed(4)}%`;
  return `polygon(${polygon.map((vertex) => `${percent((vertex.x - box.x) / box.width * 100)} ${percent((vertex.y - box.y) / box.height * 100)}`).join(', ')})`;
}
