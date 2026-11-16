import { validateSelection } from '../extension/security';
import { TranslationError } from '../translation/errors';
import { objectValue } from '../translation/schema';
import type { ChapterService } from './chapter-service';
import type { ImageObservation } from './types';

export interface ChapterRpcContext { readonly url: string; readonly documentToken: string }
export function parseObservations(input: unknown, documentToken: string, limit = 50): ImageObservation[] {
  if (!Array.isArray(input) || input.length > limit) throw new TranslationError('NO_IMAGE');
  return input.map((item: unknown): ImageObservation => {
    const value = objectValue(item), binding = objectValue(value?.['binding']);
    if (!value || !binding || value['documentToken'] !== documentToken || value['sourceKey'] !== binding['sourceKey']) throw new TranslationError('STALE_IMAGE');
    const selected = validateSelection({ ...binding, documentToken, source: value['source'], naturalWidth: value['naturalWidth'], naturalHeight: value['naturalHeight'], method: value['method'] });
    if (!selected.method || !Number.isInteger(selected.naturalWidth) || !Number.isInteger(selected.naturalHeight)) throw new TranslationError('NO_IMAGE');
    const page = value['pageOrdinal'], fingerprint = value['fingerprint'];
    return { source: selected.source, sourceKey: selected.sourceKey, naturalWidth: selected.naturalWidth, naturalHeight: selected.naturalHeight,
      method: selected.method, documentToken, binding: { instanceId: selected.instanceId, generation: selected.generation, sourceKey: selected.sourceKey },
      ...(typeof page === 'number' && Number.isSafeInteger(page) && page >= 0 && page <= 1_000_000 ? { pageOrdinal: page } : {}),
      ...(typeof fingerprint === 'string' && /^(?:sample32-)?[a-f0-9]{64}$/.test(fingerprint) ? { fingerprint } : {}),
    };
  });
}

/** Context is supplied by the background's authenticated top-frame lookup, never by page input. */
export async function dispatchChapterRpc(service: ChapterService, context: ChapterRpcContext, message: Record<string, unknown>): Promise<unknown> {
  switch (message['type']) {
    case 'chapter:attach': case 'chapter:status': return service.attach(context.url, context.documentToken);
    case 'chapter:observe': return service.observe(context.url, context.documentToken, parseObservations(message['observations'], context.documentToken), message['endObserved'] === true);
    case 'chapter:restore': return service.restore(context.url, context.documentToken, parseObservations(message['observations'], context.documentToken, 12));
    case 'chapter:regions': {
      const [observation] = parseObservations([message['observation']], context.documentToken, 1);
      return service.regionSnapshot(context.url, context.documentToken, observation!);
    }
    case 'chapter:save-regions': case 'chapter:reset-regions': {
      const [observation] = parseObservations([message['observation']], context.documentToken, 1);
      if (typeof message['cacheKey'] !== 'string' || typeof message['expectedRevision'] !== 'string') throw new TranslationError('STALE_IMAGE');
      return message['type'] === 'chapter:save-regions'
        ? service.saveRegionEdits(context.url, context.documentToken, observation!, message['cacheKey'], message['expectedRevision'], message['edits'])
        : service.resetRegionEdits(context.url, context.documentToken, observation!, message['cacheKey'], message['expectedRevision']);
    }
    case 'chapter:command':
      if (typeof message['command'] !== 'string') throw new TranslationError('CONFIG');
      return service.command(context.url, context.documentToken, message['command'], message['value']);
    default: throw new TranslationError('CONFIG');
  }
}
