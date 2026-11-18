import { api, command } from './protocol';
import { defaults, errorText, type Command, type Health, type Status } from './types';
import { el, message, setProfile, stored } from './ui';

let tab: number | undefined;
let origin = '';
let last: Status | undefined;
let pending = false;

function show(status: Status) {
  last = status;
  for (const key of ['done','processing','waiting','errors'] as const) el(key).textContent = String(status[key]);
  el('fraction').textContent = status.done+' / '+status.found;
  const progress = el<HTMLProgressElement>('progress');
  progress.max = Math.max(1,status.found);
  progress.value = status.done;
  const notes = status.regions ? status.regions+' vùng cần kiểm tra hoặc sửa' : '';
  el('phase').textContent = status.paused ? 'Đã tạm dừng' : status.phase || (
    status.batch === 'collecting' ? 'Cuộn đến cuối chương rồi bấm dịch '+status.collected+' ảnh.' :
    status.batch === 'complete' ? 'Đã xử lý xong hàng đợi'+(notes ? ' · '+notes : '') : notes);
  const collect = el<HTMLButtonElement>('collect');
  collect.disabled = status.batch === 'running' || (status.batch === 'collecting' && status.collected === 0);
  collect.textContent = status.batch === 'collecting' ? 'Dịch '+status.collected+' ảnh đã thu thập' :
    status.batch === 'running' ? 'Đang dịch các ảnh đã thu thập' :
    status.batch === 'complete' && status.errors ? 'Thử lại ảnh lỗi' : 'Thu thập ảnh chương';
  el('chapter').hidden = status.batch === 'collecting' || status.batch === 'running';
  el('pause').textContent = status.paused ? 'Tiếp tục' : 'Tạm dừng';
  el<HTMLInputElement>('auto').checked = status.auto;
  el<HTMLInputElement>('show').checked = status.showing;
  el('cdn').hidden = !status.hosts.length;
  if (status.recent.length) message('message', status.recent.at(-1)!);
  if (status.engine.startsWith('Không')) el('engine').textContent = status.engine;
}
async function health() {
  const indicator = el('indicator');
  try {
    const value = await api<Health>('health');
    el('engine').textContent = !value.ollama ? 'Engine kết nối · Ollama chưa sẵn sàng' :
      value.gpu ? value.gpu.name+' · '+value.gpu.used+'/'+value.gpu.total+' MiB' : 'Engine kết nối · CPU';
    indicator.classList.toggle('on', value.ollama && value.models.length > 0);
  } catch (error) {
    el('engine').textContent = errorText(error);
    indicator.classList.remove('on');
  }
}
async function inject() {
  const [current] = await chrome.tabs.query({active:true,currentWindow:true});
  if (current?.id == null || !current.url || !/^https?:/.test(current.url)) {
    throw new Error('Hãy mở một trang truyện HTTP hoặc HTTPS.');
  }
  tab = current.id;
  origin = new URL(current.url).origin;
  try { show(await command(tab, 'status')); }
  catch {
    await chrome.scripting.executeScript({target:{tabId:tab},files:['content.js']});
    show(await command(tab, 'status'));
  }
}
function requestReader(site: string) {
  const url = new URL(site);
  const pattern = url.protocol+'//'+url.hostname+'/*';
  const prepare = () => chrome.runtime.sendMessage({type:'reader-permission', site}).catch(() => {});
  void prepare();
  void chrome.permissions.request({origins:[pattern]}).then(granted => granted ? prepare() : undefined).catch(() => {});
}

function run(action: Command, value?: unknown) {
  if (tab == null || pending) return;
  pending = true;
  message('message','');
  void command(tab, action, value).then(show, error => message('message',errorText(error)))
    .finally(() => { pending = false; });
}
for (const key of ['current','retry','edit'] as const) el(key).onclick = () => run(key);
el('settings').onclick = () => void chrome.runtime.openOptionsPage();
el('pause').onclick = () => run(last?.paused ? 'resume' : 'pause');
el('collect').onclick = () => run(last?.batch === 'collecting' ||
  (last?.batch === 'complete' && last.errors) ? 'batch' : 'collect');
el('chapter').onclick = () => {
  if (!origin) return;
  if (el<HTMLInputElement>('auto').checked) requestReader(origin);
  run('chapter');
};
el<HTMLInputElement>('show').onchange = e => run('show',(e.target as HTMLInputElement).checked);
el<HTMLInputElement>('auto').onchange = e => {
  const checked = (e.target as HTMLInputElement).checked;
  if (checked && origin) requestReader(origin);
  void setProfile({auto:checked}).catch(error => message('message', errorText(error)));
  run('auto', checked);
};
el('cdn').onclick = () => {
  const origins = (last?.hosts ?? []).map(host => host+'/*');
  if (!origins.length) return;
  void chrome.permissions.request({origins}).then(granted => {
    if (granted && last?.batch !== 'collecting') run(last?.batch && last.batch !== 'idle' ? 'batch' : 'chapter');
  }).catch(error => message('message',errorText(error)));
};
for (const key of ['language','quality'] as const) {
  const control = el<HTMLSelectElement>(key);
  control.onchange = () => void setProfile({[key]:control.value}).catch(error => message('message', errorText(error)));
}
void stored().then(({settings}) => {
  for (const key of ['language','quality'] as const) el<HTMLSelectElement>(key).value = settings[key] ?? defaults[key];
});
void inject().catch(error => {
  message('message',errorText(error));
  for (const key of ['collect','chapter','current','pause','retry','edit','show','auto'])
    el<HTMLButtonElement>(key).disabled = true;
});
void health();
setInterval(() => { if (tab != null && !pending) void command(tab,'status').then(show).catch(() => {}); },800);
setInterval(() => void health(),8000);
