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

  // src/settings.ts
  var require_settings = __commonJS({
    "src/settings.ts"() {
      init_protocol();
      init_types();
      init_ui();
      var token = el("token");
      var glossary = el("glossary");
      var box = (id) => el(id);
      var value = (id) => el(id).value;
      var report = (err) => message("notice", errorText(err));
      async function check() {
        try {
          const [health, terms] = await Promise.all([api("health"), api("glossary")]);
          el("models").replaceChildren(...health.models.map((name) => {
            const option = document.createElement("option");
            option.value = name;
            return option;
          }));
          const device = health.gpu ? health.gpu.name + " \xB7 VRAM " + health.gpu.used + "/" + health.gpu.total + " MiB" : "Kh\xF4ng ph\xE1t hi\u1EC7n NVIDIA \xB7 CPU s\u1EB5n s\xE0ng";
          const loaded = health.loaded.map((m) => m.name + " (" + Math.round(m.vram / 1024 ** 2) + " MiB VRAM)").join(", ");
          message("health", [
            health.ollama ? "Engine v\xE0 Ollama \u0111\xE3 k\u1EBFt n\u1ED1i." : "Engine \u0111\xE3 k\u1EBFt n\u1ED1i. H\xE3y kh\u1EDFi \u0111\u1ED9ng Ollama.",
            device,
            health.manga_ocr ? "Manga OCR \u0111\xE3 t\u1EA3i." : "Thi\u1EBFu m\xF4 h\xECnh Manga OCR.",
            health.models.length ? "" : "Ch\u01B0a t\xECm th\u1EA5y m\xF4 h\xECnh d\u1ECBch local.",
            loaded
          ].filter(Boolean).join(" "));
          glossary.value = JSON.stringify(terms, null, 2);
        } catch (error) {
          message("health", errorText(error));
        }
      }
      async function initialize() {
        const prefs = await stored();
        token.value = prefs.token;
        const settings = { ...defaults, ...prefs.settings };
        for (const key of Object.keys(defaults)) {
          if (key === "sfx") box(key).checked = Boolean(settings[key]);
          else el(key).value = String(settings[key]);
        }
        box("auto").checked = settings.auto ?? true;
        await check();
      }
      el("connection").onsubmit = (e) => {
        e.preventDefault();
        const code = token.value.trim();
        if (!/^[a-zA-Z0-9_-]{43}$/.test(code)) {
          message("health", "M\xE3 gh\xE9p n\u1ED1i g\u1ED3m 43 k\xFD t\u1EF1.");
          return;
        }
        void chrome.storage.local.set({ token: code }).then(check).catch(report);
      };
      el("profile").onsubmit = (e) => {
        e.preventDefault();
        const model = value("model").trim();
        if (!/^[\w.-]{1,80}(:[\w.-]{1,80})?$/.test(model)) {
          message("notice", "T\xEAn m\xF4 h\xECnh local kh\xF4ng h\u1EE3p l\u1EC7.");
          return;
        }
        void setProfile({
          model,
          device: value("device"),
          quality: value("quality"),
          language: value("language"),
          font: value("font"),
          font_scale: box("font_scale").valueAsNumber,
          sfx: box("sfx").checked,
          auto: box("auto").checked
        }).then(() => message("notice", "\u0110\xE3 l\u01B0u h\u1ED3 s\u01A1.")).catch(report);
      };
      el("save-glossary").onclick = () => {
        void Promise.resolve().then(() => api("saveGlossary", void 0, JSON.parse(glossary.value))).then((terms) => {
          glossary.value = JSON.stringify(terms, null, 2);
          message("notice", "\u0110\xE3 l\u01B0u t\u1EEB \u0111i\u1EC3n. \u1EA2nh m\u1EDBi s\u1EBD d\xF9ng t\u1EEB \u0111i\u1EC3n n\xE0y.");
        }).catch(report);
      };
      el("import").onclick = () => box("file").click();
      box("file").onchange = () => {
        const file = box("file").files?.[0];
        if (!file) return;
        if (file.size > 64e3) {
          message("notice", "T\u1EC7p t\u1EEB \u0111i\u1EC3n v\u01B0\u1EE3t 64 kB.");
          return;
        }
        void file.text().then((text) => {
          glossary.value = JSON.stringify(JSON.parse(text), null, 2);
          box("file").value = "";
          message("notice", "\u0110\xE3 \u0111\u1ECDc t\u1EC7p. Ch\u1ECDn L\u01B0u t\u1EEB \u0111i\u1EC3n \u0111\u1EC3 \xE1p d\u1EE5ng.");
        }).catch(report);
      };
      el("export").onclick = () => {
        void api("glossary").then((terms) => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(terms, null, 2)], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = "manga-glossary.json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1e3);
        }).catch(report);
      };
      el("clear").onclick = () => {
        if (window.confirm("X\xF3a \u1EA3nh \u0111\xE3 x\u1EED l\xFD kh\u1ECFi cache tr\xEAn \u1ED5 \u0111\u0129a?")) {
          void api("clear").then(() => message("notice", "\u0110\xE3 x\xF3a cache \u1EA3nh.")).catch(report);
        }
      };
      void initialize().catch(report);
    }
  });
  require_settings();
})();
