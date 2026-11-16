import { isNormalizedBox } from '../core/geometry';
import type { NormalizedBox, Rect } from '../core/types';
import { TranslationError } from './errors';

export interface BackgroundEstimate { readonly backgroundColor: string; readonly backgroundVariance: number }
/** Perimeter median is a fast fill estimate, never an inpainting engine. */
export function estimateBackground(pixels: ArrayLike<number>, width: number, height: number): BackgroundEstimate | null {
  if (!(width >= 3 && height >= 3) || pixels.length !== width * height * 4) return null;
  const colors: number[][] = [[], [], []], luminance: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x > 1 && x < width-2 && y > 1 && y < height-2) continue;
    const offset = (y * width + x) * 4;
    if (Number(pixels[offset+3]) < 200) continue;
    const r = Number(pixels[offset]), g = Number(pixels[offset+1]), b = Number(pixels[offset+2]);
    if (![r,g,b].every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) return null;
    colors[0]!.push(r); colors[1]!.push(g); colors[2]!.push(b); luminance.push((.2126*r+.7152*g+.0722*b)/255);
  }
  if (!luminance.length) return null;
  const median = colors.map((channel) => channel.sort((a,b) => a-b)[Math.floor(channel.length/2)]!);
  const mean = luminance.reduce((sum,value) => sum+value,0)/luminance.length;
  const variance = luminance.reduce((sum,value) => sum+(value-mean)**2,0)/luminance.length;
  return { backgroundColor: '#'+median.map((value) => Math.round(value).toString(16).padStart(2,'0')).join(''), backgroundVariance: variance };
}

export function sampleRegionBackground(context: CanvasRenderingContext2D, box: NormalizedBox): BackgroundEstimate | null {
  if (!isNormalizedBox(box)) return null;
  const sample = document.createElement('canvas'); sample.width = sample.height = 16;
  try {
    const target = sample.getContext('2d', { willReadFrequently: true });
    if (!target) return null;
    target.drawImage(context.canvas, box.x*context.canvas.width, box.y*context.canvas.height,
      box.width*context.canvas.width, box.height*context.canvas.height,0,0,16,16);
    return estimateBackground(target.getImageData(0,0,16,16).data,16,16);
  } catch { return null; }
  finally { sample.width = sample.height = 0; }
}

export interface RegionCropPlan { readonly pixels: Rect; readonly normalized: NormalizedBox; readonly outputWidth: number; readonly outputHeight: number }
/** Preserve the selected crop; upscale small lettering without exporting neighbouring page pixels. */
export function planRegionCrop(box: NormalizedBox, width: number, height: number): RegionCropPlan {
  if (!isNormalizedBox(box) || ![width,height].every((n) => Number.isInteger(n) && n > 0) || width*height > 40_000_000) throw new TranslationError('INVALID_COORDINATES');
  const x = Math.max(0,Math.floor(box.x*width)), y = Math.max(0,Math.floor(box.y*height));
  const right = Math.min(width,Math.ceil((box.x+box.width)*width)), bottom = Math.min(height,Math.ceil((box.y+box.height)*height));
  if (right-x < 2 || bottom-y < 2) throw new TranslationError('INVALID_COORDINATES');
  const factor = Math.min(3,1536/Math.max(right-x,bottom-y));
  return { pixels: {x,y,width:right-x,height:bottom-y}, normalized: {x:x/width,y:y/height,width:(right-x)/width,height:(bottom-y)/height},
    outputWidth: Math.max(1,Math.round((right-x)*factor)), outputHeight: Math.max(1,Math.round((bottom-y)*factor)) };
}
