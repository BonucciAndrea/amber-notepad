/* app.js - the phone notepad: a custom keyboard of every Amber primitive, an editor, a log, files.
   Keys act on pointerup (pointerdown is cancelled so the editor keeps its caret and iOS never shows
   its own keyboard); holding a key opens its card with the engine's own examples.
   Files are named scripts kept on the phone (localStorage); a file in the editor saves itself as you
   type, Run keeps its text, and `\l name.k` in any input runs a saved file. With no file open the
   editor is a scratch line: Run logs it and clears it, as a REPL does. */
(function () {
"use strict";
const $ = s => document.querySelector(s);
const K = window.AMBER_KEYS;
const ed = $("#ed"), log = $("#log"), kb = $("#kb"), hint = $("#hint"), card = $("#card"), sheet = $("#sheet");
const store = { get: (k, d) => { try { const v = localStorage.getItem("amber." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
                set: (k, v) => { try { localStorage.setItem("amber." + k, JSON.stringify(v)); } catch (e) { toast("storage is full"); } } };
const escH = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------- toast
let toastT = 0;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add("hidden"), 1400); }

// ---------------------------------------------------------------- engine
let vm = null;
const boot = async () => {
  try {
    vm = await new AmberVM().boot();
    $("#ver").textContent = vm.version();
    $("#boot").textContent = "Amber " + vm.version() + " · the real interpreter, running on this phone, offline";
    for (const s of store.get("defs", [])) evalSrc(s);             // replay the session's definitions
  } catch (e) { $("#boot").textContent = "the engine failed to start: " + e.message; }
};
// an error is reported twice: for the user's code and again for the engine's eval wrapper
// (wprint(. qrw "...")); the desktop IDE drops the second report, and so does this
function dropWrapper(out) {
  if (!out.includes("error[")) return out;
  const blocks = []; let cur = [];
  for (const line of out.split("\n")) {
    if (/^error\[/.test(stripAnsi(line)) && cur.length) { blocks.push(cur); cur = []; }
    cur.push(line);
  }
  blocks.push(cur);
  return blocks.filter(b => !/wprint\(|\bqrw "/.test(stripAnsi(b.join("\n")))).map(b => b.join("\n")).join("\n");
}
// evaluate a script; `\l name` of a saved file runs that file's statements (at most 8 deep)
function evalSrc(src, depth) {
  let out = ""; depth = depth || 0;
  for (const st of amberStatements(src)) {
    const m = /^\\l\s+(\S+)\s*$/.exec(st.trim()), fs = files();
    if (m && fs[m[1]] !== undefined) {
      out += depth < 8 ? evalSrc(fs[m[1]], depth + 1) : "\x1b[31m'\\l nested too deep\x1b[0m\n";
    } else out += dropWrapper(vm.eval(st));
  }
  return out;
}

// ---------------------------------------------------------------- input echo highlighting
const WORDS = new Set(K.words.map(w => w.w));
function hl(src) {
  const re = /("(?:[^"\\]|\\.)*"?)|(`[\w.:\/]*)|(\b\d[\d.]*(?:[eE]-?\d+)?[a-zA-Z]?\b|0[NnWw]\b)|('|\/:|\\:|':|\/|\\)|([+\-*%!&|<>=~,^#_$?@.:])|(\b[A-Za-z][\w.]*\b)|(\s\/.*$)/gm;
  return src.replace(re, (m, s, y, n, a, v, w, c) => {
    if (s) return '<span class="t-s">' + escH(s) + "</span>";
    if (y) return '<span class="t-y">' + escH(y) + "</span>";
    if (n) return '<span class="t-n">' + n + "</span>";
    if (a) return '<span class="t-a">' + escH(a) + "</span>";
    if (v) return '<span class="t-v">' + escH(v) + "</span>";
    if (w) return WORDS.has(w) ? '<span class="t-w">' + w + "</span>" : w;
    if (c) return '<span class="t-c">' + escH(c) + "</span>";
    return escH(m);
  });
}

// ---------------------------------------------------------------- the log
let hist = store.get("hist", []), hpos = -1;
function addCell(src, out, tag) {
  const c = document.createElement("div"); c.className = "cell";
  const i = document.createElement("div"); i.className = "in"; i.innerHTML = (tag ? '<span class="tag">' + escH(tag) + "</span>" : "") + hl(src);
  const o = document.createElement("div");
  o.className = "out" + (/^\s*(error\[|')/.test(stripAnsi(out)) ? " err" : "");
  o.innerHTML = ansiToHtml(out.replace(/\n+$/, ""));
  c._src = src; c._out = stripAnsi(out).replace(/\n+$/, "");
  c.append(i, o); log.append(c); log.scrollTop = log.scrollHeight;
}
// tap an input: edit it again; tap an output: copy it; hold either: the cell's menu
let cellT = 0, cellLong = false, cellY = 0;
log.addEventListener("pointerdown", e => { const c = e.target.closest(".cell"); if (!c || !c._src) return;
  cellLong = false; cellY = e.clientY; cellT = setTimeout(() => { cellLong = true; cellMenu(c); }, 480); });
["pointerup", "pointercancel", "pointermove"].forEach(t => log.addEventListener(t, e => {
  if (t === "pointermove" && Math.abs(e.clientY - cellY) < 8) return; clearTimeout(cellT); }));
log.addEventListener("click", e => {
  const c = e.target.closest(".cell"); if (!c || !c._src || cellLong) return;
  if (e.target.closest(".out")) { copyText(c._out); return; }
  if (e.target.closest(".in")) putText(c._src);
});
log.addEventListener("contextmenu", e => { if (e.target.closest(".cell")) e.preventDefault(); });
function cellMenu(c) {
  openSheet("<h3>This entry</h3>" + item("cin", "Copy the input") + item("cout", "Copy the output") +
    item("edit", "Edit it again") + item("rerun", "Run it again") + item("del", "Remove it from the log"), {
    cin: () => copyText(c._src), cout: () => copyText(c._out), edit: () => putText(c._src),
    rerun: () => runText(c._src), del: () => c.remove() });
}
function runText(src) {
  if (!vm) { addCell(src, "the engine is still starting"); return; }
  addCell(src, evalSrc(src));
  hist = hist.filter(h => h !== src); hist.push(src); hist = hist.slice(-200); hpos = -1; store.set("hist", hist);
  if (/^[A-Za-z][\w.]*\s*:[^:]/.test(src) || /^\\l /.test(src)) { const d = store.get("defs", []); d.push(src); store.set("defs", d.slice(-100)); }
}
function run() {
  const src = ed.value.trim(); if (!src) return;
  if (cur) { if (!vm) return toast("the engine is still starting"); addCell(src, evalSrc(src), cur); return; }   // a file stays
  runText(src); snap(); ed.value = ""; grow();
}
// run the line under the caret, or the selection
function runLine() {
  const v = ed.value, s = ed.selectionStart, e = ed.selectionEnd;
  let t = s !== e ? v.slice(s, e) : v.slice(v.lastIndexOf("\n", s - 1) + 1, (v.indexOf("\n", s) + 1 || v.length + 1) - 1);
  t = t.trim(); if (t) runText(t);
}
function recall(dir) {
  if (cur) return toast("the history is for the scratch line");
  if (!hist.length) return;
  hpos = hpos < 0 ? (dir < 0 ? hist.length - 1 : -1) : hpos + dir;
  if (hpos >= hist.length || hpos < 0 && dir > 0) { hpos = -1; setEditor(""); } else { hpos = Math.max(0, hpos); setEditor(hist[hpos]); }
  placeEnd();
}

// ---------------------------------------------------------------- editor, undo, clipboard
let undoS = [], redoS = [];
function snap() { const t = { v: ed.value, s: ed.selectionStart, e: ed.selectionEnd }, top = undoS[undoS.length - 1];
  if (!top || top.v !== t.v) { undoS.push(t); if (undoS.length > 300) undoS.shift(); redoS = []; } }
function restore(t) { ed.value = t.v; ed.setSelectionRange(t.s, t.e); grow(); }
function undo() { if (!undoS.length) return toast("nothing to undo"); redoS.push({ v: ed.value, s: ed.selectionStart, e: ed.selectionEnd }); restore(undoS.pop()); }
function redo() { if (!redoS.length) return toast("nothing to redo"); undoS.push({ v: ed.value, s: ed.selectionStart, e: ed.selectionEnd }); restore(redoS.pop()); }
let saveT = 0;
function grow() {
  ed.style.height = "auto"; ed.style.height = Math.min(ed.scrollHeight, window.innerHeight * 0.34) + "px";
  clearTimeout(saveT); saveT = setTimeout(save, 250);
}
function focusEd() { if (document.activeElement !== ed) ed.focus({ preventScroll: true }); }
function placeEnd() { focusEd(); const n = ed.value.length; ed.setSelectionRange(n, n); }
function setEditor(v) { snap(); ed.value = v; grow(); }
function putText(t) { if (cur) insert(t); else { setEditor(t); placeEnd(); } }   // a file is never replaced
function insert(t) { snap(); focusEd(); const s = ed.selectionStart, e = ed.selectionEnd; ed.setRangeText(t, s, e, "end"); grow(); }
function insertPair(o, c) { snap(); focusEd(); const s = ed.selectionStart, e = ed.selectionEnd, mid = ed.value.slice(s, e);
  ed.setRangeText(o + mid + c, s, e, "end"); const p = s + o.length + mid.length; ed.setSelectionRange(p, p); grow(); }
function back() { snap(); focusEd(); const s = ed.selectionStart, e = ed.selectionEnd;
  if (s !== e) ed.setRangeText("", s, e, "end"); else if (s > 0) ed.setRangeText("", s - 1, s, "end"); grow(); }
function move(d) { focusEd(); const p = Math.max(0, Math.min(ed.value.length, ed.selectionStart + d)); ed.setSelectionRange(p, p); }
function moveLine(d) {                                  // up/down a line, keeping the column
  focusEd(); const v = ed.value, p = ed.selectionStart, ls = v.lastIndexOf("\n", p - 1) + 1, col = p - ls;
  if (d < 0) { if (!ls) return ed.setSelectionRange(0, 0); const ps = v.lastIndexOf("\n", ls - 2) + 1; const q = Math.min(ps + col, ls - 1); ed.setSelectionRange(q, q); }
  else { const le = v.indexOf("\n", p); if (le < 0) return ed.setSelectionRange(v.length, v.length);
    const ne = v.indexOf("\n", le + 1), q = Math.min(le + 1 + col, ne < 0 ? v.length : ne); ed.setSelectionRange(q, q); }
}
function selectAll() { focusEd(); if (ed.selectionStart === 0 && ed.selectionEnd === ed.value.length) { const n = ed.value.length; ed.setSelectionRange(n, n); }
  else ed.setSelectionRange(0, ed.value.length); }
function selectLine() { focusEd(); const v = ed.value, p = ed.selectionStart, a = v.lastIndexOf("\n", p - 1) + 1, b = v.indexOf("\n", p);
  ed.setSelectionRange(a, b < 0 ? v.length : b); }
async function copyText(t, quiet) {
  if (!t) return toast("nothing to copy");
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = 0;
    document.body.append(ta); ta.select(); try { document.execCommand("copy"); } catch (e2) {} ta.remove(); focusEd(); }
  if (!quiet) toast("copied");
}
const selected = () => ed.value.slice(ed.selectionStart, ed.selectionEnd);
function copySel() { copyText(selected() || ed.value); }
function cutSel() { const t = selected(); if (!t) return toast("select something to cut"); copyText(t, true); back(); toast("cut"); }
async function paste() {
  try { const t = await navigator.clipboard.readText(); if (t) insert(t.replace(/\r\n?/g, "\n")); else toast("the clipboard is empty"); }
  catch (e) { toast("hold the editor and choose Paste"); }
}
ed.addEventListener("beforeinput", snap);                // typing with the system keyboard, native paste
ed.addEventListener("input", grow);
ed.addEventListener("keydown", e => {
  if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
  if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
});

// ---------------------------------------------------------------- files
let cur = store.get("cur", null);
const files = () => store.get("files", {});
function save() {
  if (cur) { const f = files(); f[cur] = ed.value; store.set("files", f); } else store.set("draft", ed.value);
}
function openFile(name) {
  save(); cur = name; store.set("cur", cur); undoS = []; redoS = [];
  ed.value = name ? (files()[name] || "") : store.get("draft", ""); grow(); showName(); placeEnd();
}
function showName() { $("#fileBtn").innerHTML = cur ? escH(cur) : "scratch"; $("#fileBtn").classList.toggle("on", !!cur); }
function uniqueName(n) { n = n.trim().replace(/[\/\\\s]+/g, "_") || "untitled"; if (!/\.[kq]$|\.txt$/.test(n)) n += ".k";
  const f = files(); if (f[n] === undefined) return n; const b = n.replace(/(\.\w+)$/, ""), x = n.slice(b.length);
  for (let i = 2; ; i++) if (f[b + "-" + i + x] === undefined) return b + "-" + i + x; }
function newFile(name, text) { const n = uniqueName(name); const f = files(); f[n] = text || ""; store.set("files", f); openFile(n); toast(n + " created"); }
function nameSheet(title, initial, done) {
  openSheet("<h3>" + escH(title) + '</h3><input id="nm" class="nm" value="' + escH(initial) + '" autocapitalize="off" autocorrect="off" spellcheck="false">' +
    '<button class="item ok" data-a="ok">OK</button>', { ok: () => done($("#nm").value) }, true);
  setTimeout(() => { const i = $("#nm"); i.focus(); i.setSelectionRange(0, i.value.replace(/\.\w+$/, "").length); }, 60);
  $("#nm").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const v = $("#nm").value; closeSheet(); done(v); } });
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
    dup: () => { const f = files(); newFile(n, f[n]); },
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
  const rows = page === "fn" ? pageFn() : page === "abc" ? pageAbc() : null;
  if (page === "q") {
    const w = document.createElement("div"); w.className = "words"; const seen = new Set();
    for (const x of K.words) { if (seen.has(x.w)) continue; seen.add(x.w); w.append(mk(key(x.w, "word", () => insert(x.w + " ")))); }
    kb.append(w);
  }
  for (const r of rows || []) { const d = document.createElement("div"); d.className = "row"; r.forEach(k => d.append(mk(k))); kb.append(d); }
  const d = document.createElement("div"); d.className = "row"; bottom().forEach(k => d.append(mk(k))); kb.append(d);
}
function mk(k) { const b = document.createElement("button"); b.className = "k " + k.cls; b.type = "button";
  b.innerHTML = '<span class="g">' + escH(k.g) + "</span>"; b._k = k; return b; }

// the edit bar: undo redo, line up/down, select, copy cut paste, run the line
const TOOLS = [["↶", "undo", undo], ["↷", "redo", redo], ["▲", "line up", () => moveLine(-1)], ["▼", "line down", () => moveLine(1)],
  ["all", "select all", selectAll], ["line", "select line", selectLine], ["copy", "copy", copySel], ["cut", "cut", cutSel],
  ["paste", "paste", paste], ["⏵ line", "run this line", runLine], ["↑", "history", () => recall(-1)]];
const tools = $("#tools");
TOOLS.forEach(([g, label, act]) => { const b = document.createElement("button"); b.className = "tb" + (g.length > 2 ? " w" : "");
  b.type = "button"; b.textContent = g; b.title = label; b._k = { g, act }; tools.append(b); });

// pointer handling: act on release, hold for the card, hold ⌫ and the arrows to repeat
let held = null, timer = 0, rep = 0, longDone = false;
const repeating = new Set(["⌫", "◀", "▶", "▲", "▼", "↶", "↷"]);
function down(e) {
  const b = e.target.closest(".k, .tb"); if (!b) return;
  e.preventDefault(); held = b; longDone = false; b.classList.add("down");
  const k = b._k;
  if (repeating.has(k.g)) { k.act(); timer = setTimeout(() => { rep = setInterval(k.act, 60); }, 380); longDone = true; return; }
  if (info.has(k.g)) timer = setTimeout(() => { longDone = true; showCard(k.g); }, 430);
}
function release(e) {
  if (!held) return; const b = held, k = b._k; held = null; b.classList.remove("down");
  clearTimeout(timer); clearInterval(rep);
  if (e.type === "pointercancel") return;
  if (!longDone) { hideCard(); k.act(); if (info.has(k.g)) showHint(k.g); }
}
for (const el of [kb, tools]) {
  el.addEventListener("pointerdown", down); el.addEventListener("pointerup", release); el.addEventListener("pointercancel", release);
  el.addEventListener("contextmenu", e => e.preventDefault());
}
document.addEventListener("pointerdown", e => { if (!card.contains(e.target) && !kb.contains(e.target)) hideCard(); });

// the system keyboard on demand (for long names), back to ours from the menu or on Run
let sysKb = false;
function setSysKb(on) { sysKb = on; ed.setAttribute("inputmode", on ? "text" : "none"); kb.classList.toggle("hidden", on);
  hint.classList.toggle("hidden", on); ed.blur(); setTimeout(() => ed.focus(), 30); }

// ---------------------------------------------------------------- sheets and the menu
const item = (a, label, sub) => '<button class="item" data-a="' + escH(a) + '">' + label + (sub ? "<small>" + sub + "</small>" : "") + "</button>";
function openSheet(html, acts, keepOpen) {
  sheet.innerHTML = '<div class="panel">' + html + "</div>"; sheet.classList.remove("hidden");
  sheet.querySelectorAll(".item").forEach(b => b.onclick = () => { const f = acts && acts[b.dataset.a]; if (!keepOpen || b.dataset.a === "ok") closeSheet(); f && f(); });
}
function closeSheet() { sheet.classList.add("hidden"); }
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
function setFont(d) { fs = Math.max(12, Math.min(24, fs + d)); store.set("fs", fs); document.documentElement.style.setProperty("--fs", fs + "px"); grow(); }
$("#menuBtn").onclick = () => openSheet("<h3>Amber</h3>" +
  item("files", "Files", cur ? "editing " + escH(cur) : "the scratch line") +
  item("snip", "Snippets", "tables, trains, Newton, dates, ticks") +
  item("copylog", "Copy the whole log") +
  item("sys", sysKb ? "Use the Amber keyboard" : "Use the system keyboard", "for typing long names") +
  '<div class="two">' + item("small", "A−") + item("big", "A+") + "</div>" +
  item("clear", "Clear the log") +
  item("reset", "Reset the session", "a fresh interpreter, saved definitions forgotten") +
  item("about", "About"), {
  files: filesSheet,
  snip: () => openSheet("<h3>Snippets</h3>" + SNIPS.map((x, n) => item("s" + n, x[0], escH(x[1].split("\n")[0]))).join(""),
    Object.fromEntries(SNIPS.map((x, n) => ["s" + n, () => putText(x[1])]))),
  copylog: () => copyText([...log.querySelectorAll(".cell")].filter(c => c._src).map(c => c._src + "\n" + c._out).join("\n\n")),
  sys: () => setSysKb(!sysKb), small: () => setFont(-1), big: () => setFont(1),
  clear: () => { log.innerHTML = ""; },
  reset: () => { store.set("defs", []); log.innerHTML = '<div class="cell sys">a fresh session</div>'; boot(); },
  about: () => openSheet('<h3>About</h3><div class="about">Amber ' + (vm ? vm.version() : "") +
    ", the q-flavoured array language, compiled to WebAssembly and running entirely on this device. Nothing is sent anywhere." +
    "<br><br><b>Keys.</b> The first page holds every primitive and adverb: tap to type, hold for what it does and examples, each" +
    " answered by this engine. <b>q</b> has the words, <b>abc</b> the letters. The bar above has undo, line moves, selection," +
    " copy, cut, paste and run-this-line." +
    "<br><br><b>Log.</b> Tap an input to edit it again, tap an output to copy it, hold either for more." +
    "<br><br><b>Files.</b> Scripts are saved on this phone as you type; <code>\\l name.k</code> runs one from another. Import" +
    " and share them through the Files app." +
    "<br><br>Amber is free software under the GNU AGPLv3. Source: github.com/BonucciAndrea/amber</div>"),
});
$("#fileBtn").onclick = filesSheet;
$("#runBtn").onclick = () => { if (sysKb) setSysKb(false); run(); };

// ---------------------------------------------------------------- keep the page still (iOS)
// Focusing the editor makes iOS scroll the page to show it, even though the page is position:fixed;
// the keys are then drawn in one place and hit in another. Undo any such scroll at once, and size the
// app to the visual viewport so drawing and touching always agree.
const app = $("#app");
function unscroll() { if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  if (document.documentElement.scrollTop) document.documentElement.scrollTop = 0; if (document.body.scrollTop) document.body.scrollTop = 0; }
function fit() { const v = window.visualViewport; app.style.height = (v ? v.height : window.innerHeight) + "px";
  app.style.transform = v && v.offsetTop ? "translateY(" + v.offsetTop + "px)" : ""; unscroll(); }
window.addEventListener("scroll", unscroll, { passive: true });
if (window.visualViewport) { visualViewport.addEventListener("resize", fit); visualViewport.addEventListener("scroll", fit); }
window.addEventListener("orientationchange", () => setTimeout(fit, 300));
ed.addEventListener("focus", () => { unscroll(); setTimeout(fit, 0); setTimeout(fit, 300); });
document.addEventListener("touchmove", e => { if (!e.target.closest("#log, #tools, .words, #sheet .panel, #card, #ed")) e.preventDefault(); }, { passive: false });
fit();

// ---------------------------------------------------------------- start
document.documentElement.style.setProperty("--fs", fs + "px");
if (cur && files()[cur] === undefined) { cur = null; store.set("cur", null); }
ed.value = cur ? files()[cur] : store.get("draft", ""); grow(); showName(); render(); boot();
window.addEventListener("pagehide", save);
document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
