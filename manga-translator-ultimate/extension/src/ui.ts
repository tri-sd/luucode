export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('Thiếu điều khiển ' + id);
  return node as T;
}
export function message(id: string, text: string) {
  const node = el(id);
  node.textContent = text;
  node.hidden = !text;
}
export async function stored() {
  const value = await chrome.storage.local.get(['settings','token']);
  return {settings:value.settings ?? {}, token:value.token ?? ''};
}
export async function setProfile(patch: Record<string, unknown>) {
  const {settings} = await stored();
  await chrome.storage.local.set({settings:{...settings, ...patch}});
}
