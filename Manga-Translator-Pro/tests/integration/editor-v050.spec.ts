import {expect,test,type Page} from '@playwright/test';
import {frames,recordMetrics} from './helpers';

const first={id:'r1',sourceText:'SOURCE',translatedText:'Bản dịch ban đầu',bbox:[150,120,260,460],polygon:[{x:120,y:150},{x:460,y:150},{x:460,y:260},{x:120,y:260}],kind:'dialogue',direction:'horizontal',ocrConfidence:.92,positionConfidence:.95,reviewRequired:false};
const second={...first,id:'r2',sourceText:'OUTSIDE',translatedText:'Giữ nguyên vùng ngoài',bbox:[570,540,690,860],polygon:[{x:540,y:570},{x:860,y:570},{x:860,y:690},{x:540,y:690}]};
function envelope(regions:unknown[]){return{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({coordinateSystem:'normalized_1000',sourceLanguage:'en',regions})}]}}]};}
async function setup(page:Page,cropResponse?:Promise<void>){
 const requests:{prompt:string;base64:string}[]=[];
 await page.route('https://generativelanguage.googleapis.com/**',async(route)=>{
  const parts=route.request().postDataJSON().contents[0].parts;const prompt=parts[0].text as string;requests.push({prompt,base64:parts[1].inlineData.data as string});
  const crop=prompt.includes('Only the explicitly selected crop');
  const audit=prompt.includes('explicitly requested missing-text audit');
  if(crop&&cropResponse)await cropResponse;
  await route.fulfill({json:envelope(crop?[{...first,id:'crop1',translatedText:'Đọc lại crop thành công',bbox:[100,100,900,900],polygon:[{x:100,y:100},{x:900,y:100},{x:900,y:900},{x:100,y:900}]}]:audit?[{...first,id:'missed',kind:'sfx',sourceText:'BOOM',translatedText:'Rầm',bbox:[750,50,850,250],polygon:[{x:50,y:750},{x:250,y:750},{x:250,y:850},{x:50,y:850}]}]:[first,second])});
 });
 await page.goto('/chapter-pipeline.html');await page.locator('#page-a').evaluate(async(image:HTMLImageElement)=>image.decode());
 await page.addScriptTag({path:'work/chapter-pipeline-harness.js'});return requests;
}
async function translated(page:Page){await page.evaluate(()=>window.chapterPipeline.collect(2));await page.evaluate(()=>window.chapterPipeline.quickTranslate());const view=await page.evaluate(()=>window.chapterPipeline.wait());expect(view.progress.completed).toBe(2);await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region').first()).toContainText('Bản dịch ban đầu');}
const editor='[data-mtp-ui="region-editor"]';

test('manual text/bbox/polygon edits persist through reload, reset keeps raw OCR, and synthetic saves make no requests',async({page},info)=>{
 const requests=await setup(page);await translated(page);expect(requests).toHaveLength(2);
 await page.evaluate(()=>window.chapterPipeline.edit());await expect(page.locator(editor)).toHaveCount(1);
 await expect(page.locator(`${editor} .hint`).first()).toContainText('OCR: 92%');
 await page.locator(editor).evaluate((host)=>{for(const action of['save','reprocess','reset'])host.shadowRoot!.querySelector<HTMLButtonElement>(`[data-editor-action="${action}"]`)!.click();});
 expect(requests).toHaveLength(2);
 await page.locator(`${editor} textarea`).nth(1).fill('Bản dịch do người dùng sửa');
 await page.locator(`${editor} [data-coordinate="x"]`).fill('18');
 await page.locator(`${editor} [data-editor-action="save"]`).click();
 await expect(page.locator(`${editor} .status`)).toHaveText('Đã lưu bản sửa vào cache.');
 await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region').first()).toContainText('Bản dịch do người dùng sửa');
 const before=await page.evaluate(()=>window.chapterPipeline.readSnapshot());expect(before.original.regions[0]!.text).toBe('Bản dịch ban đầu');expect(before.output.regions[0]!.box.x).toBe(.18);expect(before.output.regions[0]!.polygon![0]!.x).toBeCloseTo(.18);
 await page.reload();await page.locator('#page-a').evaluate(async(image:HTMLImageElement)=>image.decode());await page.addScriptTag({path:'work/chapter-pipeline-harness.js'});
 await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region').first()).toContainText('Bản dịch do người dùng sửa');expect(requests).toHaveLength(2);
 await page.evaluate(()=>window.chapterPipeline.edit());await page.locator(`${editor} [data-editor-action="reset"]`).click();await expect(page.locator(`${editor} .status`)).toHaveText('Đã khôi phục bản AI gốc.');
 await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region').first()).toContainText('Bản dịch ban đầu');expect(requests).toHaveLength(2);
 await page.setViewportSize({width:390,height:700});await frames(page);
 expect((await page.locator(editor).boundingBox())!.width).toBeLessThanOrEqual(390);
 await page.screenshot({path:info.outputPath('editor-after.png')});await info.attach('manual-editor',{path:info.outputPath('editor-after.png'),contentType:'image/png'});
});

test('crop retry sends only an upscaled crop, preserves regions outside it, and reuses crop cache',async({page},info)=>{
 const requests=await setup(page);await translated(page);
 await page.evaluate(()=>window.chapterPipeline.edit());await page.locator(`${editor} [data-editor-action="reprocess"]`).click();
 await expect(page.locator(`${editor} .status`)).toContainText('Đọc lại được 1 vùng');
 expect(requests).toHaveLength(3);
 const dimensions=await page.evaluate(async(base64)=>{const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();return{width:image.naturalWidth,height:image.naturalHeight};},requests[2]!.base64);
 expect(dimensions.width*dimensions.height).toBeLessThan(400*640);
 const cropResult=await page.evaluate(()=>window.chapterPipeline.retryCrop({x:.12,y:.15,width:.34,height:.11}));
 expect(requests).toHaveLength(3);
 await page.locator(`${editor} [data-editor-action="save"]`).click();await expect(page.locator(`${editor} .status`)).toHaveText('Đã lưu bản sửa vào cache.');
 const snapshot=await page.evaluate(()=>window.chapterPipeline.readSnapshot());
 expect(snapshot.output.regions.some((region)=>region.text==='Giữ nguyên vùng ngoài')).toBe(true);expect(snapshot.output.regions.some((region)=>region.text==='Đọc lại crop thành công')).toBe(true);
 expect(snapshot.original.regions[0]!.text).toBe('Bản dịch ban đầu');
 const savedCrop=snapshot.output.regions.find((region)=>region.text==='Đọc lại crop thành công')!;
 expect(savedCrop.box).toEqual(cropResult.regions[0]!.box);
 expect(savedCrop.polygon).toEqual(cropResult.regions[0]!.polygon);
 await page.evaluate(()=>window.chapterPipeline.retryCrop({x:.12,y:.15,width:.34,height:.11}));expect(requests).toHaveLength(3);
 await recordMetrics(info,{mode:'mock Gemini crop retry',submittedCropPng:dimensions,sourceImage:[400,640],extraProviderRequests:1,unchangedOutsideRegions:1});
});

test('explicit review mode adds missed text with a second bounded request; collection never invokes Gemini',async({page})=>{
 const requests=await setup(page);await page.evaluate(()=>window.chapterPipeline.collect(2));expect(requests).toHaveLength(0);
 await page.evaluate(()=>window.chapterPipeline.command('options',{qualityMode:'review'}));await page.evaluate(()=>window.chapterPipeline.quickTranslate());
 const view=await page.evaluate(()=>window.chapterPipeline.wait());expect(view.progress.completed).toBe(2);expect(requests).toHaveLength(4);
 const snapshot=await page.evaluate(()=>window.chapterPipeline.readSnapshot());expect(snapshot.output.regions).toHaveLength(3);expect(snapshot.output.regions.some((region)=>region.kind==='sfx'&&region.text==='Rầm')).toBe(true);
});

test('a recycled source closes its editor and cannot apply the previous image edit',async({page})=>{
 await setup(page);await translated(page);await page.evaluate(()=>window.chapterPipeline.edit());await expect(page.locator(editor)).toHaveCount(1);
 await page.locator('#page-a').evaluate((image:HTMLImageElement)=>{image.src='/panel.svg?id=NEWPAGE&width=400&height=640';});
 await expect(page.locator(editor)).toHaveCount(0);await expect(page.locator('[data-mtp-root] [data-source-element="page-a"]')).toHaveCount(0);
});

test('50 v0.4 cache entries remain readable without model calls or a destructive IndexedDB migration',async({page})=>{
 const requests=await setup(page);const seeded=await page.evaluate(()=>window.chapterPipeline.seedLegacy(50));expect(seeded.progress.completed).toBe(50);expect(requests).toHaveLength(0);
 await page.reload();await page.locator('#page-a').evaluate(async(image:HTMLImageElement)=>image.decode());await page.addScriptTag({path:'work/chapter-pipeline-harness.js'});
 await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region')).toHaveText('Bản cache 0.4');
 await page.evaluate(()=>window.chapterPipeline.quickTranslate());const restored=await page.evaluate(()=>window.chapterPipeline.wait());
 expect(restored.progress.completed).toBe(50);expect(restored.session.profile?.ocrVersion).toBe('gemini-vision-v1');expect(requests).toHaveLength(0);
});

test('switching regions stages valid edits and hiding an added region remains saveable',async({page})=>{
 const requests=await setup(page);await translated(page);await page.evaluate(()=>window.chapterPipeline.edit());
 await page.locator(`${editor} textarea`).nth(1).fill('Giữ nội dung khi đổi vùng');
 await page.locator(`${editor} select`).selectOption('tile-0-r2');
 await page.locator(`${editor} [data-editor-action="save"]`).click();await expect(page.locator(`${editor} .status`)).toHaveText('Đã lưu bản sửa vào cache.');
 expect((await page.evaluate(()=>window.chapterPipeline.readSnapshot())).output.regions[0]!.text).toBe('Giữ nội dung khi đổi vùng');
 await page.locator(`${editor} [data-editor-action="add"]`).click();
 await page.locator(`${editor} input[type="checkbox"]`).check();
 await page.locator(`${editor} [data-editor-action="preview"]`).click();
 await page.locator(`${editor} [data-editor-action="save"]`).click();await expect(page.locator(`${editor} .status`)).toHaveText('Đã lưu bản sửa vào cache.');
 expect((await page.evaluate(()=>window.chapterPipeline.readSnapshot())).edits.added).toEqual([]);expect(requests).toHaveLength(2);
});

test('closing a pending crop stays responsive and a late response cannot apply its preview',async({page})=>{
 let release!:()=>void;const waiting=new Promise<void>((resolve)=>{release=resolve;});
 const requests=await setup(page,waiting);await translated(page);await page.evaluate(()=>window.chapterPipeline.edit());
 await page.locator(`${editor} [data-editor-action="reprocess"]`).click();
 await expect.poll(()=>requests.length).toBe(3);
 try{
  await expect(page.locator(`${editor} [data-editor-action="close"]`)).toBeEnabled();
  await page.locator(`${editor} [data-editor-action="close"]`).click();await expect(page.locator(editor)).toHaveCount(0);
 }finally{release();}
 await frames(page,12);
 await expect(page.locator('[data-mtp-root] [data-source-element="page-a"] .region').first()).toContainText('Bản dịch ban đầu');
 expect((await page.evaluate(()=>window.chapterPipeline.readSnapshot())).edits.added).toEqual([]);
});
