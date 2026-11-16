import { TranslationError } from './errors';
import { objectValue } from './schema';
import { SOURCE_LANGUAGES, type TranslationSettings } from './types';

export const DEFAULT_SETTINGS: TranslationSettings = {
  model: '', sourceLanguage: 'auto', timeoutSeconds: 90, rememberKey: false,
};

export function modelId(input: string): string {
  const id = input.trim().replace(/^models\//, '');
  if (!/^gemini-[a-zA-Z0-9._-]{1,90}$/.test(id)) throw new TranslationError('MODEL');
  return id;
}

export function validateSettings(input: unknown): TranslationSettings {
  const value = objectValue(input);
  if (!value || typeof value['model'] !== 'string'
    || typeof value['sourceLanguage'] !== 'string' || !SOURCE_LANGUAGES.includes(value['sourceLanguage'] as TranslationSettings['sourceLanguage'])
    || typeof value['timeoutSeconds'] !== 'number' || !Number.isInteger(value['timeoutSeconds'])
    || value['timeoutSeconds'] < 15 || value['timeoutSeconds'] > 180
    || typeof value['rememberKey'] !== 'boolean') throw new TranslationError('CONFIG');
  return {
    model: value['model'] === '' ? '' : modelId(value['model']),
    sourceLanguage: value['sourceLanguage'] as TranslationSettings['sourceLanguage'],
    timeoutSeconds: value['timeoutSeconds'], rememberKey: value['rememberKey'],
  };
}

export function validateApiKey(key: unknown): string {
  if (typeof key !== 'string') throw new TranslationError('KEY_FORMAT');
  const value = key.trim();
  // Keys are opaque credentials. Authorization keys such as AQ.* contain dots;
  // avoid assuming a legacy prefix, alphabet or fixed length.
  if (value.length < 16 || value.length > 4096 || !/^[\x21-\x7e]+$/.test(value)
    || /^["'`]|["'`]$/.test(value)) throw new TranslationError('KEY_FORMAT');
  return value;
}
