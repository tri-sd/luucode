import type { TrackingStatus } from '../tracking/region-tracker';

export type TrackingCommand = 'start' | 'stop' | 'toggle' | 'status';
export interface TrackingMessage { readonly type: 'mtp:tracking'; readonly command: TrackingCommand }
export interface TrackingReply { readonly ok: true; readonly status: TrackingStatus }

export function isTrackingMessage(value: unknown): value is TrackingMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate['type'] === 'mtp:tracking' && typeof candidate['command'] === 'string'
    && ['start', 'stop', 'toggle', 'status'].includes(candidate['command']);
}
