import { browser } from 'wxt/browser';
import { rpc, showError } from '../../ui/rpc';
import { RegionTracker } from '../../tracking/region-tracker';
import './style.css';
import { initializeSettingsForm } from '../../ui/settings-form';

const tracker = new RegionTracker();
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const status = document.querySelector<HTMLElement>('#status')!;
let additions = 0;

void initializeSettingsForm();
document.querySelector('#open-settings')!.addEventListener('click', () => {
  const panel = document.querySelector<HTMLDetailsElement>('#settings-panel')!;
  panel.open = true; panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function updateStatus(): void {
  const state = tracker.status();
  toggle.textContent = state.active ? 'Tắt vùng chữ giả lập' : 'Bật vùng chữ giả lập';
  toggle.setAttribute('aria-pressed', String(state.active));
  status.textContent = state.active
    ? `Đang bật · ${state.trackedCount} ảnh nhận diện · ${state.visibleCount} ảnh đang hiển thị overlay`
    : 'Đang tắt · Không có overlay trên trang';
}

toggle.addEventListener('click', () => {
  if (tracker.status().active) tracker.stop();
  else tracker.start();
  updateStatus();
});
document.querySelector('#shift')!.addEventListener('click', () => {
  const spacer = document.querySelector<HTMLElement>('#demo-spacer')!;
  spacer.style.height = spacer.style.height === '180px' ? '0' : '180px';
});
document.querySelector('#append')!.addEventListener('click', () => {
  const image = document.createElement('img');
  image.id = `demo-added-${++additions}`;
  image.className = 'comic';
  image.src = `/demo/panel.svg?page=added-${additions}`;
  image.width = 1000; image.height = 1600;
  image.alt = `Trang truyện thêm ${additions}`;
  document.querySelector('#demo-reader')!.append(image);
});

const interval = window.setInterval(updateStatus, 500);
window.addEventListener('pagehide', () => { tracker.stop(); window.clearInterval(interval); }, { once: true });


const enableWebsites = document.querySelector<HTMLButtonElement>('#enable-websites')!;
const websiteStatus = document.querySelector<HTMLElement>('#website-access-status')!;
if (typeof browser.permissions?.request !== 'function') {
  enableWebsites.disabled = true;
  websiteStatus.textContent = 'Mở Tùy chọn của extension đã cài để cấp quyền website. Tracking Lab vẫn dùng được tại đây.';
}
enableWebsites.addEventListener('click', () => {
  // Broad optional access is explicit and only requested in this button gesture.
  const permission = browser.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
  enableWebsites.disabled = true;
  void permission.then(async (granted) => {
    if (!granted) throw new Error('Chưa cấp quyền tự nhận diện trên website. Bạn vẫn có thể bật riêng từng website từ popup.');
    await rpc({ type: 'ui:enable-sites' });
    websiteStatus.textContent = 'Đã bật tự nhận diện trên website. Nút Dịch truyện chỉ xuất hiện khi tìm thấy ảnh truyện.';
    websiteStatus.dataset['state'] = 'ready';
  }).catch((error: unknown) => showError(websiteStatus, error)).finally(() => { enableWebsites.disabled = false; });
});
