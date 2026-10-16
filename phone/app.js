/* app.js - the phone notepad: a keyboard of every Amber primitive, an editor, a log, files.

   The editor is drawn by this file, not a native text box: iOS scrolls and resizes the page whenever a
   text box takes focus or its caret moves, which put touches out of line with the keys and moved the
   layout as you typed. Here nothing ever has focus, the text, caret and selection are plain elements,
   and every height is fixed, so the page never moves. A tap in the text places the caret (monospace,
   so a position is a row and a column), a double tap selects a word. "Edit with the iPhone keyboard"
   opens the whole text in a native box inside a sheet, for long names and native paste.

   Keys act on release; holding one opens its card with the engine's own examples. Files are named
   scripts kept on the phone and saved as you type; `\l name.k` in any input runs one. With no file
   open the editor is a scratch line: Run logs it and clears it, as a REPL does. */
(function () {
"use strict";
const $ = s => document.querySelector(s);
const K = window.AMBER_KEYS;
const log = $("#log"), kb = $("#kb"), hint = $("#hint"), card = $("#card"), sheet = $("#sheet");
const edBox = $("#ed"), edText = $("#edt"), caretEl = $("#caret"), phEl = $("#ph");
const store = { get: (k, d) => { try { const v = localStorage.getItem("amber." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
                set: (k, v) => { try { localStorage.setItem("amber." + k, JSON.stringify(v)); } catch (e) { toast("storage is full"); } } };
const escH = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

let toastT = 0;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add("hidden"), 1400); }

// ---------------------------------------------------------------- engine
let vm = null;
const boot = async () => {
  try {
    vm = await new AmberVM().boot();
    vm.eval("`diag 0");                                          // q-style errors: 'type, the code, a caret
    $("#ver").textContent = vm.version();
    $("#boot").textContent = "Amber " + vm.version() + " · the real interpreter, running on this phone, offline";
    for (const s of store.get("defs", [])) evalSrc(s);
  } catch (e) { $("#boot").textContent = "the engine failed to start: " + e.message; }
};
// An error comes back as 'name, then pairs of lines, the code and a caret under the failing spot, for
// the user's line and for the engine's eval wrapper (wprint(. qrw "...")), which is dropped.
const WHY = { type: "wrong type for this operation", length: "the lengths do not match", rank: "wrong number of arguments",
  domain: "outside what this operation accepts", index: "index out of range", nyi: "not implemented yet", parse: "syntax error",
  limit: "too big", value: "no such name", mismatch: "the columns do not match", "s-fail": "not sorted", "u-fail": "not unique",
  io: "file error", nonce: "not supported here", stack: "too deep", wsfull: "out of memory" };
function asError(raw) {
  const t = stripAnsi(raw).replace(/\n+$/, ""); if (!/^'/.test(t)) return null;
  const L = t.split("\n"), name = L[0].slice(1).trim(), frames = [];
  for (let k = 1; k < L.length; k += 2) {
    const code = L[k] || "", car = L[k + 1] || "";
    if (/wprint\(|\bqrw "/.test(code) || !code.trim()) continue;
    frames.push([code.replace(/^ /, ""), car.replace(/^ /, "")]);
  }
  const why = WHY[name] || (/^[A-Za-z][\w.]*$/.test(name) ? name + " is not defined" : "");
  return { name, why, frames, text: "'" + name + (why ? "  " + why : "") + frames.map(f => "\n" + f[0] + "\n" + f[1]).join("") };
}
// evaluate a script: one part per statement, {ok: output} or {err: error}; `\l name` of a saved file runs it
function evalSrc(src, depth) {
  const parts = []; depth = depth || 0;
  for (const st of amberStatements(src)) {
    const m = /^\\l\s+(\S+)\s*$/.exec(st.trim()), fs = files();
    if (m && fs[m[1]] !== undefined) {
      if (depth < 8) parts.push(...evalSrc(fs[m[1]], depth + 1));
      else parts.push({ err: { name: "load", why: "\\l nested too deep", frames: [], text: "'load" } });
      continue;
    }
    const out = vm.eval(st), e = asError(out);
    if (e) parts.push({ err: e }); else if (out) parts.push({ ok: out });
  }
  return parts;
}

// ---------------------------------------------------------------- syntax colours, per character
const WORDS = new Set(K.words.map(w => w.w));
const TOK = /("(?:[^"\\]|\\.)*"?)|(`[\w.:\/]*)|(\b\d[\d.]*(?:[eE]-?\d+)?[a-zA-Z]?\b|0[NnWw]\b)|('|\/:|\\:|':|\/|\\)|([+\-*%!&|<>=~,^#_$?@.:])|(\b[A-Za-z][\w.]*\b)|((?:^|\s)\/.*$)/g;
const CLS = [null, "t-s", "t-y", "t-n", "t-a", "t-v", "t-w", "t-c"];
function classes(line) {                       // one class name (or "") per character of a line
  const c = new Array(line.length).fill(""); let m; TOK.lastIndex = 0;
  while ((m = TOK.exec(line))) {
    if (!m[0].length) { TOK.lastIndex++; continue; }
    let k = 1; while (k < 8 && m[k] === undefined) k++;
    let cls = CLS[k]; if (k === 6 && !WORDS.has(m[0])) cls = "";
    for (let i = m.index; i < m.index + m[0].length; i++) c[i] = cls;
  }
  return c;
}
function hl(src) { return src.split("\n").map(l => spans(l, classes(l), 0, l.length, -1, -1)).join("\n"); }
function spans(line, cls, a, b, s0, s1) {      // characters a..b of a line, coloured, selection s0..s1 marked
  let h = "", run = "", rc = null;
  const flush = () => { if (run) h += rc ? '<span class="' + rc + '">' + escH(run) + "</span>" : escH(run); run = ""; };
  for (let i = a; i < b; i++) {
    const c = (cls[i] || "") + (i >= s0 && i < s1 ? " sel" : "");
    if (c !== rc) { flush(); rc = c; }
    run += line[i];
  }
  flush(); return h;
}

// ---------------------------------------------------------------- the editor
const E = { text: "", a: 0, b: 0 };           // a = anchor, b = caret; the selection is between them
let rows = [], cw = 10, lh = 22, cols = 30, undoS = [], redoS = [], saveT = 0;
const selLo = () => Math.min(E.a, E.b), selHi = () => Math.max(E.a, E.b);
function measure() {
  const probe = document.createElement("span"); probe.className = "probe"; probe.textContent = "MMMMMMMMMM"; edText.append(probe);
  cw = probe.getBoundingClientRect().width / 10 || 10; lh = parseFloat(getComputedStyle(edText).lineHeight) || 22; probe.remove();
  cols = Math.max(8, Math.floor((edText.clientWidth - 2) / cw));
}
function layout() {                            // logical lines cut into rows of `cols` characters
  rows = []; let s = 0;
  for (const line of E.text.split("\n")) {
    if (!line.length) rows.push({ s, e: s, ls: s });
    for (let i = 0; i < line.length; i += cols) rows.push({ s: s + i, e: s + Math.min(i + cols, line.length), ls: s });
    s += line.length + 1;
  }
}
function caretRow(p) {                         // the row a position is drawn on (a wrap point goes to the next row)
  for (let r = 0; r < rows.length; r++) {
    const R = rows[r], N = rows[r + 1];
    if (p >= R.s && p <= R.e && !(p === R.e && N && N.s === R.e && N.ls === R.ls)) return r;
  }
  return rows.length - 1;
}
function draw() {
  layout();
  const lo = selLo(), hi = selHi(), lines = E.text.split("\n"); let h = "", li = 0, lstart = 0, lcls = null;
  for (const R of rows) {
    while (R.ls > lstart) { lstart += lines[li].length + 1; li++; lcls = null; }
    if (!lcls) lcls = classes(lines[li]);
    const inner = spans(lines[li], lcls, R.s - lstart, R.e - lstart, lo - lstart, hi - lstart);
    const nlSel = lo < hi && R.e === R.ls + lines[li].length && R.e >= lo && R.e < hi;   // a selected line end
    h += '<div class="r">' + (inner || "") + (nlSel ? '<span class="sel"> </span>' : "") + "</div>";
  }
  edText.innerHTML = h;
  phEl.classList.toggle("hidden", E.text.length > 0);
  const r = caretRow(E.b), col = E.b - rows[r].s;
  caretEl.style.transform = "translate(" + (col * cw) + "px," + (r * lh) + "px)";
  caretEl.classList.remove("blink"); void caretEl.offsetWidth; caretEl.classList.add("blink");
  const top = r * lh, vis = edBox.clientHeight - 8;                     // keep the caret in view
  if (top < edBox.scrollTop) edBox.scrollTop = top; else if (top + lh > edBox.scrollTop + vis) edBox.scrollTop = top + lh - vis;
  clearTimeout(saveT); saveT = setTimeout(save, 250);
}
function snap() { const t = { text: E.text, a: E.a, b: E.b }, top = undoS[undoS.length - 1];
  if (!top || top.text !== t.text) { undoS.push(t); if (undoS.length > 300) undoS.shift(); redoS = []; } }
function undo() { if (!undoS.length) return toast("nothing to undo"); redoS.push({ text: E.text, a: E.a, b: E.b }); Object.assign(E, undoS.pop()); draw(); }
function redo() { if (!redoS.length) return toast("nothing to redo"); undoS.push({ text: E.text, a: E.a, b: E.b }); Object.assign(E, redoS.pop()); draw(); }
function replaceSel(t) { const lo = selLo(), hi = selHi(); E.text = E.text.slice(0, lo) + t + E.text.slice(hi); E.a = E.b = lo + t.length; }
function insert(t) { snap(); replaceSel(t); draw(); }
function insertPair(o, c) { snap(); const mid = E.text.slice(selLo(), selHi()); replaceSel(o + mid + c); E.a = E.b = E.b - c.length; draw(); }
function back() { snap(); if (E.a === E.b && E.b > 0) E.a = E.b - 1; replaceSel(""); draw(); }
function setText(t) { snap(); E.text = t; E.a = E.b = t.length; draw(); }
function move(d) { const p = E.a !== E.b ? (d < 0 ? selLo() : selHi()) : Math.max(0, Math.min(E.text.length, E.b + d)); E.a = E.b = p; draw(); }
function moveLine(d) { layout(); const r = caretRow(E.b), col = E.b - rows[r].s, t = r + d;
  if (t < 0) E.b = 0; else if (t >= rows.length) E.b = E.text.length; else E.b = rows[t].s + Math.min(col, rows[t].e - rows[t].s);
  E.a = E.b; draw(); }
function selectAll() { if (selLo() === 0 && selHi() === E.text.length && E.text.length) { E.a = E.b = E.text.length; } else { E.a = 0; E.b = E.text.length; } draw(); }
function selectLine() { const v = E.text, a = v.lastIndexOf("\n", E.b - 1) + 1, b = v.indexOf("\n", E.b); E.a = a; E.b = b < 0 ? v.length : b; draw(); }
function selectWord(p) { const v = E.text, w = c => /[\w.`]/.test(c || "");
  let a = p, b = p; if (!w(v[p]) && w(v[p - 1])) a = b = p - 1; if (!w(v[a])) { E.a = p; E.b = Math.min(v.length, p + 1); return draw(); }
  while (a > 0 && w(v[a - 1])) a--; while (b < v.length && w(v[b])) b++; E.a = a; E.b = b; draw(); }
const selected = () => E.text.slice(selLo(), selHi());
function posAt(x, y) {                         // the text position under a point in the editor
  const rect = edText.getBoundingClientRect(); layout();
  const r = Math.max(0, Math.min(rows.length - 1, Math.floor((y - rect.top) / lh)));
  const col = Math.max(0, Math.round((x - rect.left) / cw));
  return rows[r].s + Math.min(col, rows[r].e - rows[r].s);
}
// taps in the editor: place the caret, a quick second tap selects the word; a drag scrolls it
let edDown = null, lastTap = 0;
edBox.addEventListener("pointerdown", e => { edDown = { x: e.clientX, y: e.clientY, st: edBox.scrollTop }; });
edBox.addEventListener("pointerup", e => {
  if (!edDown) return; const moved = Math.abs(e.clientY - edDown.y) > 8 || Math.abs(e.clientX - edDown.x) > 8 || edBox.scrollTop !== edDown.st;
  edDown = null; if (moved) return;
  const p = posAt(e.clientX, e.clientY), now = Date.now();
  if (now - lastTap < 330) { selectWord(p); lastTap = 0; } else { E.a = E.b = p; draw(); lastTap = now; }
});
edBox.addEventListener("contextmenu", e => e.preventDefault());

// ---------------------------------------------------------------- clipboard
async function copyText(t, quiet) {
  if (!t) return toast("nothing to copy");
  let ok = false;
  try { await navigator.clipboard.writeText(t); ok = true; } catch (e) {}
  if (!ok) { const ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.className = "offscreen";
    document.body.append(ta); ta.select(); try { ok = document.execCommand("copy"); } catch (e) {} ta.remove(); window.scrollTo(0, 0); }
  if (!quiet) toast(ok ? "copied" : "copy failed");
}
function copySel() { copyText(selected() || E.text); }
function cutSel() { const t = selected(); if (!t) return toast("select something first (all · line · double tap)"); copyText(t, true); back(); toast("cut"); }
async function paste() {
  try { const t = await navigator.clipboard.readText(); if (t) return insert(t.replace(/\r\n?/g, "\n")); toast("the clipboard is empty"); }
  catch (e) { nativeEdit("Paste here (hold and choose Paste), then Done"); }
}
// the whole text in a native box, for the iPhone keyboard, native selection and paste
function nativeEdit(note) {
  openSheet('<h3>Edit with the iPhone keyboard</h3><div class="note">' + escH(note || "type, select, paste as usual, then Done") +
    '</div><textarea id="nat" class="nat" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>' +
    '<button class="item ok" data-a="ok">Done</button>', { ok: () => { setText($("#nat").value.replace(/\r\n?/g, "\n")); window.scrollTo(0, 0); } }, true);
  const n = $("#nat"); n.value = E.text; setTimeout(() => { n.focus(); n.setSelectionRange(E.b, E.b); }, 50);
}

// ---------------------------------------------------------------- the log
let hist = store.get("hist", []), hpos = -1;
function addCell(src, parts, tag) {
  if (typeof parts === "string") parts = [{ ok: parts }];
  const c = document.createElement("div"); c.className = "cell";
  const i = document.createElement("div"); i.className = "in"; i.innerHTML = (tag ? '<span class="tag">' + escH(tag) + "</span>" : "") + hl(src);
  const o = document.createElement("div"); o.className = "out";
  o.innerHTML = parts.map(p => p.ok !== undefined
    ? '<div class="ok">' + ansiToHtml(p.ok.replace(/\n+$/, "")) + "</div>"
    : '<div class="er"><span class="en">\'' + escH(p.err.name) + "</span>" + (p.err.why ? '<span class="ew">' + escH(p.err.why) + "</span>" : "") +
      p.err.frames.map(f => '<span class="ec">' + hl(f[0]) + "\n" + '<span class="ek">' + escH(f[1]) + "</span></span>").join("") + "</div>").join("");
  c._src = src;
  c._out = parts.map(p => p.ok !== undefined ? stripAnsi(p.ok).replace(/\n+$/, "") : p.err.text).join("\n");
  c.append(i, o); log.append(c); log.scrollTop = log.scrollHeight;
}
let cellT = 0, cellLong = false, cellY = 0;
log.addEventListener("pointerdown", e => { const c = e.target.closest(".cell"); if (!c || !c._src) return;
  cellLong = false; cellY = e.clientY; cellT = setTimeout(() => { cellLong = true; cellMenu(c); }, 480); });
["pointerup", "pointercancel", "pointermove"].forEach(t => log.addEventListener(t, e => {
  if (t === "pointermove" && Math.abs(e.clientY - cellY) < 8) return; clearTimeout(cellT); }));
log.addEventListener("click", e => {
  const c = e.target.closest(".cell"); if (!c || !c._src || cellLong) return;
  if (e.target.closest(".out")) copyText(c._out); else if (e.target.closest(".in")) putText(c._src);
});
log.addEventListener("contextmenu", e => { if (e.target.closest(".cell")) e.preventDefault(); });
function cellMenu(c) {
  openSheet("<h3>This entry</h3>" + item("cin", "Copy the input") + item("cout", "Copy the output") +
    item("edit", "Edit it again") + item("rerun", "Run it again") + item("del", "Remove it from the log"), {
    cin: () => copyText(c._src), cout: () => copyText(c._out), edit: () => putText(c._src),
    rerun: () => runText(c._src), del: () => c.remove() });
}
function putText(t) { if (cur) insert(t); else setText(t); }      // a file is never replaced
function runText(src) {
  if (!vm) { addCell(src, "the engine is still starting"); return; }
  addCell(src, evalSrc(src));
  hist = hist.filter(h => h !== src); hist.push(src); hist = hist.slice(-200); hpos = -1; store.set("hist", hist);
  if (/^[A-Za-z][\w.]*\s*:[^:]/.test(src) || /^\\l /.test(src)) { const d = store.get("defs", []); d.push(src); store.set("defs", d.slice(-100)); }
}
function run() {
  const src = E.text.trim(); if (!src) return;
  if (cur) { if (!vm) return toast("the engine is still starting"); addCell(src, evalSrc(src), cur); return; }
  runText(src); snap(); E.text = ""; E.a = E.b = 0; draw();
}
function runLine() {
  const v = E.text, s = selLo(), e = selHi();
  const t = (s !== e ? v.slice(s, e) : v.slice(v.lastIndexOf("\n", s - 1) + 1, (v.indexOf("\n", s) + 1 || v.length + 1) - 1)).trim();
  if (t) runText(t);
}
function recall(dir) {                       // ↑ the command before, ↓ the one after; past the newest, an empty line
  if (!hist.length) return toast("no commands yet");
  if (cur) { if (dir < 0) insert(hist[hist.length - 1]); return; }   // in a file: the last command at the caret
  if (hpos < 0) { if (dir > 0) return; hpos = hist.length - 1; } else hpos = Math.max(0, hpos + dir);
  if (hpos >= hist.length) { hpos = -1; return setText(""); }
  setText(hist[hpos]);
}

// ---------------------------------------------------------------- files
let cur = store.get("cur", null);
const files = () => store.get("files", {});
function save() { if (cur) { const f = files(); f[cur] = E.text; store.set("files", f); } else store.set("draft", E.text); }
function openFile(name) {
  save(); cur = name; store.set("cur", cur); undoS = []; redoS = [];
  E.text = name ? (files()[name] || "") : store.get("draft", ""); E.a = E.b = E.text.length; edBox.scrollTop = 0; draw(); showName();
}
function showName() { $("#fileBtn").textContent = cur || "scratch"; $("#fileBtn").classList.toggle("on", !!cur); }
function uniqueName(n) { n = n.trim().replace(/[\/\\\s]+/g, "_") || "untitled"; if (!/\.[kq]$|\.txt$/.test(n)) n += ".k";
  const f = files(); if (f[n] === undefined) return n; const b = n.replace(/(\.\w+)$/, ""), x = n.slice(b.length);
  for (let i = 2; ; i++) if (f[b + "-" + i + x] === undefined) return b + "-" + i + x; }
function newFile(name, text) { const n = uniqueName(name); const f = files(); f[n] = text || ""; store.set("files", f); openFile(n); toast(n + " created"); }
function nameSheet(title, initial, done) {
  openSheet("<h3>" + escH(title) + '</h3><input id="nm" class="nm" value="' + escH(initial) + '" autocapitalize="off" autocorrect="off" spellcheck="false">' +
    '<button class="item ok" data-a="ok">OK</button>', { ok: () => { done($("#nm").value); window.scrollTo(0, 0); } }, true);
  const i = $("#nm"); setTimeout(() => { i.focus(); i.setSelectionRange(0, i.value.replace(/\.\w+$/, "").length); }, 60);
  i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const v = i.value; closeSheet(); done(v); window.scrollTo(0, 0); } });
}
function filesSheet() {
  const f = files(), names = Object.keys(f).sort();
  openSheet("<h3>Files</h3>" +
    item("new", "New file", "a fresh script saved on this phone") +
    item("scratch", "Scratch line" + (cur ? "" : " ✓"), "run and clear, like a REPL") +
    names.map(n => item("f:" + n, escH(n) + (n === cur ? " ✓" : ""), escH((f[n].split("\n").find(l => l.trim()) || "(empty)").slice(0, 60)) +
      " · " + f[n].length + " chars")).join("") +
    item("import", "Import from Files…", ".k .q or .txt files from the iPhone's Files app") +
    item("examples", "Open a bundled example", "Amber's own demo scripts, as a new file"),
    Object.assign({ new: () => nameSheet("New file", "untitled.k", n => newFile(n)), scratch: () => openFile(null),
      import: () => $("#imp").click(), examples: exampleSheet },
      Object.fromEntries(names.map(n => ["f:" + n, () => fileSheet(n)]))));
}
function fileSheet(n) {
  openSheet("<h3>" + escH(n) + "</h3>" + item("open", "Open") + item("run", "Run it", "every line, output in the log") +
    item("load", "Insert \\l " + escH(n), "load it from another file or the scratch line") +
    item("rename", "Rename") + item("dup", "Duplicate") + item("share", "Share or export", "AirDrop, Files, Messages…") +
    item("copy", "Copy its text") + item("del", "Delete", "this cannot be undone"), {
    open: () => openFile(n), run: () => { if (vm) addCell("\\l " + n, evalSrc(files()[n] || ""), n); },
    load: () => insert("\\l " + n + "\n"), copy: () => copyText(files()[n] || ""),
    rename: () => nameSheet("Rename " + n, n, v => { const f = files(), m = v.trim() === n ? n : uniqueName(v);
      if (m === n) return; f[m] = f[n]; delete f[n]; store.set("files", f); if (cur === n) { cur = m; store.set("cur", m); showName(); } toast("renamed to " + m); }),
    dup: () => newFile(n, files()[n]),
    share: () => shareFile(n, files()[n] || ""),
    del: () => { const f = files(); delete f[n]; store.set("files", f); if (cur === n) { cur = null; store.set("cur", null); openFile(null); } toast(n + " deleted"); },
  });
}
async function shareFile(n, text) {
  const file = new File([text], n, { type: "text/plain" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) return await navigator.share({ files: [file], title: n });
    if (navigator.share) return await navigator.share({ title: n, text });
  } catch (e) { if (e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = n; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$("#imp").addEventListener("change", async e => {
  let k = 0, last = null;
  for (const fl of e.target.files) { const t = await fl.text(); const n = uniqueName(fl.name); const f = files(); f[n] = t.replace(/\r\n?/g, "\n"); store.set("files", f); k++; last = n; }
  e.target.value = ""; if (last) { openFile(last); toast(k + (k > 1 ? " files" : " file") + " imported"); }
});
const EXAMPLES = ["basics.k", "tour.k", "practice.k", "extended.k", "attributes.k", "graphs.k", "hft.k", "tick.k", "wj.k", "test.k"];
function exampleSheet() {
  openSheet("<h3>Bundled examples</h3>" + EXAMPLES.map(n => item("x:" + n, n)).join(""),
    Object.fromEntries(EXAMPLES.map(n => ["x:" + n, () => { if (!vm) return toast("the engine is still starting");
      const t = vm.readFile(n); if (!t) return toast(n + " is not in this build"); newFile(n, t); }])));
}

// ---------------------------------------------------------------- hint bar and card
const info = new Map();
for (const p of K.prims) info.set(p.g, { g: p.g, lines: [["x" + p.g + "y", p.dy], [p.g + "x", p.mo]], ex: p.ex });
for (const p of K.adverbs) info.set(p.g, { g: p.g, lines: [["f" + p.g, p.mo]], ex: p.ex });
for (const p of K.punct) info.set(p.g, { g: p.g, lines: p.mo ? [["", p.mo]] : [], ex: p.ex });
for (const w of K.words) if (!info.has(w.w)) info.set(w.w, { g: w.w, lines: w.d ? [["", w.d]] : [], ex: w.ex });
function showHint(g) {
  const i = info.get(g); if (!i) return;
  hint.querySelector(".hg").textContent = g.length > 3 ? "" : g;
  const t = i.lines.map(([f, d]) => (f ? "<b>" + escH(f) + "</b> " : "") + escH(d)).join(" · ");
  const ex = i.ex.find(e => e[1] && !e[1].includes("\n") && e[1].length < 26);
  hint.querySelector(".ht").innerHTML = (g.length > 3 ? "<b>" + escH(g) + "</b> " : "") + t +
    (ex ? "  <code>" + escH(ex[0]) + "</code> → <code>" + escH(ex[1]) + "</code>" : "");
}
function showCard(g) {
  const i = info.get(g); if (!i) return;
  card.innerHTML = '<div class="big">' + escH(g) + "</div>" +
    i.lines.map(([f, d]) => '<div class="ln"><span class="f">' + escH(f) + "</span>" + escH(d) + "</div>").join("") +
    (i.ex.length ? '<div class="ex">' + i.ex.map((e, n) => '<button data-n="' + n + '"><span class="e">' + escH(e[0]) +
      '</span><span class="r">' + escH(e[1] || "(no output)") + "</span></button>").join("") + "</div>" : "") +
    '<div class="tip">tap an example to put it in the editor</div>';
  card.querySelectorAll(".ex button").forEach(b => b.onclick = () => { insert(i.ex[+b.dataset.n][0]); hideCard(); });
  card.style.bottom = (window.innerHeight - $("#tools").getBoundingClientRect().top + 6) + "px";
  card.classList.remove("hidden");
}
function hideCard() { card.classList.add("hidden"); }

// ---------------------------------------------------------------- keyboard
let page = store.get("page", "fn"), shift = false;
const key = (g, cls, act) => ({ g, cls: cls || "", act });
const ins = g => () => insert(g);
function pageFn() {
  const P = K.prims.map(p => p.g);
  return [
    P.slice(0, 10).map(g => key(g, "", ins(g))),
    P.slice(10, 20).map(g => key(g, "", ins(g))),
    K.adverbs.map(a => key(a.g, "adv", ins(a.g))).concat([key("`", "p", ins("`")), key("\"", "p", () => insertPair("\"", "\"")),
      key(";", "p", ins(";")), key("⌫", "fn", back)]),
    [key("(", "p", () => insertPair("(", ")")), key(")", "p", ins(")")), key("[", "p", () => insertPair("[", "]")), key("]", "p", ins("]")),
     key("{", "p", () => insertPair("{", "}")), key("}", "p", ins("}")), key("x", "var", ins("x")), key("y", "var", ins("y")),
     key("z", "var", ins("z")), key("⏎", "fn", ins("\n"))],
  ];
}
function pageAbc() {
  const L = ["qwertyuiop", "asdfghjkl", "zxcvbnm"], up = s => shift ? s.toUpperCase() : s;
  return [
    "1234567890".split("").map(d => key(d, "letter", ins(d))),
    L[0].split("").map(c => key(up(c), "letter", ins(up(c)))),
    L[1].split("").map(c => key(up(c), "letter", ins(up(c)))).concat([key("⌫", "fn", back)]),
    [key("⇧", "fn" + (shift ? " on" : ""), () => { shift = !shift; render(); })]
      .concat(L[2].split("").map(c => key(up(c), "letter", ins(up(c)))))
      .concat([key(".", "p", ins(".")), key("-", "", ins("-")), key("⏎", "fn", ins("\n"))]),
  ];
}
function bottom() {
  const tab = (id, lab) => key(lab, "tab" + (page === id ? " on" : ""), () => { page = id; store.set("page", id); render(); });
  return [tab("fn", "f(x)"), tab("q", "q"), tab("abc", "abc"), key("space", "fn wide", ins(" ")),
          key("◀", "fn", () => move(-1)), key("▶", "fn", () => move(1)), key("Run", "go", run)];
}
function render() {
  kb.innerHTML = "";
  const body = document.createElement("div"); body.className = "kbody";
  if (page === "q") {
    const w = document.createElement("div"); w.className = "words"; const seen = new Set();
    for (const x of K.words) { if (seen.has(x.w)) continue; seen.add(x.w); w.append(mk(key(x.w, "word", () => insert(x.w + " ")))); }
    body.append(w);
  } else for (const r of page === "fn" ? pageFn() : pageAbc()) { const d = document.createElement("div"); d.className = "row"; r.forEach(k => d.append(mk(k))); body.append(d); }
  const d = document.createElement("div"); d.className = "row"; bottom().forEach(k => d.append(mk(k)));
  kb.append(body, d);
}
function mk(k) { const b = document.createElement("button"); b.className = "k " + k.cls; b.type = "button"; b.tabIndex = -1;
  b.innerHTML = '<span class="g">' + escH(k.g) + "</span>"; b._k = k; return b; }

// the edit bar
const TOOLS = [["↑", () => recall(-1)], ["↓", () => recall(1)], ["undo", undo], ["copy", copySel], ["paste", paste], ["⌨", () => nativeEdit()]];
const tools = $("#tools");
TOOLS.forEach(([g, act]) => { const b = document.createElement("button"); b.className = "tb"; b.type = "button"; b.tabIndex = -1;
  b.textContent = g; b._k = { g, act }; tools.append(b); });

// presses: act on release on the key that was pressed, hold for the card, hold ⌫ and the moves to repeat.
// The key is taken from the touch point itself (elementFromPoint), not from event retargeting.
let held = null, timer = 0, rep = 0, longDone = false, downX = 0;
const repeating = new Set(["⌫", "◀", "▶", "undo"]);
function down(e) {
  const b = (document.elementFromPoint(e.clientX, e.clientY) || e.target).closest(".k, .tb"); if (!b) return;
  if (b.classList.contains("tb") && tools.scrollWidth > tools.clientWidth) { downX = e.clientX; }
  e.preventDefault(); held = b; longDone = false; b.classList.add("down");
  const k = b._k;
  if (repeating.has(k.g)) { k.act(); timer = setTimeout(() => { rep = setInterval(k.act, 60); }, 380); longDone = true; return; }
  if (info.has(k.g)) timer = setTimeout(() => { longDone = true; showCard(k.g); }, 430);
}
function release(e) {
  if (!held) return; const b = held, k = b._k; held = null; b.classList.remove("down");
  clearTimeout(timer); clearInterval(rep);
  if (e.type === "pointercancel" || (b.classList.contains("tb") && Math.abs(e.clientX - downX) > 12 && downX)) { downX = 0; return; }
  downX = 0;
  if (!longDone) { hideCard(); k.act(); if (info.has(k.g)) showHint(k.g); }
}
for (const el of [kb, tools]) {
  el.addEventListener("pointerdown", down); el.addEventListener("pointerup", release); el.addEventListener("pointercancel", release);
  el.addEventListener("contextmenu", e => e.preventDefault());
}
document.addEventListener("pointerdown", e => { if (!card.contains(e.target) && !kb.contains(e.target)) hideCard(); });

// a hardware keyboard (iPad, Mac): type straight into the editor
document.addEventListener("keydown", e => {
  if (!sheet.classList.contains("hidden")) return;
  const c = e.metaKey || e.ctrlKey;
  if (c && e.key === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (c && e.key === "a") { e.preventDefault(); return selectAll(); }
  if (c && e.key === "c") { e.preventDefault(); return copySel(); }
  if (c && e.key === "x") { e.preventDefault(); return cutSel(); }
  if (c) return;                                         // Cmd+V arrives as a paste event
  if (e.key === "Enter") { e.preventDefault(); return e.shiftKey ? run() : insert("\n"); }
  if (e.key === "Backspace") { e.preventDefault(); return back(); }
  if (e.key === "ArrowLeft") { e.preventDefault(); return move(-1); }
  if (e.key === "ArrowRight") { e.preventDefault(); return move(1); }
  if (e.key === "ArrowUp") { e.preventDefault(); return moveLine(-1); }
  if (e.key === "ArrowDown") { e.preventDefault(); return moveLine(1); }
  if (e.key.length === 1) { e.preventDefault(); insert(e.key); }
});
document.addEventListener("paste", e => { if (!sheet.classList.contains("hidden")) return;
  const t = (e.clipboardData || window.clipboardData).getData("text"); if (t) { e.preventDefault(); insert(t.replace(/\r\n?/g, "\n")); } });

// ---------------------------------------------------------------- sheets and the menu
const item = (a, label, sub) => '<button class="item" data-a="' + escH(a) + '">' + label + (sub ? "<small>" + sub + "</small>" : "") + "</button>";
function openSheet(html, acts, keepOpen) {
  sheet.innerHTML = '<div class="panel">' + html + "</div>"; sheet.classList.remove("hidden");
  sheet.querySelectorAll(".item").forEach(b => b.onclick = () => { const f = acts && acts[b.dataset.a]; if (!keepOpen || b.dataset.a === "ok") closeSheet(); f && f(); });
}
function closeSheet() { sheet.classList.add("hidden"); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo(0, 0); }
sheet.addEventListener("click", e => { if (e.target === sheet) closeSheet(); });
const SNIPS = [
  ["A table and a query", "t:([]sym:`a`b`a`c`b;px:10 20 30 40 50.0;sz:1 2 3 4 5)\nselect vwap:sz wavg px by sym from t"],
  ["Trains: z-score", "zs:(((-;avg)@);%;dev)\nzs 2 4 4 4 5 5 7 9.0"],
  ["Newton's method for √2", "{(x+2%x)%2}\\1"],
  ["Each-prior and scans", "deltas 1 4 9 16\n+\\1 2 3 4\n-':12 13 11 17"],
  ["Dates", "d:2026.01.05+til 5\nd\n`date$2026.01.05D09:30:00.000000000"],
  ["Ticks and bars", "gentq 1000\nselect o:first px,h:max px,l:min px,c:last px by sym from trades"],
  ["Dicts and grouping", "d:`a`b`c!1 2 3\nd`b\n=`x`y`x`z`y"],
];
let fs = store.get("fs", 17);
function setFont(d) { fs = Math.max(12, Math.min(24, fs + d)); store.set("fs", fs); document.documentElement.style.setProperty("--fs", fs + "px"); measure(); draw(); }
$("#menuBtn").onclick = () => openSheet("<h3>Amber</h3>" +
  item("files", "Files", cur ? "editing " + escH(cur) : "the scratch line") +
  item("snip", "Snippets", "tables, trains, Newton, dates, ticks") +
  item("native", "Edit with the iPhone keyboard", "for long names, native selection and paste") +
  item("copylog", "Copy the whole log") +
  '<div class="two">' + item("small", "A−") + item("big", "A+") + "</div>" +
  item("clear", "Clear the log") +
  item("reset", "Reset the session", "a fresh interpreter, saved definitions forgotten") +
  item("about", "About"), {
  files: filesSheet, native: () => nativeEdit(),
  snip: () => openSheet("<h3>Snippets</h3>" + SNIPS.map((x, n) => item("s" + n, x[0], escH(x[1].split("\n")[0]))).join(""),
    Object.fromEntries(SNIPS.map((x, n) => ["s" + n, () => putText(x[1])]))),
  copylog: () => copyText([...log.querySelectorAll(".cell")].filter(c => c._src).map(c => c._src + "\n" + c._out).join("\n\n")),
  small: () => setFont(-1), big: () => setFont(1),
  clear: () => { log.innerHTML = ""; },
  reset: () => { store.set("defs", []); log.innerHTML = '<div class="cell sys">a fresh session</div>'; boot(); },
  about: () => openSheet('<h3>About</h3><div class="about">Amber ' + (vm ? vm.version() : "") +
    ", the q-flavoured array language, compiled to WebAssembly and running entirely on this device. Nothing is sent anywhere." +
    "<br><br><b>Keys.</b> The first page holds every primitive and adverb: tap to type, hold for what it does and examples, each" +
    " answered by this engine. <b>q</b> has the words, <b>abc</b> the letters. The bar above: ↑ ↓ step through your earlier" +
    " commands, then undo, copy (the selection, or everything), paste, and ⌨ for the iPhone keyboard." +
    "<br><br><b>Editor.</b> Tap to place the caret, double tap to select a word." +
    "<br><br><b>Log.</b> Tap an input to edit it again, tap an output to copy it, hold either for more." +
    "<br><br><b>Files.</b> Scripts are saved on this phone as you type; <code>\\l name.k</code> runs one from another. Import" +
    " and share them through the Files app." +
    "<br><br>Amber is free software under the GNU AGPLv3. Source: github.com/BonucciAndrea/amber</div>"),
});
$("#fileBtn").onclick = filesSheet;
$("#runBtn").onclick = run;

// ---------------------------------------------------------------- start: nothing ever scrolls the page
window.addEventListener("scroll", () => { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); }, { passive: true });
document.addEventListener("touchmove", e => { if (!e.target.closest("#log, #tools, .words, #sheet .panel, #card, #ed, .out")) e.preventDefault(); }, { passive: false });
document.addEventListener("dblclick", e => e.preventDefault(), { passive: false });
window.addEventListener("resize", () => { measure(); draw(); });
document.documentElement.style.setProperty("--fs", fs + "px");
if (cur && files()[cur] === undefined) { cur = null; store.set("cur", null); }
E.text = cur ? files()[cur] : store.get("draft", ""); E.a = E.b = E.text.length;
render(); showName(); measure(); draw(); boot();
window.addEventListener("pagehide", save);
document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
