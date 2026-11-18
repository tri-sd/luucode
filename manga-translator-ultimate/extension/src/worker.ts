import { base64, responseBlob } from './bytes';
import { type ApiAction, errorText, type Reply } from './types';

const endpoint = 'http://127.0.0.1:18787';
const routes: Record<ApiAction, [string, string, RegExp?]> = {
  health: ['GET', '/health'], submit: ['POST', '/jobs'],
  job: ['GET', '/jobs/', /^[a-f0-9]{32}$/], cancel: ['DELETE', '/jobs/', /^[a-f0-9]{32}$/],
  result: ['GET', '/result/', /^[a-f0-9]{64}$/], edit: ['POST', '/edit/', /^[a-f0-9]{64}$/],
  original: ['GET', '/original/', /^[a-f0-9]{64}$/],
  glossary: ['GET', '/glossary'], saveGlossary: ['POST', '/glossary'], clear: ['DELETE', '/cache'],
};
void chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}).catch(() => {});

async function local(action: ApiAction, key?: string, payload?: unknown): Promise<Reply<unknown>> {
  if (!Object.hasOwn(routes, action)) throw new Error('Lệnh không hợp lệ.');
  const [method, route, keyFormat] = routes[action];
  if (keyFormat && (typeof key !== 'string' || !keyFormat.test(key))) throw new Error('Mã tác vụ không hợp lệ.');
  const { token } = await chrome.storage.local.get('token');
  if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw new Error('Nhập mã ghép nối trong Cài đặt.');
  let response: Response;
  try {
    response = await fetch(endpoint + route + (keyFormat ? key : ''), {
      method, mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: {Authorization: 'Bearer ' + token, ...(method === 'POST' ? {'Content-Type': 'application/json'} : {})},
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(24000),
    });
  } catch {
    return {ok: false, error: 'Không kết nối được Local Engine. Kiểm tra Start Engine rồi thử lại.', status: 0};
  }
  const data = await response.json();
  if (!response.ok) return {ok: false, error: typeof data.detail === 'string' ? data.detail : 'Yêu cầu thất bại.', status: response.status};
  return {ok: true, value: data};
}

function publicImage(url: URL): boolean {
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
    !['localhost','localhost.'].includes(url.hostname) && url.hostname.includes('.') &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && !url.hostname.endsWith('.local');
}

async function cdnImage(input: string, sender: chrome.runtime.MessageSender) {
  if (!sender.tab || typeof input !== 'string' || input.length > 8192) throw new Error('Địa chỉ ảnh không hợp lệ.');
  const url = new URL(input);
  if (!publicImage(url) || !(await chrome.permissions.contains({origins: [url.origin+'/*']}))) {
    throw new Error('Website chưa cấp quyền đọc ảnh từ ' + url.origin + '.');
  }
  const response = await fetch(url.href, {
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12000),
  });
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/')) {
    throw new Error('CDN không trả về dữ liệu ảnh.');
  }
  return base64(await responseBlob(response));
}

async function registerReader(pattern: string) {
  if (!(await chrome.permissions.contains({origins:[pattern]}))) return;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pattern)));
  const id = 'reader-' + Array.from(digest.slice(0,12), b => b.toString(16).padStart(2,'0')).join('');
  const existing = await chrome.scripting.getRegisteredContentScripts({ids:[id]});
  if (!existing.length) {
    try {
      await chrome.scripting.registerContentScripts([{id,matches:[pattern],js:['content.js'],runAt:'document_idle'}]);
    } catch (error) {
      // Permission callback and permission event can register at the same time.
      if (!(await chrome.scripting.getRegisteredContentScripts({ids:[id]})).length) throw error;
    }
  }
}

chrome.permissions.onAdded.addListener(permissions => {
  for (const pattern of permissions.origins ?? []) {
    const key = 'reader-permission:' + pattern;
    void chrome.storage.session.get(key).then(values => {
      if (Date.now() - (values[key] ?? 0) < 300_000) return registerReader(pattern);
    }).catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const {oldValue, newValue} = changes.settings;
  void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.filter(tab => tab.id != null)
    .map(tab => chrome.tabs.sendMessage(tab.id!, {type:'profile', oldValue, newValue}))))
    .catch(() => {});
});

async function execute(message: any, sender: chrome.runtime.MessageSender): Promise<Reply<unknown>> {
  if (message.type === 'api') {
    if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL('')) &&
        !['submit', 'job', 'cancel', 'result'].includes(message.action)) throw new Error('Lệnh dành cho giao diện extension.');
    return local(message.action, message.key, message.payload);
  }
  if (message.type === 'image') return {ok: true, value: await cdnImage(message.url, sender)};
  if (message.type === 'reader-permission' && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    const url = new URL(message.site);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Website không hợp lệ.');
    const pattern = url.protocol+'//'+url.hostname+'/*';
    await chrome.storage.session.set({['reader-permission:'+pattern]:Date.now()});
    await registerReader(pattern);
    return {ok: true, value: null};
  }
  if (message.type === 'reader-state' && sender.tab?.id && sender.url) {
    const origin = new URL(sender.url).origin;
    const key = 'reader:' + sender.tab.id + ':' + origin;
    if (typeof message.active === 'boolean') await chrome.storage.session.set({[key]: message.active});
    return {ok: true, value: (await chrome.storage.session.get(key))[key] === true};
  }
  if (message.type === 'settings') {
    const {settings} = await chrome.storage.local.get('settings');
    return {ok: true, value: settings ?? {}};
  }
  if (message.type === 'edit-window' && sender.tab?.id && /^[0-9a-f]{64}$/.test(message.key)) {
    const url = chrome.runtime.getURL('editor.html') + '?' + new URLSearchParams({
      key: message.key, tab: String(sender.tab.id),
    });
    await chrome.tabs.create({url});
    return {ok: true, value: null};
  }
  throw new Error('Lệnh extension không hợp lệ.');
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !message || ['command','profile'].includes(message.type)) return;
  void execute(message, sender).then(reply, error => reply({ok: false, error: errorText(error)}));
  return true;
});
