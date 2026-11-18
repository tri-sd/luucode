import { capture, dimensions, imageSource, type MangaImage } from './detector';
import { errorText, type Summary } from './types';

export type PageResult = Omit<Summary, 'image' | 'regions'> & {
  issues: number; context: string; note?: string;
};
export type CollectedPage = {
  source: string;
  element: WeakRef<MangaImage>;
  state: 'capturing' | 'waiting' | 'done' | 'error';
  snapshot?: string;
  snapshotPending?: boolean;
  result?: PageResult;
  note?: string;
};

const snapshotBudget = 96 * 1024 * 1024;

export class ChapterCollection {
  readonly widths: number[] = [];
  readonly pages = new Map<string, CollectedPage>();
  private canvasIds = new WeakMap<MangaImage, string>();
  private nextCanvas = 0;
  private controller = new AbortController();
  private bytes = 0;
  private capturing = 0;

  private key(element: MangaImage, source: string) {
    if (!(element instanceof HTMLCanvasElement)) return source;
    let id = this.canvasIds.get(element);
    if (!id) {
      id = 'canvas-page:' + this.nextCanvas++;
      this.canvasIds.set(element, id);
    }
    return id;
  }

  lookup(element: MangaImage, source: string) {
    return this.pages.get(this.key(element, source));
  }

  remember(element: MangaImage, source: string, changed: () => void) {
    if (!source) return;
    const [width] = dimensions(element);
    if (width && !this.widths.includes(width)) this.widths.push(width);
    const id = this.key(element, source);
    const found = this.pages.get(id);
    if (found) {
      found.element = new WeakRef(element);
      return;
    }
    const ephemeral = element instanceof HTMLCanvasElement || source.startsWith('blob:');
    const page: CollectedPage = {
      source, element: new WeakRef(element),
      state: ephemeral ? 'capturing' : 'waiting',
    };
    this.pages.set(id, page);
    if (ephemeral) this.pump(changed);
  }

  private pump(changed: () => void) {
    while (this.capturing < 2) {
      const page = [...this.pages.values()].find(item => item.state === 'capturing' && !item.snapshotPending);
      if (!page) return;
      const element = page.element.deref();
      const original = element && imageSource(element) === page.source ? element : null;
      this.capturing += 1;
      page.snapshotPending = true;
      const signal = this.controller.signal;
      void capture(original, page.source, signal).then(snapshot => {
        if (signal.aborted) return;
        if (this.bytes + snapshot.length > snapshotBudget) {
          throw new Error('Đã chạm giới hạn bộ nhớ cho ảnh tạm. Hãy chia chương thành các lượt nhỏ.');
        }
        this.bytes += snapshot.length;
        page.snapshot = snapshot;
        page.state = 'waiting';
      }).catch(error => {
        if (signal.aborted) return;
        page.state = 'error';
        page.note = errorText(error);
      }).finally(() => {
        if (signal.aborted) return;
        page.snapshotPending = false;
        this.capturing -= 1;
        this.pump(changed);
        changed();
      });
    }
  }

  clear() {
    this.controller.abort();
    this.controller = new AbortController();
    this.bytes = 0;
    this.capturing = 0;
    this.pages.clear();
    this.widths.length = 0;
  }
}
