/* rt.js - the Amber engine (amber.wasm, the real C interpreter) for the phone notepad.
   AmberVM: boot from amber.wasm, eval a line, read an embedded file. ansiToHtml: the engine's
   coloured output as HTML. Same ABI as ../amber.js (src/amber_wasm.c), plus the imports the 2.9
   engine needs (tan asin acos atan fmod, isatty, two line-editor hooks the browser never uses). */
(function (global) {
"use strict";

const BASIC = ["#1b1b22","#ff6b6b","#8fd46a","#ffb020","#6aaeff","#d98cff","#57d6d6","#d7dae0"];
const BRIGHT = ["#6b6d78","#ff8a8a","#a8e88a","#ffcb6b","#8cc2ff","#e4a8ff","#7ee6e6","#f7f9ff"];
function xterm256(n) {
  if (n < 8) return BASIC[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n < 232) { n -= 16; const r = Math.floor(n / 36), g = Math.floor((n % 36) / 6), b = n % 6;
    const c = v => (v ? v * 40 + 55 : 0).toString(16).padStart(2, "0"); return "#" + c(r) + c(g) + c(b); }
  const v = ((n - 232) * 10 + 8).toString(16).padStart(2, "0"); return "#" + v + v + v;
}
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function ansiToHtml(text) {
  let out = "", fg = null, bold = false, open = false;
  const close = () => { if (open) { out += "</span>"; open = false; } };
  const reopen = () => { close(); if (fg === null && !bold) return;
    out += '<span style="' + (fg !== null ? "color:" + fg + ";" : "") + (bold ? "font-weight:600;" : "") + '">'; open = true; };
  for (let i = 0; i < text.length;) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      let j = i + 2; while (j < text.length && !/[A-Za-z]/.test(text[j])) j++;
      if (text[j] === "m") {
        const codes = text.slice(i + 2, j).split(";").map(Number);
        for (let k = 0; k < codes.length; k++) {
          const n = codes[k];
          if (n === 0) { fg = null; bold = false; } else if (n === 1) bold = true; else if (n === 22) bold = false;
          else if (n === 39) fg = null; else if (n >= 30 && n <= 37) fg = BASIC[n - 30]; else if (n >= 90 && n <= 97) fg = BRIGHT[n - 90];
          else if (n === 38 && codes[k + 1] === 5) { fg = xterm256(codes[k + 2] | 0); k += 2; }
          else if (n === 38 && codes[k + 1] === 2) { fg = "rgb(" + (codes[k + 2] | 0) + "," + (codes[k + 3] | 0) + "," + (codes[k + 4] | 0) + ")"; k += 4; }
        }
        reopen();
      }
      i = j + 1;                                   // other escape sequences (cursor moves) are dropped
    } else { out += esc(text[i]); i++; }
  }
  close(); return out;
}
function stripAnsi(s) { return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""); }

class AmberVM {
  constructor() { this.ready = false; this._out = []; }
  async boot(bytes) {
    if (!bytes) bytes = await (await fetch("amber.wasm")).arrayBuffer();
    const dec = new TextDecoder(), enc = new TextEncoder(); this._enc = enc; this._dec = dec;
    const free = new Map(); let mem, heap;
    const u8 = () => new Uint8Array(mem.buffer); const self = this;
    const env = {
      js_alloc: (n) => { n = (n + 4095) & ~4095; const f = free.get(n); if (f && f.length) return f.pop();
        if (heap + n > mem.buffer.byteLength) mem.grow(Math.ceil((heap + n - mem.buffer.byteLength) / 65536) + 64);
        const p = heap; heap += n; return p; },
      js_free: (p, n) => { n = (n + 4095) & ~4095; let f = free.get(n); if (!f) { f = []; free.set(n, f); } f.push(p); },
      js_out: (p, n) => { self._out.push(dec.decode(u8().slice(p, p + n))); },
      js_log: () => {}, js_in: () => 0, js_exit: () => {}, js_eval: () => 0,
      js_time: (s, u) => { const t = Date.now(), dv = new DataView(mem.buffer);
        dv.setInt32(s, (t / 1000) | 0, true); dv.setInt32(u, (t % 1000) * 1000, true); },
      sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
      log: Math.log, exp: Math.exp, fmod: (a, b) => a % b,
      isatty: () => 0, am_ln_sb_capture: () => {}, am_ln_exec_ms: () => 0
    };
    const { instance } = await WebAssembly.instantiate(bytes, { env });
    this.ex = instance.exports; mem = this.ex.memory; heap = this.ex.__heap_base.value; this._u8 = u8;
    this._out = []; this.ex.amber_init(); this.banner = this._out.join(""); this.ready = true;
    return this;
  }
  _in(s) { const b = this._enc.encode(s), p = this.ex.amber_inbuf(), u = this._u8(); u.set(b, p); u[p + b.length] = 0; }
  eval(line) {
    this._out = []; this._in(line);
    try { this.ex.amber_eval(); } catch (e) { return "\x1b[31m'" + e.message + "\x1b[0m\n"; }
    return this._out.join("");
  }
  version() { const p = this.ex.amber_version(), u = this._u8(); let e = p; while (u[e]) e++; return this._dec.decode(u.slice(p, e)); }
  readFile(name) { this._in(name); const p = this.ex.amber_read(), u = this._u8(); let e = p; while (u[e]) e++;
    return this._dec.decode(u.slice(p, e)); }
}

// split a script into the units amber_eval takes: lines, joined while brackets or strings stay open
function statements(src) {
  const out = []; let cur = "", depth = 0, inStr = false;
  for (const line of src.replace(/\r/g, "").split("\n")) {
    if (!cur && !line.trim()) continue;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if ("([{".includes(c)) depth++; else if (")]}".includes(c)) depth--;
      else if (c === "/" && (i === 0 || line[i - 1] === " ")) break;    // a comment to the end of the line
    }
    cur = cur ? cur + "\n" + line : line;
    if (depth <= 0 && !inStr) { out.push(cur); cur = ""; depth = 0; }
  }
  if (cur) out.push(cur);
  return out;
}

global.AmberVM = AmberVM; global.ansiToHtml = ansiToHtml; global.stripAnsi = stripAnsi; global.amberStatements = statements;
})(typeof window !== "undefined" ? window : globalThis);
