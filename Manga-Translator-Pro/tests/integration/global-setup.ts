import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

export default async function setup(): Promise<void> {
  await mkdir('work', { recursive: true });
  await build({
    entryPoints: ['tests/browser-harness.ts'], outfile: 'work/browser-harness.js',
    bundle: true, format: 'iife', target: 'chrome120', sourcemap: 'inline',
  });
  await build({ entryPoints: ['tests/translation-harness.ts'], outfile: 'work/translation-harness.js', bundle: true, format: 'iife', target: 'chrome120' });
  await build({ entryPoints: ['tests/chapter-pipeline-harness.ts'], outfile: 'work/chapter-pipeline-harness.js', bundle: true, format: 'iife', target: 'chrome120' });
  await build({ entryPoints: ['tests/chapter-storage-harness.ts'], outfile: 'work/chapter-storage-harness.js', bundle: true, format: 'iife', target: 'chrome120' });
  await build({ entryPoints: ['tests/chapter-content-harness.ts'], outfile: 'work/chapter-content-harness.js', bundle: true, format: 'iife', target: 'chrome120' });
}
