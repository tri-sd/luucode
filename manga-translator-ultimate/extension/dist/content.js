"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/types.ts
  var defaults, imageLimit, errorText;
  var init_types = __esm({
    "src/types.ts"() {
      "use strict";
      defaults = {
        language: "auto",
        quality: "balanced",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        device: "auto",
        font: "regular",
        font_scale: 1,
        sfx: false
      };
      imageLimit = 22020096;
      errorText = (error) => error instanceof Error ? error.message : String(error);
    }
  });

  // src/bytes.ts
  async function responseBlob(response, limit = imageLimit) {
    if (!response.ok || !response.body) throw new Error("M\xE1y ch\u1EE7 \u1EA3nh t\u1EEB ch\u1ED1i y\xEAu c\u1EA7u.");
    if (Number(response.headers.get("content-length")) > limit) throw new Error("\u1EA2nh v\u01B0\u1EE3t qu\xE1 dung l\u01B0\u1EE3ng cho ph\xE9p.");
    const reader = response.body.getReader();
    const pieces = [];
    let size = 0;
    try {
      for (; ; ) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error("\u1EA2nh v\u01B0\u1EE3t qu\xE1 dung l\u01B0\u1EE3ng cho ph\xE9p.");
        pieces.push(new Uint8Array(value));
      }
    } finally {
      void reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
    return new Blob(pieces, { type: response.headers.get("content-type") || "application/octet-stream" });
  }
  async function base64(blob) {
    if (blob.size > imageLimit) throw new Error("\u1EA2nh v\u01B0\u1EE3t qu\xE1 21 MiB.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const pieces = [];
    for (let i = 0; i < bytes.length; i += 32768) pieces.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    return btoa(pieces.join(""));
  }
  function pngBlob(data) {
    const bytes = Uint8Array.from(atob(data), (letter) => letter.charCodeAt(0));
    return new Blob([bytes], { type: "image/png" });
  }
  var init_bytes = __esm({
    "src/bytes.ts"() {
      "use strict";
      init_types();
    }
  });

  // src/protocol.ts
  async function unwrap(promise) {
    const answer = await promise;
    if (!answer?.ok) throw new RequestError(answer?.error ?? "Extension kh\xF4ng ph\u1EA3n h\u1ED3i.", answer?.status);
    return answer.value;
  }
  function api(action, key, payload) {
    return unwrap(chrome.runtime.sendMessage({ type: "api", action, key, payload }));
  }
  function fetchImage(url) {
    return unwrap(chrome.runtime.sendMessage({ type: "image", url }));
  }
  async function job(action, payload, signal, progress, key) {
    let id;
    const abort = () => {
      if (id) void api("cancel", id).catch(() => {
      });
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      ({ id } = await api(action, key, payload));
      signal.throwIfAborted();
      for (; ; ) {
        const status = await api("job", id);
        signal.throwIfAborted();
        progress(status.phase);
        if (status.state === "done" && status.result) {
          const result = await api("result", status.result.key);
          signal.throwIfAborted();
          return result;
        }
        if (status.state === "error" || status.state === "cancelled") throw new RequestError(status.error ?? "T\xE1c v\u1EE5 th\u1EA5t b\u1EA1i.");
        await new Promise((resolve) => setTimeout(resolve, 650));
        signal.throwIfAborted();
      }
    } catch (error) {
      abort();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  var RequestError;
  var init_protocol = __esm({
    "src/protocol.ts"() {
      "use strict";
      RequestError = class extends Error {
        constructor(message, status) {
          super(message);
          this.status = status;
        }
      };
    }
  });

  // src/detector.ts
  function scan(root) {
    const adapter = adapters.find((a) => a.matches(new URL(location.href))) ?? generic;
    return Array.from(adapter.candidates(root)).filter((i) => adapter.accepts(i));
  }
  function ready(element) {
    return element instanceof HTMLImageElement ? element.complete && element.naturalWidth > 0 : element.width > 0 && element.height > 0;
  }
  function dimensions(element) {
    return element instanceof HTMLImageElement ? [element.naturalWidth, element.naturalHeight] : [element.width, element.height];
  }
  function imageSource(element) {
    return element instanceof HTMLImageElement ? element.currentSrc || element.src : `canvas:${element.width}x${element.height}`;
  }
  function asCanvas(element) {
    const [width, height] = dimensions(element);
    if (width * height > 25e6 || Math.max(width, height) > 35e3) throw new Error("\u1EA2nh qu\xE1 l\u1EDBn.");
    let canvas;
    if (element instanceof HTMLCanvasElement) {
      canvas = element;
    } else {
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(element, 0, 0, width, height);
    }
    return new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Chrome kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c pixel c\u1EE7a \u1EA3nh.")),
      "image/png"
    )).then(base64);
  }
  async function capture(element, url, signal) {
    if (element instanceof HTMLCanvasElement) return asCanvas(element);
    const parsed = new URL(url, location.href);
    if (!["http:", "https:", "blob:", "data:"].includes(parsed.protocol)) throw new Error("\u0110\u1ECBnh d\u1EA1ng \u0111\u1ECBa ch\u1EC9 \u1EA3nh kh\xF4ng \u0111\u01B0\u1EE3c h\u1ED7 tr\u1EE3.");
    const scoped = AbortSignal.any([signal, AbortSignal.timeout(12e3)]);
    try {
      const response = await fetch(parsed, { credentials: "same-origin", signal: scoped });
      return await base64(await responseBlob(response));
    } catch {
      signal.throwIfAborted();
      try {
        return await asCanvas(element);
      } catch {
        signal.throwIfAborted();
        if (["http:", "https:"].includes(parsed.protocol)) return fetchImage(parsed.href);
        throw new Error("Chrome kh\xF4ng cho ph\xE9p \u0111\u1ECDc \u1EA3nh n\xE0y.");
      }
    }
  }
  var generic, adapters;
  var init_detector = __esm({
    "src/detector.ts"() {
      "use strict";
      init_bytes();
      init_protocol();
      generic = {
        matches: () => true,
        candidates: (root) => root.querySelectorAll("img,canvas"),
        accepts: (element) => {
          if (element.hasAttribute("data-mtu-overlay") || element.closest('header,nav,footer,aside,[role="banner"],[role="advertisement"],[aria-hidden="true"]')) return false;
          if (/(^|[\s_-])(banner|advert|avatar|logo|thumbnail|sponsor|ads?)([\s_-]|$)/i.test(element.className.toString())) return false;
          const r = element.getBoundingClientRect();
          const [nw, nh] = dimensions(element);
          if (nw && nh && (nw < 240 || nh < 200 || nw / nh > 3.8)) return false;
          return r.width >= Math.min(250, innerWidth * 0.42) && (r.height >= 175 || !ready(element) && element instanceof HTMLImageElement && Boolean(element.dataset.src || element.src));
        }
      };
      adapters = [generic];
    }
  });

  // src/anchor.ts
  function setAttr(element, name, ours) {
    const before = element.getAttribute(name);
    element.setAttribute(name, ours);
    return { element, name, before, ours };
  }
  function attrsFor(img, url, density) {
    const srcset = url + " " + density.toFixed(7) + "x";
    const attrs = [];
    if (img.parentElement instanceof HTMLPictureElement) {
      for (const source of img.parentElement.querySelectorAll(":scope > source")) {
        attrs.push(setAttr(source, "srcset", srcset));
      }
    }
    if (img.hasAttribute("srcset") || Math.abs(density - 1) > 1e-3) attrs.push(setAttr(img, "srcset", srcset));
    attrs.push(setAttr(img, "src", url));
    return attrs;
  }
  function inlineAnchor(attrs, url) {
    return {
      valid: () => attrs.every((a) => a.element.getAttribute(a.name) === a.ours),
      restore() {
        for (const a of attrs) {
          if (a.element.getAttribute(a.name) !== a.ours) continue;
          if (a.before == null) a.element.removeAttribute(a.name);
          else a.element.setAttribute(a.name, a.before);
        }
        URL.revokeObjectURL(url);
      }
    };
  }
  function axes(element) {
    let matrix = new DOMMatrix();
    for (let parent = element; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      if (css.perspective !== "none") throw new Error("\u1EA2nh c\xF3 ph\xE9p chi\u1EBFu 3D ch\u01B0a h\u1ED7 tr\u1EE3 \u1EDF ch\u1EBF \u0111\u1ED9 canvas.");
      let next = new DOMMatrix(css.transform === "none" ? void 0 : css.transform);
      if (!next.is2D) throw new Error("\u1EA2nh c\xF3 ph\xE9p chi\u1EBFu 3D ch\u01B0a h\u1ED7 tr\u1EE3 \u1EDF ch\u1EBF \u0111\u1ED9 canvas.");
      const rotation = css.rotate.split(" ");
      if (rotation.length === 1 && rotation[0] !== "none") {
        const angle = rotation[0].endsWith("rad") ? parseFloat(rotation[0]) * 180 / Math.PI : rotation[0].endsWith("turn") ? parseFloat(rotation[0]) * 360 : parseFloat(rotation[0]);
        next = new DOMMatrix().rotate(angle).multiply(next);
      } else if (rotation.length > 1) {
        throw new Error("\u1EA2nh c\xF3 ph\xE9p xoay 3D ch\u01B0a h\u1ED7 tr\u1EE3 \u1EDF ch\u1EBF \u0111\u1ED9 canvas.");
      }
      const scale = css.scale === "none" ? [1, 1] : css.scale.split(" ").map(Number);
      next = new DOMMatrix().scale(scale[0], scale[1] ?? scale[0]).multiply(next);
      const zoom = Number(css.zoom) || 1;
      matrix = new DOMMatrix().scale(zoom).multiply(next).multiply(matrix);
    }
    return matrix;
  }
  function cssBox(element) {
    const css = getComputedStyle(element);
    const horizontal = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth);
    const vertical = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
    return {
      css,
      width: parseFloat(css.width) + (css.boxSizing === "border-box" ? 0 : horizontal),
      height: parseFloat(css.height) + (css.boxSizing === "border-box" ? 0 : vertical)
    };
  }
  function project(element, root) {
    const rect = element.getBoundingClientRect();
    const { css, width, height } = cssBox(element);
    const { a, b, c, d } = axes(element);
    const left = rect.left - Math.min(0, a * width, c * height, a * width + c * height);
    const top = rect.top - Math.min(0, b * width, d * height, b * width + d * height);
    const transform = new DOMMatrix([a, b, c, d, left - root.left, top - root.top]);
    if (![a, b, c, d, left, top, width, height].every(Number.isFinite) || Math.abs(a * d - b * c) < 1e-6)
      throw new Error("Kh\xF4ng x\xE1c \u0111\u1ECBnh \u0111\u01B0\u1EE3c t\u1ECDa \u0111\u1ED9 \u1EA3nh.");
    return { css, width, height, transform };
  }
  function clipToScrollAncestors(element, root, matrix) {
    let area;
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clipX = style.overflowX !== "visible";
      const clipY = style.overflowY !== "visible";
      if (!clipX && !clipY) continue;
      const rect = parent.getBoundingClientRect();
      const xScale = parent.offsetWidth ? rect.width / parent.offsetWidth : 1;
      const yScale = parent.offsetHeight ? rect.height / parent.offsetHeight : 1;
      const l = rect.left + parent.clientLeft * xScale, t = rect.top + parent.clientTop * yScale;
      const r = l + parent.clientWidth * xScale, b = t + parent.clientHeight * yScale;
      area ??= { left: -1e5, right: 1e5, top: -1e5, bottom: 1e5 };
      if (clipX) {
        area.left = Math.max(area.left, l);
        area.right = Math.min(area.right, r);
      }
      if (clipY) {
        area.top = Math.max(area.top, t);
        area.bottom = Math.min(area.bottom, b);
      }
    }
    if (!area) return "";
    if (area.left >= area.right || area.top >= area.bottom) return "inset(100%)";
    const inv = matrix.inverse();
    const points = [[area.left, area.top], [area.right, area.top], [area.right, area.bottom], [area.left, area.bottom]];
    return "polygon(" + points.map(([x, y]) => {
      const local = inv.transformPoint(new DOMPoint(x - root.left, y - root.top));
      return `${local.x}px ${local.y}px`;
    }).join(",") + ")";
  }
  async function canvasAnchor(image, blob, signal) {
    const bitmap = await createImageBitmap(blob);
    let layer;
    let canvas;
    try {
      let update2 = function() {
        const root = layer.getBoundingClientRect();
        const { css, width, height, transform } = project(image, root);
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        canvas.style.transform = transform.toString();
        canvas.style.objectFit = css.objectFit;
        canvas.style.objectPosition = css.objectPosition;
        canvas.style.padding = css.padding;
        canvas.style.borderWidth = css.borderWidth;
        canvas.style.borderStyle = css.borderStyle;
        canvas.style.borderColor = "transparent";
        canvas.style.borderRadius = css.borderRadius;
        canvas.style.clipPath = clipToScrollAncestors(image, root, transform);
      };
      var update = update2;
      signal.throwIfAborted();
      if (getComputedStyle(document.documentElement).transform !== "none") throw new Error("Trang bi\u1EBFn \u0111\u1ED5i ph\u1EA7n t\u1EED g\u1ED1c.");
      layer = document.createElement("div");
      layer.setAttribute("data-mtu-overlay", "");
      layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:10;display:block";
      canvas = document.createElement("canvas");
      canvas.setAttribute("data-mtu-overlay", "");
      canvas.setAttribute("aria-hidden", "true");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Kh\xF4ng t\u1EA1o \u0111\u01B0\u1EE3c canvas.");
      context.drawImage(bitmap, 0, 0);
      canvas.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;display:block;max-width:none;max-height:none;box-sizing:border-box;pointer-events:none";
      layer.append(canvas);
      document.documentElement.append(layer);
      update2();
      const source = imageSource(image);
      const before = image.style.getPropertyValue("opacity");
      const priority = image.style.getPropertyPriority("opacity");
      const visualOpacity = getComputedStyle(image).opacity;
      canvas.style.opacity = visualOpacity;
      image.style.setProperty("opacity", "0", "important");
      let raf = 0;
      const restore = () => {
        cancelAnimationFrame(raf);
        layer?.remove();
        if (image.style.getPropertyValue("opacity") === "0" && image.style.getPropertyPriority("opacity") === "important") {
          if (before) image.style.setProperty("opacity", before, priority);
          else image.style.removeProperty("opacity");
        }
        canvas.width = 0;
        canvas.height = 0;
      };
      const follow = () => {
        if (!image.isConnected || !layer?.isConnected) {
          restore();
          return;
        }
        try {
          update2();
        } catch {
          restore();
          return;
        }
        raf = requestAnimationFrame(follow);
      };
      raf = requestAnimationFrame(follow);
      return { valid: () => Boolean(layer?.isConnected && image.style.opacity === "0" && imageSource(image) === source), restore };
    } catch (error) {
      layer?.remove();
      throw error;
    } finally {
      bitmap.close();
    }
  }
  async function fastDecode(img) {
    let timer;
    try {
      await Promise.race([img.decode(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("\u0110\u1EE3i hi\u1EC3n th\u1ECB \u1EA3nh qu\xE1 l\xE2u.")), 1800);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function apply(image, data, signal) {
    signal.throwIfAborted();
    const blob = pngBlob(data);
    if (image instanceof HTMLImageElement) {
      const url = URL.createObjectURL(blob);
      const probe = new Image();
      probe.src = url;
      try {
        await fastDecode(probe);
        signal.throwIfAborted();
        const density = probe.naturalWidth / Math.max(1, image.naturalWidth);
        const anchor = inlineAnchor(attrsFor(image, url, density), url);
        try {
          await fastDecode(image);
          signal.throwIfAborted();
          if (!anchor.valid()) throw new Error("Website \u0111\xE3 \u0111\u1ED5i \u1EA3nh.");
          return anchor;
        } catch (error) {
          anchor.restore();
          throw error;
        }
      } catch {
        URL.revokeObjectURL(url);
        signal.throwIfAborted();
      }
    }
    return canvasAnchor(image, blob, signal);
  }
  var init_anchor = __esm({
    "src/anchor.ts"() {
      "use strict";
      init_bytes();
      init_detector();
    }
  });

  // src/content.ts
  var require_content = __commonJS({
    "src/content.ts"() {
      init_anchor();
      init_detector();
      init_protocol();
      init_types();
      function boot() {
        let settings = defaults;
        let active = false, paused = false, auto = true, showing = true;
        let chapter = location.href, generation = 0, phase = "";
        let currentWork;
        let single;
        let timer = 0;
        let reconnectAt = 0;
        let engine = "";
        const records = /* @__PURE__ */ new Map();
        function near(element) {
          const rect = element.getBoundingClientRect();
          return rect.bottom > -1300 && rect.top < innerHeight + 1300 && rect.right > -250 && rect.left < innerWidth + 250;
        }
        function schedule(delay = 45) {
          if (timer) return;
          timer = window.setTimeout(() => {
            timer = 0;
            refresh();
          }, delay);
        }
        const intersection = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const rec = records.get(entry.target);
            if (rec) rec.near = entry.isIntersecting;
          }
          schedule();
        }, { rootMargin: "1300px 250px" });
        const resize = new ResizeObserver(() => schedule());
        const mutation = new MutationObserver(() => schedule(100));
        mutation.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["src", "srcset", "sizes", "data-src", "data-srcset", "width", "height", "media"]
        });
        function restore(rec) {
          if (!rec.anchor) return;
          const stale = !rec.anchor.valid();
          rec.changing = true;
          rec.anchor.restore();
          rec.anchor = void 0;
          const settled = () => {
            rec.changing = false;
            schedule();
          };
          if (rec.element instanceof HTMLImageElement) {
            void Promise.race([rec.element.decode(), new Promise((resolve) => setTimeout(resolve, 1500))]).then(settled, settled);
          } else settled();
          if (stale || rec.element instanceof HTMLCanvasElement) rec.source = imageSource(rec.element);
        }
        function forget(rec) {
          if (currentWork?.record === rec) currentWork.abort.abort();
          intersection.unobserve(rec.element);
          resize.unobserve(rec.element);
          restore(rec);
          records.delete(rec.element);
        }
        function reset() {
          generation += 1;
          currentWork?.abort.abort();
          single = void 0;
          phase = "";
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
            } else if (!rec.changing && !rec.anchor && rec.source !== imageSource(element) || rec.anchor && !rec.anchor.valid()) {
              forget(rec);
            } else if (rec.anchor && (!rec.near || !showing)) {
              restore(rec);
            }
          }
          for (const element of scan(document)) {
            if (records.has(element)) continue;
            records.set(element, {
              element,
              source: imageSource(element),
              near: near(element),
              state: "new",
              canShow: false,
              issues: 0
            });
            intersection.observe(element);
            resize.observe(element);
          }
          for (const rec of records.values()) {
            if (rec.state === "new" && ready(rec.element)) rec.state = "ready";
          }
          dispatch();
        }
        function distance(rec) {
          const box = rec.element.getBoundingClientRect();
          return box.top <= innerHeight * 0.5 && box.bottom >= innerHeight * 0.5 ? 0 : Math.min(Math.abs(box.top - innerHeight * 0.5), Math.abs(box.bottom - innerHeight * 0.5));
        }
        function pick() {
          return [...records.values()].filter((r) => ready(r.element)).sort((a, b) => distance(a) - distance(b))[0];
        }
        function dispatch() {
          if (currentWork || document.hidden) return;
          if (showing && Date.now() >= reconnectAt) {
            const restoreNext = [...records.values()].find((r) => r.near && r.canShow && !r.changing && !r.anchor && r.result && !r.note && single?.record !== r);
            if (restoreNext) {
              launch(restoreNext, "display", false);
              return;
            }
          }
          if (paused || Date.now() < reconnectAt) return;
          if (single) {
            const { record, force } = single;
            single = void 0;
            if (record.changing) {
              single = { record, force };
              return;
            }
            if (records.get(record.element) === record) launch(record, "process", force);
            return;
          }
          if (!active) return;
          const candidates = [...records.values()].filter((r) => !r.changing && r.state === "ready" && (r.near || !auto));
          candidates.sort((a, b) => distance(a) - distance(b));
          if (candidates.length) launch(candidates[0], "process", false);
        }
        function launch(record, type, force) {
          const work = { record, abort: new AbortController(), generation, type };
          currentWork = work;
          void run(work, force).finally(() => {
            if (currentWork === work) {
              currentWork = void 0;
              phase = "";
            }
            schedule();
          });
        }
        function live(work) {
          return !work.abort.signal.aborted && work.generation === generation && chapter === location.href && records.get(work.record.element) === work.record && work.record.element.isConnected;
        }
        function assertCurrent(work, source) {
          if (!live(work) || source && imageSource(work.record.element) !== source)
            throw new DOMException("\u1EA2nh \u0111\xE3 \u0111\u1ED5i.", "AbortError");
        }
        function contextBefore(rec) {
          return [...records.values()].filter((other) => other.context && rec.element.compareDocumentPosition(other.element) & Node.DOCUMENT_POSITION_PRECEDING).sort((a, b) => a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).slice(-3).map((other) => other.context).join("\n").slice(-2e3);
        }
        async function run(work, force) {
          const rec = work.record;
          const signal = work.abort.signal;
          let source = rec.source;
          try {
            let result;
            if (work.type === "display") {
              result = await api("result", rec.result.key);
            } else {
              if (rec.anchor) {
                restore(rec);
                if (rec.element instanceof HTMLImageElement) await rec.element.decode();
                rec.source = imageSource(rec.element);
              }
              source = imageSource(rec.element);
              rec.note = void 0;
              assertCurrent(work);
              phase = "\u0110\u1ECDc \u1EA3nh truy\u1EC7n";
              const image2 = await capture(rec.element, source, signal);
              assertCurrent(work, source);
              result = await job("submit", { image: image2, settings, context: contextBefore(rec), force }, signal, (value) => {
                phase = value;
              });
            }
            assertCurrent(work, source);
            const { image, regions, ...metadata } = result;
            rec.result = metadata;
            rec.source = source;
            rec.issues = regions.filter((r) => r.issue).length;
            rec.context = regions.filter((r) => r.text && !r.issue).slice(-8).map((r) => r.source + " \u2192 " + r.text).join("\n");
            rec.canShow = Boolean(image);
            rec.state = result.rendered ? "done" : "error";
            rec.note = result.rendered ? void 0 : regions.length ? regions.find((r) => r.issue)?.issue ?? "Ch\u01B0a k\u1EBFt xu\u1EA5t \u0111\u01B0\u1EE3c ch\u1EEF." : "Kh\xF4ng ph\xE1t hi\u1EC7n v\xF9ng ch\u1EEF.";
            engine = "\u0110\xE3 k\u1EBFt n\u1ED1i";
            if (!image || !rec.near || !showing) return;
            const [w, h] = dimensions(rec.element);
            if (w && h && Math.abs(w / h - result.width / result.height) > 6e-3)
              throw new Error("K\xEDch th\u01B0\u1EDBc \u1EA3nh hi\u1EC3n th\u1ECB kh\xE1c \u1EA3nh t\u1EA3i v\u1EC1.");
            rec.changing = true;
            let anchor;
            try {
              anchor = await apply(rec.element, image, signal);
            } finally {
              rec.changing = false;
            }
            if (!live(work) || !showing || !rec.near) {
              anchor.restore();
              return;
            }
            rec.anchor = anchor;
          } catch (error) {
            if (!live(work) || error instanceof DOMException && error.name === "AbortError") return;
            if (error instanceof RequestError && (error.status === 0 || error.status === 429 || error.status === 503)) {
              reconnectAt = Date.now() + 5e3;
              if (work.type === "process") {
                rec.state = "ready";
                if (!active || force) single = { record: rec, force };
              }
              engine = errorText(error);
            } else if (work.type === "display" && error instanceof RequestError && error.status === 404) {
              rec.result = void 0;
              rec.canShow = false;
              rec.state = "ready";
            } else {
              rec.note = errorText(error);
              rec.state = "error";
            }
          }
        }
        function status() {
          const states = [...records.values()];
          const hosts = /* @__PURE__ */ new Set();
          for (const rec of states) {
            try {
              const url = new URL(rec.source);
              if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) hosts.add(url.origin);
            } catch {
            }
          }
          return {
            found: states.length,
            done: states.filter((r) => r.state === "done").length,
            waiting: states.filter((r) => r !== currentWork?.record && (r.state === "new" || r.state === "ready")).length,
            processing: currentWork?.type === "process" && !currentWork.abort.signal.aborted ? 1 : 0,
            errors: states.filter((r) => r.state === "error").length,
            regions: states.reduce((n, r) => n + r.issues, 0),
            phase,
            engine,
            active,
            paused,
            auto,
            showing,
            recent: states.filter((r) => r.note).slice(-5).map((r) => r.note),
            hosts: [...hosts].slice(0, 12)
          };
        }
        async function handle(action, value) {
          refresh();
          switch (action) {
            case "chapter":
              active = true;
              paused = false;
              reconnectAt = 0;
              await chrome.runtime.sendMessage({ type: "reader-state", active: auto });
              for (const rec of records.values()) {
                if (rec.state === "error" && !rec.result) {
                  rec.state = "ready";
                  rec.note = void 0;
                }
              }
              break;
            case "resume":
              paused = false;
              reconnectAt = 0;
              if (!active && !single) active = true;
              if (active) await chrome.runtime.sendMessage({ type: "reader-state", active: auto });
              break;
            case "pause":
              paused = true;
              if (currentWork?.type === "process" && !active) single = { record: currentWork.record, force: false };
              currentWork?.abort.abort();
              await chrome.runtime.sendMessage({ type: "reader-state", active: false });
              break;
            case "auto":
              auto = Boolean(value);
              await chrome.runtime.sendMessage({ type: "reader-state", active: active && auto && !paused });
              break;
            case "show":
              showing = Boolean(value);
              if (!showing) {
                if (currentWork?.type === "display") currentWork.abort.abort();
                for (const rec of records.values()) restore(rec);
              }
              break;
            case "current":
            case "retry": {
              const rec = pick();
              if (!rec) throw new Error("Kh\xF4ng c\xF3 \u1EA3nh truy\u1EC7n \u0111\xE3 t\u1EA3i trong v\xF9ng \u0111\u1ECDc.");
              if (action === "current" && rec.state === "done") break;
              reconnectAt = 0;
              paused = false;
              rec.note = void 0;
              currentWork?.abort.abort();
              single = { record: rec, force: action === "retry" };
              break;
            }
            case "edit": {
              const rec = pick();
              if (!rec?.result) throw new Error("H\xE3y d\u1ECBch \u1EA3nh hi\u1EC7n t\u1EA1i tr\u01B0\u1EDBc khi ch\u1EC9nh s\u1EEDa.");
              await chrome.runtime.sendMessage({ type: "edit-window", key: rec.result.key });
              break;
            }
            case "refresh":
              for (const rec of records.values()) {
                if (value !== rec.result?.key) continue;
                if (currentWork?.record === rec) currentWork.abort.abort();
                restore(rec);
                rec.note = void 0;
                rec.canShow = true;
              }
              break;
            case "status":
              break;
            default:
              throw new Error("L\u1EC7nh kh\xF4ng h\u1EE3p l\u1EC7.");
          }
          schedule();
          return status();
        }
        chrome.runtime.onMessage.addListener((message, sender, reply) => {
          if (sender.id !== chrome.runtime.id || message?.type !== "command") return;
          void handle(message.action, message.value).then(
            (value) => reply({ ok: true, value }),
            (error) => reply({ ok: false, error: errorText(error) })
          );
          return true;
        });
        const init = async () => {
          const [prefs, reader] = await Promise.all([
            chrome.runtime.sendMessage({ type: "settings" }),
            chrome.runtime.sendMessage({ type: "reader-state" })
          ]);
          const { auto: preferredAuto, ...profile } = prefs?.value ?? {};
          settings = { ...defaults, ...profile };
          auto = preferredAuto ?? true;
          active ||= reader?.value === true && auto;
          schedule();
        };
        chrome.runtime.onMessage.addListener((message, sender) => {
          if (sender.id !== chrome.runtime.id || message?.type !== "profile") return;
          const { auto: newAuto, ...profile } = message.newValue ?? {};
          const { auto: prevAuto, ...before } = message.oldValue ?? {};
          if (newAuto !== prevAuto) auto = newAuto ?? true;
          settings = { ...defaults, ...profile };
          if (JSON.stringify(profile) !== JSON.stringify(before)) reset();
          schedule();
        });
        document.addEventListener("load", () => schedule(), true);
        document.addEventListener("visibilitychange", () => schedule());
        document.addEventListener("scroll", () => schedule(80), { passive: true, capture: true });
        window.addEventListener("pageshow", () => schedule());
        window.addEventListener("pagehide", () => {
          currentWork?.abort.abort();
        });
        window.setInterval(() => {
          if (chapter !== location.href || reconnectAt && Date.now() >= reconnectAt) {
            reconnectAt = 0;
            schedule();
          }
        }, 450);
        void init().catch(() => schedule());
      }
      var scope = globalThis;
      if (!scope.__mtuReader) {
        scope.__mtuReader = true;
        boot();
      }
    }
  });
  require_content();
})();
