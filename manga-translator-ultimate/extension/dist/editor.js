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
        constructor(message2, status) {
          super(message2);
          this.status = status;
        }
      };
    }
  });

  // src/types.ts
  var errorText;
  var init_types = __esm({
    "src/types.ts"() {
      "use strict";
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
  var init_ui = __esm({
    "src/ui.ts"() {
      "use strict";
    }
  });

  // src/editor.ts
  var require_editor = __commonJS({
    "src/editor.ts"() {
      init_protocol();
      init_types();
      init_ui();
      var params = new URLSearchParams(location.search);
      var key = params.get("key") ?? "";
      var tab = Number(params.get("tab"));
      var stage = el("stage");
      var chooser = el("region");
      var fields = ["x", "y", "w", "h"].map((id) => el(id));
      var textarea = el("text");
      var scale = el("scale");
      var form = el("edit");
      var font = el("font");
      var data;
      var selected;
      var pending = false;
      var imageUrl;
      function setBox(box) {
        box.forEach((entry, i) => {
          fields[i].value = (entry * 100).toFixed(2);
        });
      }
      function readBox() {
        return fields.map((field) => field.valueAsNumber / 100);
      }
      function drawBox(button, box) {
        const [x, y, w, h] = box;
        Object.assign(button.style, { left: x * 100 + "%", top: y * 100 + "%", width: w * 100 + "%", height: h * 100 + "%" });
      }
      function preview() {
        const item = stage.querySelector(".selected");
        if (item) drawBox(item, readBox());
      }
      function select(id) {
        selected = data?.regions.find((region) => region.id === id);
        if (!selected) return;
        chooser.value = id;
        message("source", selected.source ? "OCR \xB7 " + selected.source : "OCR ch\u01B0a \u0111\u1ECDc \u0111\u01B0\u1EE3c v\xF9ng n\xE0y.");
        message("issue", selected.issue);
        textarea.value = selected.text;
        scale.value = selected.font_scale == null ? "" : String(selected.font_scale);
        font.value = selected.font ?? "";
        for (const node of stage.querySelectorAll(".region")) node.classList.toggle("selected", node.dataset.id === id);
        setBox(selected.placement ?? selected.bubble ?? selected.box);
      }
      function drag(event, button, region) {
        if (event.button !== 0 || pending) return;
        if (selected?.id !== region.id) select(region.id);
        const rect = stage.getBoundingClientRect();
        const [x, y, w, h] = readBox();
        const { clientX, clientY, pointerId } = event;
        button.setPointerCapture(pointerId);
        const move = (e) => {
          setBox([
            Math.max(0, Math.min(1 - w, x + (e.clientX - clientX) / rect.width)),
            Math.max(0, Math.min(1 - h, y + (e.clientY - clientY) / rect.height)),
            w,
            h
          ]);
          preview();
        };
        button.addEventListener("pointermove", move);
        button.addEventListener("lostpointercapture", () => button.removeEventListener("pointermove", move), { once: true });
      }
      async function redraw(result, id) {
        data = result;
        stage.replaceChildren();
        chooser.replaceChildren();
        if (imageUrl) {
          URL.revokeObjectURL(imageUrl);
          imageUrl = void 0;
        }
        const image = document.createElement("img");
        image.alt = "\u1EA2nh truy\u1EC7n";
        image.width = result.width;
        image.height = result.height;
        if (result.image) {
          const bytes = Uint8Array.from(atob(result.image), (ch) => ch.charCodeAt(0));
          imageUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        } else {
          const original = await api("original", result.key);
          const bytes = Uint8Array.from(atob(original.image), (ch) => ch.charCodeAt(0));
          imageUrl = URL.createObjectURL(new Blob([bytes], { type: original.mime }));
        }
        image.src = imageUrl;
        stage.append(image);
        for (const r of result.regions) {
          const node = document.createElement("option");
          node.value = r.id;
          node.textContent = r.id + (r.issue ? " \xB7 c\u1EA7n xem l\u1EA1i" : "") + (r.source ? " \xB7 " + r.source.slice(0, 25) : "");
          chooser.append(node);
          const overlay = document.createElement("button");
          overlay.type = "button";
          overlay.className = "region";
          overlay.dataset.id = r.id;
          overlay.setAttribute("aria-label", "Ch\u1ECDn " + r.id);
          drawBox(overlay, r.placement ?? r.bubble ?? r.box);
          overlay.onclick = () => {
            if (selected?.id !== r.id) select(r.id);
          };
          overlay.onpointerdown = (event) => drag(event, overlay, r);
          stage.append(overlay);
        }
        if (result.regions.length) select(id ?? result.regions[0].id);
        else {
          form.hidden = true;
          message("notice", "Engine ch\u01B0a ph\xE1t hi\u1EC7n v\xF9ng ch\u1EEF \u0111\u1EC3 ch\u1EC9nh.");
        }
      }
      async function save(reset) {
        if (!data || !selected || pending) return;
        const id = selected.id;
        const placement = readBox();
        if (!reset && (placement.some((v) => !Number.isFinite(v) || v < 0) || placement[0] + placement[2] > 1.00001 || placement[1] + placement[3] > 1.00001 || placement[2] <= 0 || placement[3] <= 0)) {
          message("notice", "Khung ph\u1EA3i n\u1EB1m tr\u1ECDn trong \u1EA3nh.");
          return;
        }
        pending = true;
        el("save").disabled = true;
        el("reset").disabled = true;
        try {
          const edit = {
            id,
            text: textarea.value,
            placement: reset ? null : placement,
            font: font.value || null,
            font_scale: scale.value ? scale.valueAsNumber : null
          };
          const updated = await job("edit", { reset, edit }, AbortSignal.timeout(9e4), (phase) => message("notice", phase), key);
          await redraw(updated, id);
          if (tab) await command(tab, "refresh", key).catch(() => {
          });
          message("notice", reset ? "\u0110\xE3 kh\xF4i ph\u1EE5c v\xF9ng." : "\u0110\xE3 l\u01B0u ch\u1EC9nh s\u1EEDa.");
        } catch (error) {
          message("notice", errorText(error));
        } finally {
          pending = false;
          el("save").disabled = false;
          el("reset").disabled = false;
        }
      }
      chooser.onchange = () => select(chooser.value);
      for (const field of fields) field.oninput = preview;
      form.onsubmit = (e) => {
        e.preventDefault();
        void save(false);
      };
      el("reset").onclick = () => void save(true);
      void api("result", key).then((value) => redraw(value)).catch((error) => message("notice", errorText(error)));
    }
  });
  require_editor();
})();
