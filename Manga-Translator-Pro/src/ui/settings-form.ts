import type { ModelOption, PublicSettings, SourceLanguage, TranslationSettings } from '../translation/types';
import { hasExtensionRuntime, rpc, showError } from './rpc';

export async function initializeSettingsForm(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>('#settings-form')!;
  const password = form.querySelector<HTMLInputElement>('#api-key')!;
  const model = form.querySelector<HTMLSelectElement>('#model-select')!;
  const manual = form.querySelector<HTMLInputElement>('#model-manual')!;
  const source = form.querySelector<HTMLSelectElement>('#source-language')!;
  const timeout = form.querySelector<HTMLInputElement>('#timeout')!;
  const remember = form.querySelector<HTMLInputElement>('#remember-key')!;
  const status = document.querySelector<HTMLElement>('#settings-status')!;
  const load = form.querySelector<HTMLButtonElement>('#load-models')!;
  const clear = form.querySelector<HTMLButtonElement>('#clear-key')!;
  const save = form.querySelector<HTMLButtonElement>('#save-settings')!;

  function populate(settings: PublicSettings): void {
    if (settings.model && ![...model.options].some((option) => option.value === settings.model)) {
      const option = document.createElement('option'); option.value = settings.model; option.textContent = settings.model; model.append(option);
    }
    model.value = settings.model;
    source.value = settings.sourceLanguage; timeout.value = String(settings.timeoutSeconds); remember.checked = settings.rememberKey;
    password.placeholder = settings.hasKey ? 'Key đã lưu — để trống để giữ nguyên' : 'Nhập Gemini API key của bạn';
    status.textContent = settings.hasKey ? `Đã có key · ${settings.rememberKey ? 'lưu trên máy' : 'chỉ giữ trong phiên trình duyệt'}` : 'Chưa có API key.';
    status.dataset['state'] = 'ready';
  }

  if (!hasExtensionRuntime()) {
    status.textContent = 'Mở Tùy chọn của extension đã cài để cấu hình Gemini. Tracking Lab bên dưới vẫn hoạt động độc lập.';
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button').forEach((element) => { element.disabled = true; });
    return;
  }
  try { populate(await rpc<PublicSettings>({ type: 'ui:settings' })); }
  catch (error) { showError(status, error); }

  let busy = false;
  function working(value: boolean): void { busy = value; load.disabled = value; clear.disabled = value; save.disabled = value; }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    working(true);
    const settings: TranslationSettings = {
      model: manual.value.trim() || model.value, sourceLanguage: source.value as SourceLanguage,
      timeoutSeconds: Number(timeout.value), rememberKey: remember.checked,
    };
    void rpc<PublicSettings>({ type: 'ui:save', settings, apiKey: password.value })
      .then((result) => { populate(result); manual.value = ''; })
      .catch((error: unknown) => showError(status, error))
      .finally(() => { password.value = ''; working(false); });
  });
  load.addEventListener('click', () => {
    if (busy) return;
    working(true); status.textContent = 'Đang tải danh sách model từ Gemini…';
    const selected = model.value;
    void rpc<readonly ModelOption[]>({ type: 'ui:models', apiKey: password.value })
      .then((models) => {
        model.replaceChildren(new Option('Chọn model Gemini hỗ trợ ảnh', ''));
        for (const item of models) model.append(new Option(`${item.name} · ${item.id}`, item.id));
        if (models.some((item) => item.id === selected)) model.value = selected;
        status.textContent = `Đã tải ${models.length} model có generateContent. Chọn model hỗ trợ ảnh và JSON, rồi bấm Lưu.`;
        status.dataset['state'] = 'ready';
      }).catch((error: unknown) => showError(status, error)).finally(() => working(false));
  });
  clear.addEventListener('click', () => {
    if (busy) return;
    working(true);
    void rpc<PublicSettings>({ type: 'ui:clear-key' }).then(populate)
      .catch((error: unknown) => showError(status, error))
      .finally(() => { password.value = ''; working(false); });
  });
}
