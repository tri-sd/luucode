import type { TranslationErrorCode } from './errors';
import { objectValue } from './schema';

/** Inspect only known error markers; never expose the provider's message or body. */
export function classifyHttpError(status: number, payload?: unknown): TranslationErrorCode {
  const error = objectValue(objectValue(payload)?.['error']);
  const message = typeof error?.['message'] === 'string' ? error['message'].toLowerCase() : '';
  const details = Array.isArray(error?.['details']) ? error['details'] : [];
  const reasons = details.map((item: unknown) => objectValue(item)?.['reason']).filter((value): value is string => typeof value === 'string');
  if (reasons.some((reason) => ['API_KEY_BLOCKED', 'API_KEY_REVOKED', 'CONSUMER_SUSPENDED'].includes(reason))
    || message.includes('reported as leaked') || message.includes('key has been revoked')) return 'KEY_BLOCKED';
  if (reasons.includes('SERVICE_DISABLED')) return 'API_DISABLED';
  if (status === 401 || reasons.some((reason) => ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'ACCESS_TOKEN_TYPE_UNSUPPORTED'].includes(reason))
    || message.includes('api key not valid') || message.includes('api key expired')) return 'AUTH';
  if (status === 402 || status === 429 || reasons.some((reason) => ['BILLING_DISABLED', 'BILLING_NOT_ACTIVE'].includes(reason))) return 'QUOTA';
  if (status === 403 || error?.['status'] === 'PERMISSION_DENIED') return 'PERMISSION';
  if (status === 400 || status === 404) return 'MODEL';
  return 'NETWORK';
}
