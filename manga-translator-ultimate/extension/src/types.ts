export type Font = 'regular' | 'bold' | 'italic';
export type Box = [number, number, number, number];
export type Settings = {
  language: 'auto' | 'en' | 'ja';
  quality: 'balanced' | 'quality' | 'low';
  model: string;
  device: 'auto' | 'cpu';
  font: Font;
  font_scale: number;
  sfx: boolean;
};
export const defaults: Settings = {
  language: 'auto', quality: 'balanced', model: 'qwen3:4b-instruct-2507-q4_K_M',
  device: 'auto', font: 'regular', font_scale: 1, sfx: false,
};
export type Health = {
  engine: boolean; ollama: boolean; manga_ocr: boolean; models: string[];
  gpu: { name: string; used: number; total: number } | null;
  loaded: { name: string; vram: number }[];
};
export type Region = {
  id: string; box: Box; bubble: Box | null; placement: Box | null;
  source: string; text: string; issue: string; font: Font | null; font_scale: number | null;
};
export type Summary = {
  key: string; image: string | null; width: number; height: number; rendered: number;
  fingerprint: string; regions: Region[]; edits: string[];
};
export type Status = {
  batch: 'idle' | 'collecting' | 'running' | 'complete'; collected: number;
  found: number; done: number; processing: number; waiting: number; errors: number;
  regions: number; engine: string; phase: string; active: boolean; paused: boolean; auto: boolean;
  showing: boolean; recent: string[]; hosts: string[];
};
export type Command = 'status' | 'collect' | 'batch' | 'chapter' | 'current' | 'pause' | 'resume' | 'auto' | 'show' | 'retry' | 'edit' | 'refresh';
export type ApiAction = 'health' | 'submit' | 'job' | 'cancel' | 'result' | 'original' | 'edit' | 'glossary' | 'saveGlossary' | 'clear';
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
export const imageLimit = 22_020_096;
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
