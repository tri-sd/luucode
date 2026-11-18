"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/protocol.ts
  async function unwrap(promise) {
    const answer = await promise;
    if (!answer?.ok) throw new RequestError(answer?.error ?? "Extension kh\xF4ng ph\u1EA3n h\u1ED3i.", answer?.status);
    return answer.value;
  }
  function api(action, key, payload) {
    return unwrap(chrome.runtime.sendMessage({ type: "api", action, key, payload }));
  }
  function command(tabId, action, value) {
    return unwrap(chrome.tabs.sendMessage(tabId, { type: "command", action, value }));
  }
  var RequestError;
  var init_protocol = __esm({
    "src/protocol.ts"() {
      "use strict";
      RequestError = class extends Error {
        constructor(message2, status) {
          super(message2);
          this.status = status;
        }
      };
    }
  });

  // src/types.ts
  var defaults, errorText;
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
      errorText = (error) => error instanceof Error ? error.message : String(error);
    }
  });

  // src/ui.ts
  function el(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error("Thi\u1EBFu \u0111i\u1EC1u khi\u1EC3n " + id);
    return node;
  }
  function message(id, text) {
    const node = el(id);
    node.textContent = text;
    node.hidden = !text;
  }
  async function stored() {
    const value = await chrome.storage.local.get(["settings", "token"]);
    return { settings: value.settings ?? {}, token: value.token ?? "" };
  }
  async function setProfile(patch) {
    const { settings } = await stored();
    await chrome.storage.local.set({ settings: { ...settings, ...patch } });
  }
  var init_ui = __esm({
    "src/ui.ts"() {
      "use strict";
    }
  });

  // src/popup.ts
  var require_popup = __commonJS({
    "src/popup.ts"() {
      init_protocol();
      init_types();
      init_ui();
      var tab;
      var origin = "";
      var last;
      var pending = false;
      function show(status) {
        last = status;
        for (const key of ["done", "processing", "waiting", "errors"]) el(key).textContent = String(status[key]);
        el("fraction").textContent = status.done + " / " + status.found;
        const progress = el("progress");
        progress.max = Math.max(1, status.found);
        progress.value = status.done;
        el("phase").textContent = status.phase || (status.paused ? "\u0110\xE3 t\u1EA1m d\u1EEBng" : status.regions ? status.regions + " v\xF9ng c\u1EA7n ki\u1EC3m tra ho\u1EB7c s\u1EEDa" : "");
        el("pause").textContent = status.paused ? "Ti\u1EBFp t\u1EE5c" : "T\u1EA1m d\u1EEBng";
        el("auto").checked = status.auto;
        el("show").checked = status.showing;
        el("cdn").hidden = !status.hosts.length;
        if (status.recent.length) message("message", status.recent.at(-1));
        if (status.engine.startsWith("Kh\xF4ng")) el("engine").textContent = status.engine;
      }
      async function health() {
        const indicator = el("indicator");
        try {
          const value = await api("health");
          el("engine").textContent = !value.ollama ? "Engine k\u1EBFt n\u1ED1i \xB7 Ollama ch\u01B0a s\u1EB5n s\xE0ng" : value.gpu ? value.gpu.name + " \xB7 " + value.gpu.used + "/" + value.gpu.total + " MiB" : "Engine k\u1EBFt n\u1ED1i \xB7 CPU";
          indicator.classList.toggle("on", value.ollama && value.models.length > 0);
        } catch (error) {
          el("engine").textContent = errorText(error);
          indicator.classList.remove("on");
        }
      }
      async function inject() {
        const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (current?.id == null || !current.url || !/^https?:/.test(current.url)) {
          throw new Error("H\xE3y m\u1EDF m\u1ED9t trang truy\u1EC7n HTTP ho\u1EB7c HTTPS.");
        }
        tab = current.id;
        origin = new URL(current.url).origin;
        try {
          show(await command(tab, "status"));
        } catch {
          await chrome.scripting.executeScript({ target: { tabId: tab }, files: ["content.js"] });
          show(await command(tab, "status"));
        }
      }
      function requestReader(site) {
        const url = new URL(site);
        const pattern = url.protocol + "//" + url.hostname + "/*";
        const prepare = () => chrome.runtime.sendMessage({ type: "reader-permission", site }).catch(() => {
        });
        void prepare();
        void chrome.permissions.request({ origins: [pattern] }).then((granted) => granted ? prepare() : void 0).catch(() => {
        });
      }
      function run(action, value) {
        if (tab == null || pending) return;
        pending = true;
        message("message", "");
        void command(tab, action, value).then(show, (error) => message("message", errorText(error))).finally(() => {
          pending = false;
        });
      }
      for (const key of ["current", "retry", "edit"]) el(key).onclick = () => run(key);
      el("settings").onclick = () => void chrome.runtime.openOptionsPage();
      el("pause").onclick = () => run(last?.paused ? "resume" : "pause");
      el("chapter").onclick = () => {
        if (!origin) return;
        if (el("auto").checked) requestReader(origin);
        run("chapter");
      };
      el("show").onchange = (e) => run("show", e.target.checked);
      el("auto").onchange = (e) => {
        const checked = e.target.checked;
        if (checked && origin) requestReader(origin);
        void setProfile({ auto: checked }).catch((error) => message("message", errorText(error)));
        run("auto", checked);
      };
      el("cdn").onclick = () => {
        const origins = (last?.hosts ?? []).map((host) => host + "/*");
        if (!origins.length) return;
        void chrome.permissions.request({ origins }).then((granted) => {
          if (granted) run("chapter");
        }).catch((error) => message("message", errorText(error)));
      };
      for (const key of ["language", "quality"]) {
        const control = el(key);
        control.onchange = () => void setProfile({ [key]: control.value }).catch((error) => message("message", errorText(error)));
      }
      void stored().then(({ settings }) => {
        for (const key of ["language", "quality"]) el(key).value = settings[key] ?? defaults[key];
      });
      void inject().catch((error) => {
        message("message", errorText(error));
        for (const key of ["chapter", "current", "pause", "retry", "edit", "show", "auto"])
          el(key).disabled = true;
      });
      void health();
      setInterval(() => {
        if (tab != null && !pending) void command(tab, "status").then(show).catch(() => {
        });
      }, 800);
      setInterval(() => void health(), 8e3);
    }
  });
  require_popup();
})();
