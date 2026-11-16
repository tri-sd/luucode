export interface ImageEvidence {
  readonly source: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly renderedWidth: number;
  readonly renderedHeight: number;
  readonly description: string;
  readonly inNavigation: boolean;
}

/** Conservative, deterministic discovery. This is a heuristic, not comic classification. */
export function isComicImage(evidence: ImageEvidence): boolean {
  return eligibilityReason(evidence) === null;
}

/** Container names/roles alone never exclude an image. */
export function eligibilityReason(evidence: ImageEvidence): string | null {
  if (!evidence.source) return 'Chưa có nguồn ảnh (có thể đang lazy load).';
  const dimensions = [evidence.naturalWidth, evidence.naturalHeight, evidence.renderedWidth, evidence.renderedHeight];
  if (!dimensions.every((value) => Number.isFinite(value) && value > 0)) return 'Chưa tải ảnh hoặc phần tử không có kích thước.';
  if (evidence.naturalWidth < 280 || evidence.naturalHeight < 300
    || evidence.naturalWidth * evidence.naturalHeight < 150_000) return 'Ảnh nguồn quá nhỏ (tối thiểu 280×300 và 150.000 pixel).';
  if (evidence.renderedWidth < 160 || evidence.renderedHeight < 160) return 'Ảnh hiển thị quá nhỏ (tối thiểu 160×160 CSS px).';
  const ratio = evidence.naturalHeight / evidence.naturalWidth;
  if (ratio < 0.55 || ratio > 60) return 'Tỷ lệ ảnh ngoài khoảng 0,55–60.';
  return /(?:^|[\s/_-])(avatar|logo|icon|banner|advert|advertisement|thumbnail)(?:$|[\s/_.-])/i
    .test(evidence.description) ? 'Có dấu hiệu là ảnh trang trí/quảng cáo.' : null;
}
