import { DEFAULT_SETTINGS, validateApiKey, validateSettings } from '../translation/settings';
import { TranslationError } from '../translation/errors';
import type { PublicSettings, TranslationSettings } from '../translation/types';

export interface PrivateStorageArea {
  setAccessLevel(input: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

const SETTINGS = 'mtp.settings';
const KEY = 'mtp.private.apiKey';

export class CredentialStore {
  private ready: Promise<void> | undefined;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly local: PrivateStorageArea, private readonly session: PrivateStorageArea) {}

  private initialize(): Promise<void> {
    this.ready ??= Promise.all([
      this.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
      this.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    ]).then(() => undefined);
    return this.ready;
  }

  protect(): Promise<void> { return this.initialize(); }

  async privateConfig(): Promise<{ settings: TranslationSettings; apiKey: string }> {
    await this.initialize();
    await this.writes;
    const [local, session] = await Promise.all([this.local.get([SETTINGS, KEY]), this.session.get([KEY])]);
    let settings = DEFAULT_SETTINGS;
    if (local[SETTINGS]) {
      try { settings = validateSettings(local[SETTINGS]); } catch { /* Invalid old config is reset in memory. */ }
    }
    const raw = settings.rememberKey ? local[KEY] : session[KEY];
    const apiKey = typeof raw === 'string' ? raw : '';
    return { settings, apiKey };
  }

  async publicConfig(): Promise<PublicSettings> {
    const { settings, apiKey } = await this.privateConfig();
    return { ...settings, hasKey: Boolean(apiKey) };
  }

  save(input: unknown, replacementKey: unknown): Promise<PublicSettings> {
    const operation = this.writes.then(async () => {
      await this.initialize();
      const settings = validateSettings(input);
      const [local, session] = await Promise.all([this.local.get([SETTINGS, KEY]), this.session.get([KEY])]);
      const previousSettings = local[SETTINGS] as TranslationSettings | undefined;
      const previous = previousSettings?.rememberKey ? local[KEY] : session[KEY];
      const apiKey = replacementKey === '' || replacementKey === undefined ? previous : validateApiKey(replacementKey);
      if (typeof apiKey !== 'string' || !apiKey) throw new TranslationError('KEY_FORMAT');
      if (settings.rememberKey) {
        await this.local.set({ [SETTINGS]: settings, [KEY]: apiKey });
        await this.session.remove([KEY]);
      } else {
        await this.session.set({ [KEY]: apiKey });
        await this.local.set({ [SETTINGS]: settings });
        await this.local.remove([KEY]);
      }
      return { ...settings, hasKey: true };
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  clearKey(): Promise<void> {
    const operation = this.writes.then(async () => {
      await this.initialize();
      await Promise.all([this.local.remove([KEY]), this.session.remove([KEY])]);
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }
}
