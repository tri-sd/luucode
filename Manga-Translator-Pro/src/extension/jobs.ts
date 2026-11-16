import { TranslationError } from '../translation/errors';
import type { PublicJob } from '../translation/types';

export interface JobStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const KEY = 'mtp.public.jobs';
export const isRunning = (job: PublicJob): boolean => ['preparing', 'translating', 'applying'].includes(job.phase);

export class JobStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: JobStorage) {}

  async all(): Promise<readonly PublicJob[]> {
    await this.writes;
    const stored = (await this.storage.get([KEY]))[KEY];
    return Array.isArray(stored) ? stored as PublicJob[] : [];
  }

  async forTab(tabId: number): Promise<PublicJob | null> {
    return (await this.all()).find((job) => job.tabId === tabId) ?? null;
  }

  update(job: PublicJob): Promise<void> {
    const operation = this.writes.then(async () => {
      if (JSON.stringify(job).length > 1_100_000) throw new TranslationError('INVALID_JSON');
      const stored = (await this.storage.get([KEY]))[KEY];
      const all = Array.isArray(stored) ? stored as PublicJob[] : [];
      const next = [job, ...all.filter((old) => old.tabId !== job.tabId && old.id !== job.id)].slice(0, 3);
      await this.storage.set({ [KEY]: next });
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  transition(job: PublicJob): Promise<boolean> {
    const operation = this.writes.then(async () => {
      if (JSON.stringify(job).length > 1_100_000) throw new TranslationError('INVALID_JSON');
      const stored = (await this.storage.get([KEY]))[KEY];
      const all = Array.isArray(stored) ? stored as PublicJob[] : [];
      const previous = all.find((item) => item.id === job.id && item.tabId === job.tabId);
      if (!previous || !isRunning(previous)) return false;
      await this.storage.set({ [KEY]: all.map((item) => item.id === job.id ? job : item) });
      return true;
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }
}
