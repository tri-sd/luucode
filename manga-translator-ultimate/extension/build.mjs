import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const outdir = new URL('./dist/', import.meta.url);
const key = (await readFile(new URL('./chrome-key.txt', import.meta.url), 'utf8')).trim();
const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, 'icons/'+size+'.png']));
const manifest = {
  manifest_version: 3, name: 'MANGA TRANSLATOR ULTIMATE — FREE LOCAL EDITION',
  short_name: 'Manga Translator', version: '1.0.0', key,
  description: 'Dịch truyện Anh và Nhật sang tiếng Việt bằng AI local.',
  minimum_chrome_version: '120',
  permissions: ['activeTab', 'scripting', 'storage', 'unlimitedStorage'],
  host_permissions: ['http://127.0.0.1/*'],
  optional_host_permissions: ['http://*/*','https://*/*'],
  icons, background: { service_worker: 'worker.js' },
  action: { default_icon: icons, default_popup: 'popup.html', default_title: 'Manga Translator Ultimate' },
  options_page: 'settings.html',
};
await mkdir(outdir, { recursive: true });
await build({ entryPoints: ['content', 'worker', 'popup', 'settings', 'editor'].map(x => 'src/'+x+'.ts'),
  bundle: true, format: 'iife', target: 'chrome120', outdir: outdir.pathname, legalComments: 'eof' });
for (const name of ['popup.html', 'settings.html', 'editor.html', 'app.css'])
  await copyFile(new URL('./'+name, import.meta.url), new URL(name, outdir));
await mkdir(new URL('icons/', outdir), {recursive:true});
for (const icon of Object.values(icons)) await copyFile(new URL(icon, import.meta.url), new URL(icon, outdir));
await writeFile(new URL('manifest.json', outdir), JSON.stringify(manifest, null, 2)+'\n');
