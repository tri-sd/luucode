import { describe,expect,it } from 'vitest';
import { parseVisionJson } from '../../src/translation/schema';
import { mapTileRegions } from '../../src/translation/tiles';
import { mapCapturePoint } from '../../src/translation/capture';
import { estimateBackground,planRegionCrop } from '../../src/translation/preprocessing';
import { mergeVisionAudit } from '../../src/translation/vision-adapter';
import { createTranslationProfile,resolveChapterProfile,stableDigest } from '../../src/chapter/identity';
import type { VisionOutput } from '../../src/translation/types';

function sample(){return{coordinateSystem:'normalized_1000',sourceLanguage:'ja',regions:[{id:'r1',sourceText:'行こう！',translatedText:'Đi thôi!',bbox:[100,200,300,500],polygon:[{x:200,y:100},{x:500,y:100},{x:500,y:300},{x:200,y:300}],kind:'dialogue',direction:'vertical',ocrConfidence:.8,positionConfidence:.9,reviewRequired:false}]};}
describe('detailed Vision contract and source projection',()=>{
 it('keeps detected polygon, kind, direction and independent confidence through tile and crop mapping',()=>{
  const output=parseVisionJson(JSON.stringify(sample()));
  expect(output.regions[0]).toMatchObject({kind:'dialogue',direction:'vertical',ocrConfidence:.8,positionConfidence:.9,polygon:[{x:.2,y:.1},{x:.5,y:.1},{x:.5,y:.3},{x:.2,y:.3}]});
  const mapped=mapTileRegions(output,{index:1,x:100,y:500,width:500,height:1000,sourceWidth:1000,sourceHeight:2000})[0]!;
  expect(mapped.polygon![0]).toEqual({x:.2,y:.3});
  expect(mapped.box.x).toBe(.2);expect(mapped.positionConfidence).toBe(.9);
  expect(mapCapturePoint(mapped.polygon![0]!,{x:.1,y:.2,width:.5,height:.5})).toEqual({x:.2,y:.35});
 });
 it('retains unknown scores as null and does not fabricate polygon precision',()=>{
  const raw=sample();Object.assign(raw.regions[0]!,{polygon:null,ocrConfidence:null,positionConfidence:null,reviewRequired:true});
  const region=parseVisionJson(JSON.stringify(raw)).regions[0]!;
  expect(region.polygon).toBeUndefined();expect(region.ocrConfidence).toBeNull();expect(region.positionConfidence).toBeNull();
 });
 it.each([{ocrConfidence:1.2},{positionConfidence:'certain'},{polygon:[{x:200,y:100},{x:500,y:300},{x:200,y:300},{x:500,y:100}]},{polygon:[{x:0,y:0},{x:900,y:0},{x:900,y:900}]},{kind:'invented'}])('rejects invalid provider geometry/metadata %j',(change)=>{
  const raw=sample();Object.assign(raw.regions[0]!,change);expect(()=>parseVisionJson(JSON.stringify(raw))).toThrow();
 });
 it('adds only missed audit regions while retaining separate speakers and rejecting duplicates',()=>{
  const first=parseVisionJson(JSON.stringify(sample()));
  const audit:VisionOutput={sourceLanguage:'ja',regions:[{...first.regions[0]!,id:'duplicate'},{...first.regions[0]!,id:'sfx',sourceText:'ドン',translatedText:'Rầm',kind:'sfx',box:{x:.6,y:.7,width:.1,height:.1},polygon:[{x:.6,y:.7},{x:.7,y:.7},{x:.7,y:.8},{x:.6,y:.8}]}]};
  const merged=mergeVisionAudit(first,audit);expect(merged.regions).toHaveLength(2);expect(merged.regions[0]).toEqual(first.regions[0]);expect(merged.regions[1]!.id).toBe('audit-sfx');
 });
});
describe('crop preprocessing and fast fill',()=>{
 it('upscales a small source crop and maps exact sampled pixels back to the full image',()=>{
  const plan=planRegionCrop({x:.12,y:.15,width:.34,height:.11},1000,1600);
  expect(plan.pixels).toEqual({x:120,y:240,width:340,height:176});
  expect(plan.outputWidth).toBe(1020);expect(plan.outputHeight).toBe(528);expect(plan.normalized.x).toBe(.12);
 });
 it('bounds huge/tiny/out-of-image crops instead of capturing arbitrary pixels',()=>{
  expect(()=>planRegionCrop({x:1,y:0,width:.2,height:.1},1000,1600)).toThrow();
  expect(()=>planRegionCrop({x:0,y:0,width:.0001,height:.0001},1000,1600)).toThrow();
  expect(()=>planRegionCrop({x:0,y:0,width:1,height:1},10000,10000)).toThrow();
 });
 it('estimates a light or dark perimeter without using the text interior as an inpainting result',()=>{
  const pixels=new Uint8ClampedArray(16*16*4).fill(255);
  for(let y=4;y<12;y++)for(let x=4;x<12;x++){const i=(y*16+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0;}
  expect(estimateBackground(pixels,16,16)).toEqual({backgroundColor:'#ffffff',backgroundVariance:0});
  pixels.fill(0);for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
  expect(estimateBackground(pixels,16,16)).toEqual({backgroundColor:'#000000',backgroundVariance:0});
 });
 it('does not reuse a legacy cache for a different model/glossary or explicit review mode',()=>{
  const settings={model:'gemini-test',sourceLanguage:'ja' as const};
  const previous={...createTranslationProfile(settings,'Name = Tên'),ocrVersion:'gemini-vision-v1',promptVersion:'chapter-vision-v1',glossaryVersion:stableDigest('Name = Tên'),key:'legacy-profile'};
  expect(resolveChapterProfile(settings,'Name = Tên','standard',previous)).toBe(previous);
  expect(resolveChapterProfile(settings,'Name = Tên','review',previous).key).not.toBe(previous.key);
  expect(resolveChapterProfile({...settings,model:'gemini-other'},'Name = Tên','standard',previous).key).not.toBe(previous.key);
  expect(resolveChapterProfile(settings,'Name = Khác','standard',previous).key).not.toBe(previous.key);
 });
});
