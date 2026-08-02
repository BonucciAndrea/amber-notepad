/* amber.js — browser runtime for the Amber array language (real C interpreter → WASM).
   Provides: AmberVM (instantiate + eval + load examples) and ansiToHtml().
   No server required; the .wasm is embedded as base64 in amber.wasm.js. */
(function (global) {
  "use strict";

  // ---- example catalog (files are embedded in the wasm virtual FS) ----------
  const EXAMPLES = [
    ["basics.k",     "A 2-minute tour: aggregations, tables, group-by, sorted attributes."],
    ["tour.k",       "A worked example of (nearly) every Amber function."],
    ["practice.k",   "Practice snippets across the core vocabulary."],
    ["extended.k",   "Extended vocabulary and idioms."],
    ["attributes.k", "Column attributes and how they speed up search."],
    ["graphs.k",     "Terminal graphing: braille line charts, candlesticks, x-axis, multi-series."],
    ["hft.k",        "High-frequency-trading style tick analytics."],
    ["tick.k",       "Realistic intraday trades & quotes, kdb+/tick style."],
    ["wj.k",         "Window join: summarise prevailing quotes around each trade."],
    ["peach.k",      "Parallel-each demo (runs sequentially in the browser sandbox)."],
    ["bench.k",      "Micro-benchmarks of core operations."],
    ["test.k",       "The interpreter's own test suite (104 assertions)."]
  ];

  // ---- ANSI (SGR) -> HTML -----------------------------------------------------
  const BASIC = ["#111","#e05561","#8cc265","#d9a35a","#4aa5f0","#c162de","#42b3c2","#d7dae0"];
  const BRIGHT = ["#5a6374","#ff616e","#a5e075","#f0c56a","#61afef","#d16dfa","#56c9d6","#f7f9ff"];
  function xterm256(n) {
    if (n < 8) return BASIC[n];
    if (n < 16) return BRIGHT[n - 8];
    if (n < 232) { n -= 16; const r = Math.floor(n/36), g = Math.floor((n%36)/6), b = n%6;
      const c = v => (v ? v*40+55 : 0).toString(16).padStart(2,"0");
      return "#"+c(r)+c(g)+c(b); }
    const v = ((n-232)*10+8).toString(16).padStart(2,"0"); return "#"+v+v+v;
  }
  function esc(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function ansiToHtml(text) {
    let out = "", fg = null, bold = false, open = false;
    const close = () => { if (open) { out += "</span>"; open = false; } };
    const openSpan = () => {
      close();
      if (fg === null && !bold) return;
      let st = "";
      if (fg !== null) st += "color:" + fg + ";";
      if (bold) st += "font-weight:600;";
      out += '<span style="' + st + '">'; open = true;
    };
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "\x1b" && text[i+1] === "[") {
        let j = i + 2; while (j < text.length && text[j] !== "m") j++;
        const codes = text.slice(i+2, j).split(";").map(Number);
        for (let k = 0; k < codes.length; k++) {
          const n = codes[k];
          if (n === 0) { fg = null; bold = false; }
          else if (n === 1) bold = true;
          else if (n === 22) bold = false;
          else if (n === 39) fg = null;
          else if (n >= 30 && n <= 37) fg = BASIC[n-30];
          else if (n >= 90 && n <= 97) fg = BRIGHT[n-90];
          else if (n === 38 && codes[k+1] === 5) { fg = xterm256(codes[k+2]|0); k += 2; }
          else if (n === 38 && codes[k+1] === 2) { fg = "rgb("+(codes[k+2]|0)+","+(codes[k+3]|0)+","+(codes[k+4]|0)+")"; k += 4; }
        }
        openSpan();
        i = j + 1;
      } else {
        out += esc(c);
        i++;
      }
    }
    close();
    return out;
  }

  // ---- the VM -----------------------------------------------------------------
  class AmberVM {
    constructor() { this.ready = false; this._out = []; }

    async boot() {
      const bin = Uint8Array.from(atob(global.AMBER_WASM_B64), c => c.charCodeAt(0));
      const dec = new TextDecoder(), enc = new TextEncoder();
      this._enc = enc; this._dec = dec;
      const freeList = new Map();
      let mem, heap;
      const u8 = () => new Uint8Array(mem.buffer);
      const self = this;
      const env = {
        js_alloc: (n) => { n = (n + 4095) & ~4095; const f = freeList.get(n);
          if (f && f.length) return f.pop();
          if (heap + n > mem.buffer.byteLength) mem.grow(Math.ceil((heap + n - mem.buffer.byteLength) / 65536) + 64);
          const p = heap; heap += n; return p; },
        js_free: (p, n) => { n = (n + 4095) & ~4095; let f = freeList.get(n); if (!f) { f = []; freeList.set(n, f); } f.push(p); },
        js_out: (p, n) => { self._out.push(dec.decode(u8().slice(p, p + n))); },
        js_log: () => {},
        js_in: () => 0,
        js_time: (s, u) => { const t = Date.now(); const dv = new DataView(mem.buffer);
          dv.setInt32(s, (t/1000)|0, true); dv.setInt32(u, (t%1000)*1000, true); },
        js_exit: () => {},
        js_eval: () => 0,
        sin: Math.sin, cos: Math.cos, log: Math.log, exp: Math.exp
      };
      const { instance } = await WebAssembly.instantiate(bin, { env });
      this.ex = instance.exports; mem = this.ex.memory; heap = this.ex.__heap_base.value;
      this._u8 = u8;
      this._out = [];
      this.ex.amber_init();
      this.banner = this._out.join("");
      this.ready = true;
    }

    _writeIn(s) {
      const b = this._enc.encode(s), p = this.ex.amber_inbuf(), u = this._u8();
      u.set(b, p); u[p + b.length] = 0;
    }
    // evaluate one line of Amber, return raw output (may contain ANSI)
    eval(line) {
      this._out = []; this._writeIn(line);
      try { this.ex.amber_eval(); } catch (e) { return "\x1b[31mruntime error: " + e.message + "\x1b[0m\n"; }
      return this._out.join("");
    }
    // run a whole embedded file (e.g. an example) via the C loader
    load(name) {
      this._out = []; this._writeIn(name);
      try { this.ex.amber_load(); } catch (e) { return "\x1b[31mruntime error: " + e.message + "\x1b[0m\n"; }
      return this._out.join("");
    }
  }

  global.AmberVM = AmberVM;
  global.ansiToHtml = ansiToHtml;
  global.AMBER_EXAMPLES = EXAMPLES;
})(window);
