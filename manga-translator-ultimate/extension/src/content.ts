import { ChapterCollection, type CollectedPage, type PageResult } from './collection';
import { apply, type Anchor } from './anchor';
import { capture, dimensions, imageSource, ready, scan, type MangaImage } from './detector';
import { api, job, RequestError } from './protocol';
import { defaults, errorText, type Command, type Reply, type Settings, type Status, type Summary } from './types';

type RecordState = {
  element: MangaImage; source: string; near: boolean; state: 'new' | 'ready' | 'done' | 'error';
  result?: PageResult; anchor?: Anchor; note?: string;
  canShow: boolean; context?: string; issues: number; changing?: boolean;
};
type Work = { record: RecordState; abort: AbortController; generation: number; type: 'process' | 'display' };

function boot() {
  let settings: Settings = defaults;
  let active = false, paused = false, auto = true, showing = true;
  let chapter = location.href, generation = 0, phase = '';
  let currentWork: Work | undefined;
  let displayWork: Work | undefined;
  let single: {record: RecordState; force: boolean} | undefined;
  let timer = 0;
  let reconnectAt = 0;
  let engine = '';
  const records = new Map<MangaImage, RecordState>();
  const collection = new ChapterCollection();
  let batch: Status['batch'] = 'idle';
  let batchWork: AbortController | undefined;
  let batchPage: CollectedPage | undefined;

  function near(element: MangaImage) {
    const rect = element.getBoundingClientRect();
    return rect.bottom > -1300 && rect.top < innerHeight+1300 && rect.right > -250 && rect.left < innerWidth+250;
  }

  function schedule(delay = 45) {
    if (timer) return;
    timer = window.setTimeout(() => { timer = 0; refresh(); }, delay);
  }

  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const rec = records.get(entry.target as MangaImage);
      if (rec) rec.near = entry.isIntersecting;
    }
    schedule();
  }, {rootMargin: '1300px 250px'});
  const resize = new ResizeObserver(() => schedule());
  const mutation = new MutationObserver(() => schedule(100));
  mutation.observe(document.documentElement, {childList: true, subtree: true, attributes: true,
    attributeFilter: ['src','srcset','sizes','data-src','data-srcset','width','height','media']});

  function restore(rec: RecordState) {
    if (!rec.anchor) return;
    const stale = !rec.anchor.valid();
    rec.changing = true;
    rec.anchor.restore();
    rec.anchor = undefined;
    const settled = () => { rec.changing = false; schedule(); };
    if (rec.element instanceof HTMLImageElement) {
      void Promise.race([rec.element.decode(), new Promise(resolve => setTimeout(resolve,1500))])
        .then(settled,settled);
    } else settled();
    if (stale || rec.element instanceof HTMLCanvasElement) rec.source = imageSource(rec.element);
  }

  function forget(rec: RecordState) {
    if (currentWork?.record === rec) currentWork.abort.abort();
    if (displayWork?.record === rec) displayWork.abort.abort();
    intersection.unobserve(rec.element);
    resize.unobserve(rec.element);
    restore(rec);
    records.delete(rec.element);
  }

  function reset(clearCollection = true) {
    generation += 1;
    currentWork?.abort.abort();
    displayWork?.abort.abort();
    batchWork?.abort();
    if (clearCollection) {
      batch = 'idle';
      collection.clear();
    } else {
      if (batch === 'complete') batch = 'collecting';
      for (const page of collection.pages.values()) {
        if (!page.result) continue;
        page.state = 'waiting';
        page.result = undefined;
        page.note = undefined;
      }
    }
    single = undefined;
    phase = '';
    for (const rec of records.values()) forget(rec);
  }

  function pageChanged() {
    if (chapter === location.href) return;
    chapter = location.href;
    if (!auto) active = false;
    reset();
  }

  function refresh() {
    pageChanged();
    for (const [element, rec] of records) {
      if (!element.isConnected) {
        forget(rec);
      } else if ((!rec.changing && !rec.anchor && rec.source !== imageSource(element)) || (rec.anchor && !rec.anchor.valid())) {
        forget(rec);
      } else if (rec.anchor && (!showing || (!rec.near && rec.anchor.kind === 'canvas'))) {
        restore(rec);
      }
    }
    const candidates = scan(document, collection.widths);
    for (const element of candidates) {
      if (records.has(element)) continue;
      records.set(element, {element, source: imageSource(element), near: near(element), state:'new',
        canShow:false, issues:0});
      intersection.observe(element);
      resize.observe(element);
    }
    for (const rec of records.values()) {
      if (rec.state === 'new' && ready(rec.element)) rec.state = 'ready';
    }
    if (batch === 'collecting') remember(candidates);
    for (const rec of records.values()) {
      const result = collection.lookup(rec.element, rec.source)?.result;
      if (result && result !== rec.result && !rec.changing && rec !== currentWork?.record) recordPage(rec, result);
    }
    // Keep nearby replacements attached within an offscreen decoded-size budget.
    let offscreenBytes = 0;
    const offscreen = [...records.values()].filter(r => !r.near && r.anchor?.kind === 'image' && r.result)
      .sort((a,b) => distance(a)-distance(b));
    for (const rec of offscreen) {
      const bytes = rec.result!.width*rec.result!.height*4;
      if (offscreenBytes+bytes > 80*1024*1024) restore(rec);
      else offscreenBytes += bytes;
    }
    dispatch();
  }

  function distance(rec: RecordState) {
    const box = rec.element.getBoundingClientRect();
    return box.top <= innerHeight*.5 && box.bottom >= innerHeight*.5 ? 0 :
      Math.min(Math.abs(box.top-innerHeight*.5), Math.abs(box.bottom-innerHeight*.5));
  }

  function pick(): RecordState | undefined {
    return [...records.values()].filter(r => ready(r.element)).sort((a,b) => distance(a)-distance(b))[0];
  }

  function remember(candidates = scan(document, collection.widths)) {
    for (const element of candidates) {
      const rec = records.get(element);
      if (!rec || rec.changing || !ready(element)) continue;
      collection.remember(element, rec.source, schedule);
      const entry = collection.lookup(element, rec.source);
      if (entry?.state === 'waiting' && rec.state === 'done' && rec.result) {
        entry.result = rec.result;
        entry.state = 'done';
      }
    }
  }

  function getPageResult(result: Summary): PageResult {
    const {image, regions, ...metadata} = result;
    const issues = regions.filter(region => region.issue);
    return {
      ...metadata, issues: issues.length,
      context: regions.filter(r => r.text && !r.issue).slice(-8).map(r => r.source+' → '+r.text).join('\n'),
      note: result.rendered ? undefined : issues[0]?.issue ?? 'Không phát hiện vùng chữ có thể chèn.',
    };
  }

  function recordPage(rec: RecordState, result: PageResult) {
    rec.result = result;
    rec.issues = result.issues;
    rec.context = result.context;
    rec.canShow = result.rendered > 0;
    rec.state = rec.canShow ? 'done' : 'error';
    rec.note = result.note;
  }

  function dispatchBatch() {
    const page = [...collection.pages.values()].find(item => item.state === 'waiting' || item.state === 'capturing');
    if (!page) { batch = 'complete'; return; }
    if (page.state === 'capturing') return;
    const abort = new AbortController();
    const epoch = generation;
    const alive = () => epoch === generation && !abort.signal.aborted && chapter === location.href;
    batchWork = abort;
    batchPage = page;
    void (async () => {
      try {
        phase = 'Đọc ảnh đã thu thập';
        const element = page.element.deref();
        const liveRecord = element && records.get(element);
        const usable = element?.isConnected && liveRecord?.source === page.source && !liveRecord?.anchor &&
          imageSource(element) === page.source ? element : null;
        const image = page.snapshot ?? await capture(usable, page.source, abort.signal);
        if (!alive()) return;
        const entries = [...collection.pages.values()];
        const previous = entries.slice(0,entries.indexOf(page));
        const context = previous.filter(item => item.result?.context).slice(-3)
          .map(item => item.result!.context).join('\n').slice(-2000);
        const result = await job('submit', {image, settings, context, force: Boolean(page.result)}, abort.signal, value => { phase = value; });
        if (!alive()) return;
        page.result = getPageResult(result);
        page.state = result.rendered ? 'done' : 'error';
        page.note = page.result.note;
        engine = 'Đã kết nối';
      } catch (error) {
        if (!alive()) return;
        if (error instanceof RequestError && (error.status === 0 || error.status === 429 || error.status === 503)) {
          reconnectAt = Date.now()+5000;
          engine = errorText(error);
        } else {
          page.state = 'error';
          page.note = errorText(error);
        }
      } finally {
        if (batchWork === abort) { batchWork = undefined; batchPage = undefined; phase = ''; }
        schedule();
      }
    })();
  }

  function dispatch() {
    if (!document.hidden && !displayWork && showing && Date.now() >= reconnectAt) {
      const restoreNext = [...records.values()].find(r => r !== currentWork?.record && r.near && r.canShow && !r.changing && !r.anchor && r.result && !r.note && single?.record !== r);
      if (restoreNext) launch(restoreNext, 'display', false);
    }
    if (currentWork || batchWork || paused || Date.now() < reconnectAt) return;
    if (batch === 'running' && !single) { dispatchBatch(); return; }
    if (document.hidden) return;
    if (single) {
      const {record, force} = single;
      single = undefined;
      if (record.changing || displayWork?.record === record) { single = {record, force}; return; }
      if (records.get(record.element) === record) launch(record, 'process', force);
      return;
    }
    if (!active) return;
    const candidates = [...records.values()].filter(r => r !== displayWork?.record && !r.changing && r.state === 'ready' && (r.near || !auto));
    candidates.sort((a,b) => distance(a)-distance(b));
    if (candidates.length) launch(candidates[0], 'process', false);
  }

  function launch(record: RecordState, type: Work['type'], force: boolean) {
    const work = {record, abort: new AbortController(), generation, type};
    if (type === 'display') displayWork = work;
    else currentWork = work;
    void run(work, force).finally(() => {
      if (displayWork === work) displayWork = undefined;
      if (currentWork === work) { currentWork = undefined; phase = ''; }
      schedule();
    });
  }

  function live(work: Work) {
    return !work.abort.signal.aborted && work.generation === generation && chapter === location.href &&
      records.get(work.record.element) === work.record && work.record.element.isConnected;
  }

  function assertCurrent(work: Work, source?: string) {
    if (!live(work) || (source && imageSource(work.record.element) !== source))
      throw new DOMException('Ảnh đã đổi.', 'AbortError');
  }

  function contextBefore(rec: RecordState) {
    return [...records.values()]
      .filter(other => other.context && rec.element.compareDocumentPosition(other.element) & Node.DOCUMENT_POSITION_PRECEDING)
      .sort((a,b) => a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      .slice(-3).map(other => other.context).join('\n').slice(-2000);
  }

  async function run(work: Work, force: boolean) {
    const rec = work.record;
    const signal = work.abort.signal;
    let source = rec.source;
    try {
      let result: Summary;
      if (work.type === 'display') {
        result = await api<Summary>('result', rec.result!.key);
      } else {
        if (rec.anchor) {
          restore(rec);
          if (rec.element instanceof HTMLImageElement) await rec.element.decode();
          rec.source = imageSource(rec.element);
        }
        source = imageSource(rec.element);
        rec.note = undefined;
        assertCurrent(work);
        phase = 'Đọc ảnh truyện';
        const image = await capture(rec.element, source, signal);
        assertCurrent(work, source);
        result = await job('submit', {image, settings, context:contextBefore(rec), force}, signal, value => { phase = value; });
      }
      assertCurrent(work, source);
      const {image} = result;
      const pageResult = getPageResult(result);
      rec.source = source;
      recordPage(rec, pageResult);
      const collected = collection.lookup(rec.element, source);
      if (collected) {
        collected.result = pageResult;
        collected.state = result.rendered ? 'done' : 'error';
        collected.note = pageResult.note;
      }
      engine = 'Đã kết nối';
      if (!image || !rec.near || !showing) return;
      const [w,h] = dimensions(rec.element);
      if (w && h && Math.abs(w/h-result.width/result.height) > .006)
        throw new Error('Kích thước ảnh hiển thị khác ảnh tải về.');
      rec.changing = true;
      let anchor: Anchor;
      try { anchor = await apply(rec.element, image, signal); }
      finally { rec.changing = false; }
      if (!live(work) || !showing || !rec.near) { anchor.restore(); return; }
      rec.anchor = anchor;
    } catch (error) {
      if (!live(work) || (error instanceof DOMException && error.name === 'AbortError')) return;
      if (error instanceof RequestError && (error.status === 0 || error.status === 429 || error.status === 503)) {
        reconnectAt = Date.now()+5000;
        if (work.type === 'process') {
          rec.state = 'ready';
          if (!active || force) single = {record:rec, force};
        }
        engine = errorText(error);
      } else if (work.type === 'display' && error instanceof RequestError && error.status === 404) {
        const collected = collection.lookup(rec.element, rec.source);
        if (collected) {
          collected.result = undefined;
          collected.state = 'error';
          collected.note = 'Ảnh dịch đã hết hạn trong cache. Hãy dịch lại ảnh.';
        }
        rec.result = undefined;
        rec.canShow = false;
        rec.state = 'ready';
      } else {
        rec.note = errorText(error);
        rec.state = 'error';
      }
    }
  }

  function status(): Status {
    const states = [...records.values()];
    const hosts = new Set<string>();
    const queue = [...collection.pages.values()];
    const progress = batch === 'idle' ? states : queue;
    for (const entry of [...states, ...queue]) {
      try {
        const url = new URL(entry.source);
        if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) hosts.add(url.origin);
      } catch { /* No request is sent for an unset source. */ }
    }
    return {
      batch, collected:queue.length,
      found:progress.length, done:progress.filter(r => r.state === 'done').length,
      waiting:progress.filter(r => r !== currentWork?.record && r !== batchPage &&
        (r.state === 'new' || r.state === 'ready' || r.state === 'waiting' || r.state === 'capturing')).length,
      processing:(currentWork && !currentWork.abort.signal.aborted) || (batchWork && !batchWork.signal.aborted) ? 1 : 0,
      errors:progress.filter(r => r.state === 'error').length,
      regions:batch === 'idle' ? states.reduce((n,r) => n+r.issues,0) : queue.reduce((n,r) => n+(r.result?.issues ?? 0),0),
      phase, engine, active, paused, auto, showing,
      recent:progress.filter(r => r.note).slice(-5).map(r => r.note!), hosts:[...hosts].slice(0,12),
    };
  }

  async function handle(action: Command, value: unknown) {
    refresh();
    switch (action) {
      case 'collect':
        if (batch === 'running') break;
        active = false; paused = false;
        currentWork?.abort.abort();
        single = undefined;
        batch = 'collecting';
        remember();
        await chrome.runtime.sendMessage({type:'reader-state', active:false});
        break;
      case 'batch':
        if (batch === 'collecting' && collection.pages.size === 0)
          throw new Error('Chưa có ảnh đã tải. Cuộn qua chương để thu thập ảnh.');
        if (batch === 'idle') break;
        if (batch !== 'collecting') {
          for (const entry of collection.pages.values()) {
            if (entry.state === 'error' && (entry.snapshot || !/^(blob:|canvas:)/.test(entry.source))) {
              entry.state = 'waiting';
              entry.note = undefined;
            }
          }
        }
        active = false; paused = false; reconnectAt = 0;
        batch = 'running';
        break;
      case 'chapter':
        if (batch !== 'idle' && batch !== 'complete') break;
        if (batch === 'complete') { batch = 'idle'; collection.clear(); }
        active = true; paused = false; reconnectAt = 0;
        await chrome.runtime.sendMessage({type:'reader-state', active:auto});
        for (const rec of records.values()) {
          if (rec.state === 'error' && !rec.result) { rec.state = 'ready'; rec.note = undefined; }
        }
        break;
      case 'resume':
        paused = false; reconnectAt = 0;
        if (batch !== 'idle') break;
        if (!active && !single) active = true;
        if (active) await chrome.runtime.sendMessage({type:'reader-state', active:auto});
        break;
      case 'pause':
        paused = true;
        batchWork?.abort();
        if (currentWork?.type === 'process' && !active && batch === 'idle') single = {record:currentWork.record, force:false};
        currentWork?.abort.abort();
        await chrome.runtime.sendMessage({type:'reader-state', active:false});
        break;
      case 'auto':
        auto = Boolean(value);
        await chrome.runtime.sendMessage({type:'reader-state', active:active && auto && !paused});
        break;
      case 'show':
        showing = Boolean(value);
        if (!showing) {
          displayWork?.abort.abort();
          for (const rec of records.values()) restore(rec);
        }
        break;
      case 'current':
      case 'retry': {
        const rec = pick();
        if (!rec) throw new Error('Không có ảnh truyện đã tải trong vùng đọc.');
        if (action === 'current' && rec.state === 'done') break;
        reconnectAt = 0; paused = false; rec.note = undefined;
        currentWork?.abort.abort();
        single = {record:rec, force:action === 'retry'};
        break;
      }
      case 'edit': {
        const rec = pick();
        if (!rec?.result) throw new Error('Hãy dịch ảnh hiện tại trước khi chỉnh sửa.');
        await chrome.runtime.sendMessage({type:'edit-window', key:rec.result.key});
        break;
      }
      case 'refresh':
        for (const rec of records.values()) {
          if (value !== rec.result?.key) continue;
          if (currentWork?.record === rec) currentWork.abort.abort();
          if (displayWork?.record === rec) displayWork.abort.abort();
          restore(rec); rec.note = undefined; rec.canShow = true;
        }
        break;
      case 'status':
        break;
      default: throw new Error('Lệnh không hợp lệ.');
    }
    schedule();
    return status();
  }

  chrome.runtime.onMessage.addListener((message, sender, reply: (response: Reply<Status>) => void) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'command') return;
    void handle(message.action, message.value).then(value => reply({ok:true, value}),
      error => reply({ok:false, error:errorText(error)}));
    return true;
  });

  const init = async () => {
    const [prefs, reader] = await Promise.all([
      chrome.runtime.sendMessage({type:'settings'}), chrome.runtime.sendMessage({type:'reader-state'}),
    ]);
    const {auto: preferredAuto, ...profile} = prefs?.value ?? {};
    settings = {...defaults, ...profile};
    auto = preferredAuto ?? true;
    active ||= reader?.value === true && auto;
    schedule();
  };
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'profile') return;
    const {auto: newAuto, ...profile} = message.newValue ?? {};
    const {auto: prevAuto, ...before} = message.oldValue ?? {};
    if (newAuto !== prevAuto) auto = newAuto ?? true;
    settings = {...defaults, ...profile};
    if (JSON.stringify(profile) !== JSON.stringify(before)) reset(false);
    schedule();
  });
  document.addEventListener('load', () => schedule(), true);
  document.addEventListener('visibilitychange', () => schedule());
  document.addEventListener('scroll', () => schedule(80), {passive:true, capture:true});
  window.addEventListener('pageshow', () => schedule());
  const navigation = (window as Window & {navigation?: EventTarget}).navigation;
  navigation?.addEventListener('currententrychange', () => { pageChanged(); schedule(); });
  window.addEventListener('pagehide', () => { currentWork?.abort.abort(); displayWork?.abort.abort(); batchWork?.abort(); });
  window.setInterval(() => {
    if (chapter !== location.href || (reconnectAt && Date.now() >= reconnectAt)) {
      reconnectAt = 0;
      schedule();
    }
  }, 450);
  void init().catch(() => schedule());
}

const scope = globalThis as typeof globalThis & {__mtuReader?: boolean};
if (!scope.__mtuReader) {
  scope.__mtuReader = true;
  boot();
}
