import { api } from './protocol';
import { defaults, errorText, type Health, type Settings } from './types';
import { el, message, setProfile, stored } from './ui';

const token = el<HTMLInputElement>('token');
const glossary = el<HTMLTextAreaElement>('glossary');
type Glossary = Record<string, string>;
const box = (id: string) => el<HTMLInputElement>(id);
const value = (id: string) => el<HTMLInputElement | HTMLSelectElement>(id).value;
const report = (err: unknown) => message('notice', errorText(err));

async function check() {
  try {
    const [health, terms] = await Promise.all([api<Health>('health'),api<Glossary>('glossary')]);
    el('models').replaceChildren(...health.models.map(name => {
      const option = document.createElement('option');
      option.value = name;
      return option;
    }));
    const device = health.gpu ? health.gpu.name+' · VRAM '+health.gpu.used+'/'+health.gpu.total+' MiB' : 'Không phát hiện NVIDIA · CPU sẵn sàng';
    const loaded = health.loaded.map(m => m.name + ' (' + Math.round(m.vram/1024**2) + ' MiB VRAM)').join(', ');
    message('health', [
      health.ollama ? 'Engine và Ollama đã kết nối.' : 'Engine đã kết nối. Hãy khởi động Ollama.',
      device, health.manga_ocr ? 'Manga OCR đã tải.' : 'Thiếu mô hình Manga OCR.',
      health.models.length ? '' : 'Chưa tìm thấy mô hình dịch local.', loaded,
    ].filter(Boolean).join(' '));
    glossary.value = JSON.stringify(terms, null, 2);
  } catch (error) { message('health',errorText(error)); }
}
async function initialize() {
  const prefs = await stored();
  token.value = prefs.token;
  const settings = {...defaults,...prefs.settings};
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (key === 'sfx') box(key).checked = Boolean(settings[key]);
    else el<HTMLInputElement | HTMLSelectElement>(key).value = String(settings[key]);
  }
  box('auto').checked = settings.auto ?? true;
  await check();
}
el<HTMLFormElement>('connection').onsubmit = e => {
  e.preventDefault();
  const code = token.value.trim();
  if (!/^[a-zA-Z0-9_-]{43}$/.test(code)) { message('health','Mã ghép nối gồm 43 ký tự.'); return; }
  void chrome.storage.local.set({token:code}).then(check).catch(report);
};
el<HTMLFormElement>('profile').onsubmit = e => {
  e.preventDefault();
  const model = value('model').trim();
  if (!/^[\w.-]{1,80}(:[\w.-]{1,80})?$/.test(model)) { message('notice','Tên mô hình local không hợp lệ.'); return; }
  void setProfile({
    model, device:value('device'), quality:value('quality'), language:value('language'),
    font:value('font'), font_scale:box('font_scale').valueAsNumber, sfx:box('sfx').checked, auto:box('auto').checked,
  }).then(() => message('notice','Đã lưu hồ sơ.')).catch(report);
};
el('save-glossary').onclick = () => {
  void Promise.resolve().then(() => api<Glossary>('saveGlossary', undefined, JSON.parse(glossary.value)))
    .then(terms => { glossary.value = JSON.stringify(terms,null,2); message('notice','Đã lưu từ điển. Ảnh mới sẽ dùng từ điển này.'); })
    .catch(report);
};
el('import').onclick = () => box('file').click();
box('file').onchange = () => {
  const file = box('file').files?.[0];
  if (!file) return;
  if (file.size > 64_000) { message('notice','Tệp từ điển vượt 64 kB.'); return; }
  void file.text().then(text => {
    glossary.value = JSON.stringify(JSON.parse(text), null, 2);
    box('file').value = '';
    message('notice','Đã đọc tệp. Chọn Lưu từ điển để áp dụng.');
  }).catch(report);
};
el('export').onclick = () => {
  void api<Glossary>('glossary').then(terms => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(terms,null,2)],{type:'application/json'}));
    const link = document.createElement('a');
    link.href=url; link.download='manga-glossary.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }).catch(report);
};
el('clear').onclick = () => {
  if (window.confirm('Xóa ảnh đã xử lý khỏi cache trên ổ đĩa?')) {
    void api('clear').then(() => message('notice','Đã xóa cache ảnh.')).catch(report);
  }
};
void initialize().catch(report);
