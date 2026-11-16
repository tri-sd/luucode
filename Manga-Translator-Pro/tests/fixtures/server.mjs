import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env['FIXTURE_PORT'] ?? 4173);
const html = await readFile(new URL('./tracking.html', import.meta.url));
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  if (/^\/benchmark\/(?:index\.html|dataset\.json|(?:en|ja|zh|ko)\.svg)$/.test(url.pathname)) {
    const filename = url.pathname.slice('/benchmark/'.length);
    const type = filename.endsWith('.svg') ? 'image/svg+xml' : filename.endsWith('.json') ? 'application/json' : 'text/html';
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' })
      .end(await readFile(new URL(`./multilingual/${filename}`, import.meta.url)));
    return;
  }
  if (url.pathname === '/health') {
    response.writeHead(200).end('ok');
    return;
  }
  if (['/readers.html', '/comix-reader.html', '/chapter-content.html', '/chapter-pipeline.html'].includes(url.pathname)) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(await readFile(new URL(`.${url.pathname}`, import.meta.url)));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/tracking.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
    return;
  }
  if (['/options.html', '/popup.html', '/offscreen.html'].includes(url.pathname) || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/chunks/') || url.pathname.startsWith('/demo/')) {
    if (url.pathname.includes('..')) { response.writeHead(400).end(); return; }
    try {
      const data = await readFile(new URL(`../../.output/chrome-mv3${url.pathname}`, import.meta.url));
      const type = url.pathname.endsWith('.html') ? 'text/html' : url.pathname.endsWith('.css') ? 'text/css'
        : url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'application/javascript';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(data);
    } catch { response.writeHead(404).end('Build output not found. Run npm run build.'); }
    return;
  }
  if (url.pathname === '/panel.svg') {
    const width = Math.min(2000, Math.max(1, Number(url.searchParams.get('width')) || 1000));
    const height = Math.min(20000, Math.max(1, Number(url.searchParams.get('height')) || 1600));
    const label = (url.searchParams.get('id') ?? 'PAGE').replace(/[^A-Za-z0-9-]/g, '').slice(0, 24);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 1600">
      <rect width="1000" height="1600" fill="#fffaf0"/>
      <path d="M20 20H980V1580H20Z M20 540H980 M20 1040H980 M510 540V1040" fill="none" stroke="#18364e" stroke-width="12"/>
      <path d="M40 500L300 290 480 500M540 1000L750 700 960 1000M50 1540L400 1160 940 1540" fill="#d1dfe8" stroke="#6e90a7" stroke-width="6"/>
      <circle cx="700" cy="270" r="90" fill="#a9c9c6"/>
      <rect x="120" y="240" width="340" height="176" rx="35" fill="white" stroke="#2873bd" stroke-width="2"/>
      <rect x="540" y="912" width="320" height="192" rx="35" fill="white" stroke="#2873bd" stroke-width="2"/>
      <text x="150" y="310" font-family="sans-serif" font-size="30">SOURCE ${label}</text>
      <text x="570" y="980" font-family="sans-serif" font-size="26">REFERENCE REGION</text>
      <text x="65" y="100" font-family="sans-serif" font-size="45" fill="#18364e">TRACKING LAB / ${label}</text>
      <text x="60" y="1490" font-family="sans-serif" font-size="30" fill="#18364e">1000 × 1600 / synthetic fixture</text>
    </svg>`;
    response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }).end(svg);
    return;
  }
  response.writeHead(404).end('Not found');
});
server.listen(port, '127.0.0.1', () => console.log(`Tracking fixtures: http://127.0.0.1:${port}`));
