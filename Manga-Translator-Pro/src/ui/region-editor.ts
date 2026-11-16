import { isNormalizedBox } from '../core/geometry';
import type { NormalizedBox, NormalizedPoint } from '../core/types';
import { applyRegionEdits, validateRegionEdits, type RegionEditsInput } from '../chapter/region-edits';
import type { EditableRegionSnapshot } from '../chapter/chapter-service';
import type { RegionOverride, UserRegionEdits } from '../chapter/types';
import type { TranslatedRegion, TranslationOutput } from '../translation/types';

export interface RegionEditorOptions {
  readonly onPreview: (edits: RegionEditsInput) => void;
  readonly onSave: (edits: RegionEditsInput, snapshot: EditableRegionSnapshot) => Promise<EditableRegionSnapshot>;
  readonly onReset: (snapshot: EditableRegionSnapshot) => Promise<EditableRegionSnapshot>;
  readonly onReprocess: (crop: NormalizedBox, snapshot: EditableRegionSnapshot) => Promise<TranslationOutput>;
  readonly onClose: () => void;
}
const css = `
:host{all:initial}*{box-sizing:border-box}section{width:min(350px,calc(100vw - 24px));max-height:calc(100vh - 32px);overflow:auto;padding:16px;background:#f5f8fa;color:#193847;border:1px solid #92b4b5;border-radius:12px;box-shadow:0 8px 32px #0004;font:13px/1.45 Arial,"Segoe UI",sans-serif}
h2{font-size:16px;margin:0 0 10px}label{display:block;font-weight:600;margin:8px 0 4px}input,select,textarea,button{font:inherit}input,select,textarea{width:100%;padding:7px;border:1px solid #a5bdc7;border-radius:5px;background:white;color:#193847}textarea{min-height:72px;resize:vertical}.box{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.actions{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}button{padding:7px 9px;border:1px solid #a5bdc7;border-radius:6px;background:#fff;color:#193847;cursor:pointer}button.primary{background:#14664f;color:#fff;border-color:#14664f}button:disabled{opacity:.5;cursor:default}.hint{font-size:11px;color:#4e6876;overflow-wrap:anywhere}.status{white-space:pre-wrap;font-size:12px}.status[data-error=true]{color:#a12836}.check{display:flex;gap:7px;align-items:center}.check input{width:auto}.close{float:right;padding:3px 7px}.original{min-height:45px;background:#edf2f5}details summary{cursor:pointer;margin:9px 0;font-size:12px}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #dba94e;outline-offset:2px}
`;
const copyEdits = (snapshot: EditableRegionSnapshot): RegionEditsInput => structuredClone({ overrides: snapshot.edits.overrides, added: snapshot.edits.added });
function rectangleIntersection(a: NormalizedBox,b: NormalizedBox): number { return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)); }

/** Public text/geometry only; all requests originate from trusted user click handlers. */
export class RegionEditor {
  readonly host = document.createElement('div');
  private readonly abort = new AbortController();
  private readonly panel = document.createElement('section');
  private readonly selection = document.createElement('select');
  private readonly source = document.createElement('textarea');
  private readonly text = document.createElement('textarea');
  private readonly coords = ['x','y','width','height'].map(() => document.createElement('input'));
  private readonly polygon = document.createElement('textarea');
  private readonly hidden = document.createElement('input');
  private readonly confidence = document.createElement('p');
  private readonly status = document.createElement('p');
  private readonly buttons: HTMLButtonElement[] = [];
  private snapshot: EditableRegionSnapshot | undefined;
  private edits: RegionEditsInput = { overrides: {}, added: [] };
  private selectedId = '';
  private displayedPolygon = '';
  private displayedBox: NormalizedBox | undefined;
  private displayedCoordinates: readonly string[] = [];
  private displayedPoints: readonly NormalizedPoint[] | undefined;
  private busy = false;
  private destroyed = false;

  constructor(private readonly options: RegionEditorOptions) {
    this.host.dataset['mtpUi'] = 'region-editor';
    for (const [key,value] of Object.entries({ all:'initial',position:'fixed',top:'16px',right:'16px','z-index':'2147483647',display:'block','pointer-events':'auto' })) this.host.style.setProperty(key,value,'important');
    const shadow = this.host.attachShadow({mode:'open'}), style = document.createElement('style'); style.textContent = css;
    const close = this.button('Đóng ×','close',()=>options.onClose()); close.className='close';
    const heading = document.createElement('h2'); heading.textContent='Sửa chữ và vùng';
    this.panel.append(close,heading);
    this.field('Vùng chữ',this.selection);
    this.selection.addEventListener('change',(event)=>{if(event.isTrusted)this.selectRegion(this.selection.value);},{signal:this.abort.signal});
    this.source.readOnly=true;this.source.className='original';this.field('Văn bản OCR gốc',this.source);
    this.field('Bản dịch tiếng Việt',this.text);
    const box=document.createElement('div');box.className='box';
    for(let i=0;i<4;i++){const label=document.createElement('label');label.textContent=['X %','Y %','Rộng %','Cao %'][i]!;const input=this.coords[i]!;input.type='number';input.min='0';input.max='100';input.step='.1';input.dataset['coordinate']=['x','y','width','height'][i]!;label.append(input);box.append(label);}
    this.panel.append(box);
    const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Polygon và thông tin OCR';detail.append(summary);
    const pLabel=document.createElement('label');pLabel.textContent='Polygon [[x%, y%], …]; để trống dùng khung chữ nhật';pLabel.append(this.polygon);detail.append(pLabel,this.confidence);this.confidence.className='hint';this.panel.append(detail);
    const check=document.createElement('label');check.className='check';this.hidden.type='checkbox';check.append(this.hidden,document.createTextNode('Ẩn vùng này'));this.panel.append(check);
    const actions=document.createElement('div');actions.className='actions';
    actions.append(this.button('Xem trước','preview',()=>this.preview()),this.button('Lưu sửa','save',()=>this.save(),'primary'),this.button('Thêm vùng','add',()=>this.add()),this.button('Khôi phục bản AI','reset',()=>this.reset()));
    const reprocess=this.button('Đọc lại crop này bằng AI','reprocess',()=>this.reprocess());
    const note=document.createElement('p');note.className='hint';note.textContent='Đọc lại crop có thể tạo request Gemini tính phí. Kết quả chỉ được lưu sau khi bấm Lưu sửa. Phủ nền nhanh không phải inpainting.';
    this.status.className='status';this.status.setAttribute('role','status');this.panel.append(actions,reprocess,note,this.status);shadow.append(style,this.panel);document.documentElement.append(this.host);
    window.addEventListener('keydown',(event)=>{if(event.isTrusted&&event.key==='Escape')this.options.onClose();},{signal:this.abort.signal});
  }
  open(snapshot: EditableRegionSnapshot,regionId?:string):void{this.update(snapshot,regionId);}
  update(snapshot: EditableRegionSnapshot,regionId?:string):void{this.snapshot=snapshot;this.edits=copyEdits(snapshot);this.populate(regionId??this.selectedId);this.message('Sửa cục bộ; ảnh gốc và kết quả OCR gốc được giữ nguyên.');}
  selectRegion(regionId:string):void{
    if(this.busy){this.selection.value=this.selectedId;return;}
    try{if(this.selectedId)this.stage();this.selectedId=regionId;this.selection.value=regionId;this.fill();}
    catch(error){this.selection.value=this.selectedId;this.message(error instanceof Error?error.message:'Vùng chữ không hợp lệ.',true);}
  }
  setHidden(hidden:boolean):void{this.host.style.setProperty('display',hidden?'none':'block','important');}
  destroy():void{this.destroyed=true;this.abort.abort();this.host.remove();}
  private field(labelText:string,control:HTMLElement):void{const label=document.createElement('label');label.textContent=labelText;label.append(control);this.panel.append(label);}
  private button(label:string,action:string,handler:()=>void|Promise<void>,className=''):HTMLButtonElement{
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset['editorAction']=action;button.className=className;this.buttons.push(button);
    button.addEventListener('click',(event)=>{if(!event.isTrusted||this.destroyed||(this.busy&&action!=='close'))return;try{const task=handler();if(task)void task.catch((error:unknown)=>this.message(error instanceof Error?error.message:'Chưa hoàn tất thao tác.',true));}catch(error){this.message(error instanceof Error?error.message:'Vùng chữ không hợp lệ.',true);}},{signal:this.abort.signal});return button;
  }
  private message(text:string,error=false):void{this.status.textContent=text;this.status.dataset['error']=String(error);}
  private working(value:boolean):void{
    this.busy=value;
    for(const button of this.buttons)button.disabled=value&&button.dataset['editorAction']!=='close';
    for(const input of[this.selection,this.text,...this.coords,this.polygon,this.hidden])input.disabled=value;
  }
  private originals():readonly TranslatedRegion[]{return [...(this.snapshot?.original.regions??[]),...this.edits.added];}
  private populate(preferred=''):void{this.selection.replaceChildren();for(const [index,region] of this.originals().entries())this.selection.append(new Option(`${index+1}. ${region.sourceText.slice(0,35)||'Vùng thủ công'}`,region.id));this.selectedId=this.originals().some((region)=>region.id===preferred)?preferred:this.originals()[0]?.id??'';this.selection.value=this.selectedId;this.fill();}
  private region():TranslatedRegion|undefined{
    const added=this.edits.added.find((region)=>region.id===this.selectedId);if(added)return added;
    const original=this.snapshot?.original.regions.find((region)=>region.id===this.selectedId);if(!original)return undefined;
    const edits:UserRegionEdits={revision:'preview',updatedAt:0,overrides:{[this.selectedId]:{...this.edits.overrides[this.selectedId],hidden:false}},added:[]};
    return applyRegionEdits({sourceLanguage:this.snapshot!.original.sourceLanguage,regions:[original]},edits).regions[0];
  }
  private fill():void{
    const region=this.region();this.text.value=region?.text??'';this.source.value=region?.sourceText??'';
    for(const [i,key] of (['x','y','width','height'] as const).entries())this.coords[i]!.value=String(Number(((region?.box[key]??0)*100).toFixed(3)));
    this.displayedCoordinates=this.coords.map((input)=>input.value);
    this.displayedPoints=region?.polygon;
    this.displayedBox=region?.box;this.displayedPolygon=region?.polygon?JSON.stringify(region.polygon.map((point)=>[Number((point.x*100).toFixed(3)),Number((point.y*100).toFixed(3))])):'';this.polygon.value=this.displayedPolygon;
    this.hidden.checked=this.edits.overrides[this.selectedId]?.hidden===true;
    const score=(value:number|null|undefined):string=>typeof value==='number'?`${Math.round(value*100)}%`:'chưa biết';
    this.confidence.textContent=region?`OCR: ${score(region.ocrConfidence)} · Vị trí: ${score(region.positionConfidence)}. Đây là đánh giá từ model, chưa hiệu chuẩn. ${region.reviewRequired?'Cần kiểm tra thủ công.':''}`:'Chưa có vùng; bấm Thêm vùng để tạo.';
  }
  private box():NormalizedBox{
    // Display rounding must never change source geometry on a text-only save.
    if(this.displayedBox&&this.coords.every((input,index)=>input.value===this.displayedCoordinates[index]))return this.displayedBox;
    const [x,y,width,height]=this.coords.map((input)=>Number(input.value)/100);
    const box={x:x!,y:y!,width:width!,height:height!};
    if(!isNormalizedBox(box))throw new Error('Tọa độ phải nằm trong ảnh và vùng phải có kích thước dương.');return box;
  }
  private stage():RegionEditsInput{
    if(!this.snapshot)throw new Error('Chọn ảnh đã dịch trước.');
    if(!this.selectedId||!this.region())return validateRegionEdits(this.edits,this.snapshot.original);
    const box=this.box();let polygon:readonly NormalizedPoint[]|null=null;
    if(this.polygon.value.trim()){
      if(this.polygon.value===this.displayedPolygon&&this.displayedPoints&&this.displayedBox){
        const from=this.displayedBox;
        polygon=box===from?this.displayedPoints:this.displayedPoints.map((point)=>({x:box.x+(point.x-from.x)/from.width*box.width,y:box.y+(point.y-from.y)/from.height*box.height}));
      }else{
        const parsed:unknown=JSON.parse(this.polygon.value);
        if(!Array.isArray(parsed))throw new Error('Polygon phải là danh sách điểm [x%, y%].');
        polygon=parsed.map((pair:unknown)=>{if(!Array.isArray(pair)||pair.length!==2||!pair.every((value)=>typeof value==='number'&&Number.isFinite(value)))throw new Error('Điểm polygon không hợp lệ.');return{x:Number(pair[0])/100,y:Number(pair[1])/100};});
      }
    }
    const override:RegionOverride={text:this.text.value,box,polygon,hidden:this.hidden.checked};
    const added=this.edits.added.find((region)=>region.id===this.selectedId);
    let next:RegionEditsInput;
    if(added){const{polygon:_polygon,...base}=added;void _polygon;next={...this.edits,added:this.hidden.checked?this.edits.added.filter((region)=>region.id!==added.id):this.edits.added.map((region)=>region.id===added.id?{...base,text:this.text.value,box,...(polygon?{polygon}:{})}:region)};}
    else next={...this.edits,overrides:{...this.edits.overrides,[this.selectedId]:override}};
    this.edits=validateRegionEdits(next,this.snapshot.original);
    if(added&&this.hidden.checked)this.populate();
    return this.edits;
  }
  private preview():void{this.options.onPreview(this.stage());this.message('Đã xem trước. Bấm Lưu sửa để giữ bản chỉnh.');}
  private async save():Promise<void>{if(!this.snapshot)return;const edits=this.stage();this.working(true);try{this.update(await this.options.onSave(edits,this.snapshot),this.selectedId);this.message('Đã lưu bản sửa vào cache.');}finally{this.working(false);}}
  private async reset():Promise<void>{if(!this.snapshot)return;this.working(true);try{this.update(await this.options.onReset(this.snapshot));this.message('Đã khôi phục bản AI gốc.');}finally{this.working(false);}}
  private add():void{
    if(this.selectedId)this.stage();
    const region:TranslatedRegion={id:`manual-${Array.from(crypto.getRandomValues(new Uint8Array(8)),(n)=>n.toString(16).padStart(2,'0')).join('')}`,sourceText:'',sourceLanguage:this.snapshot?.original.sourceLanguage??'unknown',text:'Nhập bản dịch',box:{x:.1,y:.1,width:.3,height:.1},edited:true};
    this.edits={...this.edits,added:[...this.edits.added,region]};this.populate(region.id);
  }
  private async reprocess():Promise<void>{
    if(!this.snapshot)return;const crop=this.box();this.working(true);
    try{
      const result=await this.options.onReprocess(crop,this.snapshot);
      if(this.destroyed)return;
      const overrides={...this.edits.overrides};
      const covered=(region:TranslatedRegion):boolean=>rectangleIntersection(region.box,crop)/(region.box.width*region.box.height)>=.5;
      for(const region of this.snapshot.original.regions)if(covered(region))overrides[region.id]={...overrides[region.id],hidden:true};
      const prefix=Array.from(crypto.getRandomValues(new Uint8Array(5)),(n)=>n.toString(16).padStart(2,'0')).join('');
      const incoming=result.regions.map((region)=>({...region,id:`retry-${prefix}-${region.id}`,edited:true,reviewRequired:false}));
      this.edits=validateRegionEdits({overrides,added:[...this.edits.added.filter((region)=>!covered(region)),...incoming]},this.snapshot.original);
      this.options.onPreview(this.edits);this.populate(incoming[0]?.id);this.message(`Đọc lại được ${incoming.length} vùng. Kiểm tra rồi bấm Lưu sửa; các vùng ngoài crop được giữ nguyên.`);
    }finally{this.working(false);}
  }
}
