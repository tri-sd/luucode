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
  var imageLimit, errorText;
  var init_types = __esm({
    "src/types.ts"() {
      "use strict";
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
  var init_bytes = __esm({
    "src/bytes.ts"() {
      "use strict";
      init_types();
    }
  });

  // src/worker.ts
  var require_worker = __commonJS({
    "src/worker.ts"() {
      init_bytes();
      init_types();
      var endpoint = "http://127.0.0.1:18787";
      var routes = {
        health: ["GET", "/health"],
        submit: ["POST", "/jobs"],
        job: ["GET", "/jobs/", /^[a-f0-9]{32}$/],
        cancel: ["DELETE", "/jobs/", /^[a-f0-9]{32}$/],
        result: ["GET", "/result/", /^[a-f0-9]{64}$/],
        edit: ["POST", "/edit/", /^[a-f0-9]{64}$/],
        original: ["GET", "/original/", /^[a-f0-9]{64}$/],
        glossary: ["GET", "/glossary"],
        saveGlossary: ["POST", "/glossary"],
        clear: ["DELETE", "/cache"]
      };
      void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {
      });
      async function local(action, key, payload) {
        if (!Object.hasOwn(routes, action)) throw new Error("L\u1EC7nh kh\xF4ng h\u1EE3p l\u1EC7.");
        const [method, route, keyFormat] = routes[action];
        if (keyFormat && (typeof key !== "string" || !keyFormat.test(key))) throw new Error("M\xE3 t\xE1c v\u1EE5 kh\xF4ng h\u1EE3p l\u1EC7.");
        const { token } = await chrome.storage.local.get("token");
        if (typeof token !== "string" || !/^[\w-]{43}$/.test(token)) throw new Error("Nh\u1EADp m\xE3 gh\xE9p n\u1ED1i trong C\xE0i \u0111\u1EB7t.");
        let response;
        try {
          response = await fetch(endpoint + route + (keyFormat ? key : ""), {
            method,
            mode: "cors",
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            headers: { Authorization: "Bearer " + token, ...method === "POST" ? { "Content-Type": "application/json" } : {} },
            body: method === "POST" ? JSON.stringify(payload) : void 0,
            signal: AbortSignal.timeout(24e3)
          });
        } catch {
          return { ok: false, error: "Kh\xF4ng k\u1EBFt n\u1ED1i \u0111\u01B0\u1EE3c Local Engine. Ki\u1EC3m tra Start Engine r\u1ED3i th\u1EED l\u1EA1i.", status: 0 };
        }
        const data = await response.json();
        if (!response.ok) return { ok: false, error: typeof data.detail === "string" ? data.detail : "Y\xEAu c\u1EA7u th\u1EA5t b\u1EA1i.", status: response.status };
        return { ok: true, value: data };
      }
      function publicImage(url) {
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !["localhost", "localhost."].includes(url.hostname) && url.hostname.includes(".") && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && !url.hostname.endsWith(".local");
      }
      async function cdnImage(input, sender) {
        if (!sender.tab || typeof input !== "string" || input.length > 8192) throw new Error("\u0110\u1ECBa ch\u1EC9 \u1EA3nh kh\xF4ng h\u1EE3p l\u1EC7.");
        const url = new URL(input);
        if (!publicImage(url) || !await chrome.permissions.contains({ origins: [url.origin + "/*"] })) {
          throw new Error("Website ch\u01B0a c\u1EA5p quy\u1EC1n \u0111\u1ECDc \u1EA3nh t\u1EEB " + url.origin + ".");
        }
        const response = await fetch(url.href, {
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(12e3)
        });
        if (!response.headers.get("content-type")?.toLowerCase().startsWith("image/")) {
          throw new Error("CDN kh\xF4ng tr\u1EA3 v\u1EC1 d\u1EEF li\u1EC7u \u1EA3nh.");
        }
        return base64(await responseBlob(response));
      }
      async function registerReader(pattern) {
        if (!await chrome.permissions.contains({ origins: [pattern] })) return;
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pattern)));
        const id = "reader-" + Array.from(digest.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
        const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
        if (!existing.length) {
          try {
            await chrome.scripting.registerContentScripts([{ id, matches: [pattern], js: ["content.js"], runAt: "document_idle" }]);
          } catch (error) {
            if (!(await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length) throw error;
          }
        }
      }
      chrome.permissions.onAdded.addListener((permissions) => {
        for (const pattern of permissions.origins ?? []) {
          const key = "reader-permission:" + pattern;
          void chrome.storage.session.get(key).then((values) => {
            if (Date.now() - (values[key] ?? 0) < 3e5) return registerReader(pattern);
          }).catch(() => {
          });
        }
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes.settings) return;
        const { oldValue, newValue } = changes.settings;
        void chrome.tabs.query({}).then((tabs) => Promise.allSettled(tabs.filter((tab) => tab.id != null).map((tab) => chrome.tabs.sendMessage(tab.id, { type: "profile", oldValue, newValue })))).catch(() => {
        });
      });
      async function execute(message, sender) {
        if (message.type === "api") {
          if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL("")) && !["submit", "job", "cancel", "result"].includes(message.action)) throw new Error("L\u1EC7nh d\xE0nh cho giao di\u1EC7n extension.");
          return local(message.action, message.key, message.payload);
        }
        if (message.type === "image") return { ok: true, value: await cdnImage(message.url, sender) };
        if (message.type === "reader-permission" && sender.url?.startsWith(chrome.runtime.getURL(""))) {
          const url = new URL(message.site);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error("Website kh\xF4ng h\u1EE3p l\u1EC7.");
          const pattern = url.protocol + "//" + url.hostname + "/*";
          await chrome.storage.session.set({ ["reader-permission:" + pattern]: Date.now() });
          await registerReader(pattern);
          return { ok: true, value: null };
        }
        if (message.type === "reader-state" && sender.tab?.id && sender.url) {
          const origin = new URL(sender.url).origin;
          const key = "reader:" + sender.tab.id + ":" + origin;
          if (typeof message.active === "boolean") await chrome.storage.session.set({ [key]: message.active });
          return { ok: true, value: (await chrome.storage.session.get(key))[key] === true };
        }
        if (message.type === "settings") {
          const { settings } = await chrome.storage.local.get("settings");
          return { ok: true, value: settings ?? {} };
        }
        if (message.type === "edit-window" && sender.tab?.id && /^[0-9a-f]{64}$/.test(message.key)) {
          const url = chrome.runtime.getURL("editor.html") + "?" + new URLSearchParams({
            key: message.key,
            tab: String(sender.tab.id)
          });
          await chrome.tabs.create({ url });
          return { ok: true, value: null };
        }
        throw new Error("L\u1EC7nh extension kh\xF4ng h\u1EE3p l\u1EC7.");
      }
      chrome.runtime.onMessage.addListener((message, sender, reply) => {
        if (sender.id !== chrome.runtime.id || !message || ["command", "profile"].includes(message.type)) return;
        void execute(message, sender).then(reply, (error) => reply({ ok: false, error: errorText(error) }));
        return true;
      });
    }
  });
  require_worker();
})();
