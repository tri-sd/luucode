import { matchesBinding } from '../core/regions';
import { sameCaptureGeometry, type CaptureGeometry } from '../translation/capture';
import { TranslationError } from '../translation/errors';
import type { ImageSelection } from '../translation/types';
import { visibleFraction } from './dom-geometry';
import type { RegionTracker } from './region-tracker';

interface Session { selection: ImageSelection; geometry: CaptureGeometry; fingerprint: string | null; finished: boolean }
const token = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Exists only after an explicit capture request; it never receives screenshot bytes or a key. */
export class CaptureSession {
  private session: Session | undefined;
  private restoreTimer: number | undefined;
  private monitor: number | undefined;
  constructor(private readonly tracker: RegionTracker) {}

  async prepare(expected: ImageSelection): Promise<{ selection: ImageSelection; geometry: CaptureGeometry }> {
    this.reset();
    const current = this.tracker.currentImage();
    if (!current || current.documentToken !== expected.documentToken || !matchesBinding(current, expected)) throw new TranslationError('STALE_IMAGE');
    this.tracker.hideOverlay(true);
    this.restoreTimer = window.setTimeout(() => this.reset(), 5000);
    try {
      for (let i = 0; i < 2; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const geometry = this.measure(current);
      const selection = { ...current, captureTicket: token() };
      this.session = { selection, geometry, fingerprint: this.fingerprint(selection), finished: false };
      window.addEventListener('pointerdown', this.invalidateCanvas, true);
      window.addEventListener('keydown', this.invalidateCanvas, true);
      return { selection, geometry };
    } catch (error) { this.reset(); throw error; }
  }

  finish(ticket: string): boolean {
    const session = this.session;
    try {
      if (!session || session.selection.captureTicket !== ticket || !sameCaptureGeometry(session.geometry, this.measure(session.selection)) || !this.unchanged(session)) {
        this.reset(); return false;
      }
      session.finished = true;
      if (this.restoreTimer !== undefined) clearTimeout(this.restoreTimer);
      this.restoreTimer = undefined;
      // Readable canvases detect script-only redraws too; tainted ones use interaction invalidation.
      this.monitor = window.setInterval(() => { if (this.session && !this.unchanged(this.session)) this.invalidate(); }, 400);
      return true;
    } finally { this.tracker.hideOverlay(false); }
  }

  accepts(selection: ImageSelection): boolean {
    if (!selection.captureTicket) return true;
    const session = this.session;
    return Boolean(session?.finished && session.selection.captureTicket === selection.captureTicket
      && matchesBinding(session.selection, selection) && this.unchanged(session));
  }

  reset(): void {
    if (this.restoreTimer !== undefined) clearTimeout(this.restoreTimer);
    if (this.monitor !== undefined) clearInterval(this.monitor);
    this.restoreTimer = this.monitor = undefined;
    window.removeEventListener('pointerdown', this.invalidateCanvas, true);
    window.removeEventListener('keydown', this.invalidateCanvas, true);
    this.session = undefined;
    this.tracker.hideOverlay(false);
  }

  private invalidate(): void {
    if (this.session) this.tracker.applyRegions({ ...this.session.selection, regions: [] });
    this.reset();
  }
  private readonly invalidateCanvas = (): void => {
    if (this.session?.selection.method === 'canvas') this.invalidate();
  };

  private measure(selection: ImageSelection): CaptureGeometry {
    const geometry = this.tracker.geometry(selection), element = this.tracker.element(selection);
    if (!geometry || !element || visibleFraction({ element }, geometry) < 1) throw new TranslationError('STALE_IMAGE');
    const viewport = window.visualViewport;
    return { clip: geometry.clip, painted: geometry.painted, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      scale: viewport?.scale ?? 1, offsetLeft: viewport?.offsetLeft ?? 0, offsetTop: viewport?.offsetTop ?? 0 } };
  }
  private unchanged(session: Session): boolean {
    if (!this.tracker.element(session.selection)) return false;
    return session.fingerprint === null || this.fingerprint(session.selection) === session.fingerprint;
  }
  private fingerprint(selection: ImageSelection): string | null {
    const element = this.tracker.element(selection);
    if (!(element instanceof HTMLCanvasElement)) return null;
    const sample = document.createElement('canvas'); sample.width = sample.height = 32;
    try {
      const context = sample.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(element, 0, 0, 32, 32);
      return Array.from(context.getImageData(0, 0, 32, 32).data).join(',');
    } catch { return null; } // A tainted canvas is intentionally captured through the browser, not read back.
    finally { sample.width = sample.height = 0; }
  }
}
