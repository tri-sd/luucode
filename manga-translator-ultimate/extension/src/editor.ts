import { api, command, job } from './protocol';
import { errorText, type Box, type Region, type Summary } from './types';
import { el, message } from './ui';

const params = new URLSearchParams(location.search);
const key = params.get('key') ?? '';
const tab = Number(params.get('tab'));
const stage = el('stage');
const chooser = el<HTMLSelectElement>('region');
const fields = ['x','y','w','h'].map(id => el<HTMLInputElement>(id));
const textarea = el<HTMLTextAreaElement>('text');
const scale = el<HTMLInputElement>('scale');
const form = el<HTMLFormElement>('edit');
const font = el<HTMLSelectElement>('font');
let data: Summary | undefined;
let selected: Region | undefined;
let pending = false;
let imageUrl: string | undefined;

function setBox(box: Box) {
  box.forEach((entry,i) => { fields[i].value = (entry*100).toFixed(2); });
}
function readBox(): Box {
  return fields.map(field => field.valueAsNumber/100) as Box;
}
function drawBox(button: HTMLElement, box: Box) {
  const [x,y,w,h] = box;
  Object.assign(button.style,{left:x*100+'%',top:y*100+'%',width:w*100+'%',height:h*100+'%'});
}
function preview() {
  const item = stage.querySelector<HTMLElement>('.selected');
  if (item) drawBox(item, readBox());
}
function select(id: string) {
  selected = data?.regions.find(region => region.id === id);
  if (!selected) return;
  chooser.value = id;
  message('source', selected.source ? 'OCR · ' + selected.source : 'OCR chưa đọc được vùng này.');
  message('issue', selected.issue);
  textarea.value = selected.text;
  scale.value = selected.font_scale == null ? '' : String(selected.font_scale);
  font.value = selected.font ?? '';
  for (const node of stage.querySelectorAll<HTMLButtonElement>('.region')) node.classList.toggle('selected',node.dataset.id === id);
  setBox(selected.placement ?? selected.bubble ?? selected.box);
}
function drag(event: PointerEvent, button: HTMLButtonElement, region: Region) {
  if (event.button !== 0 || pending) return;
  if (selected?.id !== region.id) select(region.id);
  const rect = stage.getBoundingClientRect();
  const [x,y,w,h] = readBox();
  const {clientX,clientY,pointerId} = event;
  button.setPointerCapture(pointerId);
  const move = (e: PointerEvent) => {
    setBox([Math.max(0,Math.min(1-w,x+(e.clientX-clientX)/rect.width)),
      Math.max(0,Math.min(1-h,y+(e.clientY-clientY)/rect.height)),w,h]);
    preview();
  };
  button.addEventListener('pointermove',move);
  button.addEventListener('lostpointercapture', () => button.removeEventListener('pointermove',move), {once:true});
}
async function redraw(result: Summary, id?: string) {
  data = result;
  stage.replaceChildren();
  chooser.replaceChildren();
  if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = undefined; }
  const image = document.createElement('img');
  image.alt = 'Ảnh truyện';
  image.width = result.width; image.height = result.height;
  if (result.image) {
    const bytes = Uint8Array.from(atob(result.image), ch => ch.charCodeAt(0));
    imageUrl = URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
  } else {
    const original = await api<{image:string;mime:string}>('original', result.key);
    const bytes = Uint8Array.from(atob(original.image), ch => ch.charCodeAt(0));
    imageUrl = URL.createObjectURL(new Blob([bytes],{type:original.mime}));
  }
  image.src = imageUrl;
  stage.append(image);
  for (const r of result.regions) {
    const node = document.createElement('option');
    node.value = r.id;
    node.textContent = r.id + (r.issue ? ' · cần xem lại' : '') + (r.source ? ' · '+r.source.slice(0,25) : '');
    chooser.append(node);
    const overlay = document.createElement('button');
    overlay.type = 'button'; overlay.className = 'region'; overlay.dataset.id = r.id;
    overlay.setAttribute('aria-label','Chọn ' + r.id);
    drawBox(overlay,r.placement ?? r.bubble ?? r.box);
    overlay.onclick = () => { if (selected?.id !== r.id) select(r.id); };
    overlay.onpointerdown = event => drag(event,overlay,r);
    stage.append(overlay);
  }
  if (result.regions.length) select(id ?? result.regions[0].id);
  else {
    form.hidden = true;
    message('notice','Engine chưa phát hiện vùng chữ để chỉnh.');
  }
}
async function save(reset: boolean) {
  if (!data || !selected || pending) return;
  const id = selected.id;
  const placement = readBox();
  if (!reset && (placement.some(v => !Number.isFinite(v) || v < 0) || placement[0]+placement[2] > 1.00001 ||
      placement[1]+placement[3] > 1.00001 || placement[2]<=0 || placement[3]<=0)) {
    message('notice','Khung phải nằm trọn trong ảnh.'); return;
  }
  pending = true;
  el<HTMLButtonElement>('save').disabled = true;
  el<HTMLButtonElement>('reset').disabled = true;
  try {
    const edit = {id,text:textarea.value,placement:reset ? null : placement,font:font.value || null,
      font_scale:scale.value ? scale.valueAsNumber : null};
    const updated = await job('edit',{reset,edit},AbortSignal.timeout(90000),phase => message('notice',phase),key);
    await redraw(updated,id);
    if (tab) await command(tab,'refresh',key).catch(() => {});
    message('notice',reset ? 'Đã khôi phục vùng.' : 'Đã lưu chỉnh sửa.');
  } catch (error) {
    message('notice',errorText(error));
  } finally {
    pending = false;
    el<HTMLButtonElement>('save').disabled = false;
    el<HTMLButtonElement>('reset').disabled = false;
  }
}
chooser.onchange = () => select(chooser.value);
for (const field of fields) field.oninput = preview;
form.onsubmit = e => { e.preventDefault(); void save(false); };
el('reset').onclick = () => void save(true);
void api<Summary>('result',key).then(value => redraw(value)).catch(error => message('notice',errorText(error)));
