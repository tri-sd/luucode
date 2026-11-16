import { contentFingerprint } from './identity';
import { downloadImage } from '../translation/image-pipeline';
import type { ImageObservation } from './types';

/** Verify byte identity once per DOM binding, with bounded transient Blob memory. Never calls Gemini. */
export class RestoreVerifier {
  private readonly verified = new Map<string, string>();
  private readonly flights = new Map<string, Promise<string>>();
  private readonly waiting: (() => void)[] = [];
  private active = 0;

  async hash(observation: ImageObservation): Promise<string> {
    const binding = JSON.stringify([observation.documentToken, observation.binding, observation.source]);
    const known = this.verified.get(binding);
    if (known) return known;
    let pending = this.flights.get(observation.source);
    if (!pending) {
      const task = this.read(observation.source);
      pending = task.finally(() => { if (this.flights.get(observation.source) === pending) this.flights.delete(observation.source); });
      this.flights.set(observation.source, pending);
    }
    const hash = await pending;
    this.verified.set(binding, hash);
    if (this.verified.size > 512) this.verified.delete(this.verified.keys().next().value!);
    return hash;
  }
  clear(): void { this.verified.clear(); }

  private async read(source: string): Promise<string> {
    if (this.active >= 2) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try { return await contentFingerprint(await downloadImage(source, new AbortController().signal, fetch)); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}
