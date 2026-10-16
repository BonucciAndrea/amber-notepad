/* app.js - the phone notepad: a custom keyboard of every Amber primitive, an editor, a log.
   Keys act on pointerup (pointerdown is cancelled so the editor keeps its caret and iOS never shows
   its own keyboard); holding a key opens its card with the engine's own examples. */
(function () {
"use strict";
const $ = s => document.querySelector(s);
const K = window.AMBER_KEYS;
const ed = $("#ed"), log = $("#log"), kb = $("#kb"), hint = $("#hint"), card = $("#card"), sheet = $("#sheet");
const store = { get: (k, d) => { try { const v = localStorage.getItem("amber." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
                set: (k, v) => { try { localStorage.setItem("amber." + k, JSON.stringify(v)); } catch (e) {} } };

// ---------------------------------------------------------------- engine
let vm = null;
const boot = async () => {
  try {
    vm = await new AmberVM().boot();
    $("#ver").textContent = vm.version();
    $("#boot").textContent = "Amber " + vm.version() + " · the real interpreter, running on this phone, offline";
    for (const s of store.get("defs", [])) vm.eval(s);          // re-run the session's assignments
  } catch (e) { $("#boot").textContent = "the engine failed to start: " + e.message; }
};

// ---------------------------------------------------------------- input echo highlighting
function hl(src) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const re = /("(?:[^"\\]|\\.)*"?)|(`[\w.:\/]*)|(\b\d[\d.]*(?:[eE]-?\d+)?[a-zA-Z]?\b|0[NnWw]\b)|('|\/:|\\:|':|\/|\\)|([+\-*%!&|<>=~,^#_$?@.:])|(\b[A-Za-z][\w.]*\b)|(\s\/.*$)/gm;
  const words = new Set(K.words.map(w => w.w));
  return src.replace(re, (m, s, y, n, a, v, w, c) => {
    if (s) return '<span class="t-s">' + esc(s) + "</span>";
    if (y) return '<span class="t-y">' + esc(y) + "</span>";
    if (n) return '<span class="t-n">' + n + "</span>";
    if (a) return '<span class="t-a">' + esc(a) + "</span>";
    if (v) return '<span class="t-v">' + esc(v) + "</span>";
    if (w) return words.has(w) ? '<span class="t-w">' + w + "</span>" : w;
    if (c) return '<span class="t-c">' + esc(c) + "</span>";
    return esc(m);
  });
}

// ---------------------------------------------------------------- run
let hist = store.get("hist", []), hpos = -1;
function addCell(src, out) {
  const c = document.createElement("div"); c.className = "cell";
  const i = document.createElement("div"); i.className = "in"; i.innerHTML = hl(src);
  i.onclick = () => { ed.value = src; grow(); placeEnd(); };
  const o = document.createElement("div"); o.className = "out" + (/'|error|E0\d\d\d/.test(stripAnsi(out).slice(0, 40)) && /\x1b\[[^m]*3[1;]/.test(out) ? " err" : "");
  o.innerHTML = ansiToHtml(out.replace(/\n+$/, ""));
  c.append(i, o); log.append(c); log.scrollTop = log.scrollHeight;
}
function run() {
  const src = ed.value.trim(); if (!src) return;
  if (!vm) { addCell(src, "the engine is still starting"); return; }
  let out = "";
  for (const st of amberStatements(src)) out += dropWrapper(vm.eval(st));
  addCell(src, out);
  hist = hist.filter(h => h !== src); hist.push(src); hist = hist.slice(-200); hpos = -1; store.set("hist", hist);
  if (/^[A-Za-z][\w.]*\s*:[^:]/.test(src) || /^\\l /.test(src)) { const d = store.get("defs", []); d.push(src); store.set("defs", d.slice(-100)); }
  ed.value = ""; grow(); store.set("draft", "");
}
// an error is reported twice: once for the user's code and once more for the engine's eval wrapper
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
function recall(dir) {
  if (!hist.length) return;
  hpos = hpos < 0 ? (dir < 0 ? hist.length - 1 : -1) : hpos + dir;
  if (hpos >= hist.length) { hpos = -1; ed.value = ""; } else { hpos = Math.max(0, hpos); ed.value = hist[hpos]; }
  grow(); placeEnd();
}

// ---------------------------------------------------------------- editor helpers
function grow() { ed.style.height = "auto"; ed.style.height = Math.min(ed.scrollHeight, 9.8 * 17 * 1.4) + "px"; store.set("draft", ed.value); }
function focusEd() { if (document.activeElement !== ed) ed.focus({ preventScroll: true }); }
function placeEnd() { focusEd(); const n = ed.value.length; ed.setSelectionRange(n, n); }
function insert(t) {
  focusEd(); const s = ed.selectionStart, e = ed.selectionEnd;
  ed.setRangeText(t, s, e, "end");
  // a pair inserts both halves and puts the caret between them
  grow();
}
function insertPair(o, c) { focusEd(); const s = ed.selectionStart, e = ed.selectionEnd, mid = ed.value.slice(s, e);
  ed.setRangeText(o + mid + c, s, e, "end"); const p = s + o.length + mid.length; ed.setSelectionRange(p, p); grow(); }
function back() { focusEd(); const s = ed.selectionStart, e = ed.selectionEnd;
  if (s !== e) ed.setRangeText("", s, e, "end"); else if (s > 0) ed.setRangeText("", s - 1, s, "end"); grow(); }
function move(d) { focusEd(); const p = Math.max(0, Math.min(ed.value.length, ed.selectionStart + d)); ed.setSelectionRange(p, p); }

// ---------------------------------------------------------------- hint bar and card
const info = new Map();
for (const p of K.prims) info.set(p.g, { g: p.g, lines: [["x" + p.g + "y", p.dy], [p.g + "x", p.mo]], ex: p.ex });
for (const p of K.adverbs) info.set(p.g, { g: p.g, lines: [["f" + p.g, p.mo]], ex: p.ex });
for (const p of K.punct) info.set(p.g, { g: p.g, lines: p.mo ? [["", p.mo]] : [], ex: p.ex });
for (const w of K.words) if (!info.has(w.w)) info.set(w.w, { g: w.w, lines: w.d ? [["", w.d]] : [], ex: w.ex });
const escH = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
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
const key = (g, cls, act, cap) => ({ g, cls: cls || "", act, cap });
const ins = g => () => insert(g);
function pageFn() {
  const P = K.prims.map(p => p.g);
  return [
    P.slice(0, 10).map(g => key(g, "", ins(g))),
    P.slice(10, 20).map(g => key(g, "", ins(g))),
    K.adverbs.map(a => key(a.g, "adv", ins(a.g))).concat([key("`", "p", ins("`")), key("\"", "p", () => insertPair("\"", "\"")),
      key(";", "p", ins(";")), key("⌫", "fn", back, "")]),
    [key("(", "p", () => insertPair("(", ")")), key(")", "p", ins(")")), key("[", "p", () => insertPair("[", "]")), key("]", "p", ins("]")),
     key("{", "p", () => insertPair("{", "}")), key("}", "p", ins("}")), key("x", "var", ins("x")), key("y", "var", ins("y")),
     key("z", "var", ins("z")), key("⏎", "fn", ins("\n"), "")],
  ];
}
function pageAbc() {
  const L = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  const up = s => shift ? s.toUpperCase() : s;
  return [
    "1234567890".split("").map(d => key(d, "letter", ins(d), "")),
    L[0].split("").map(c => key(up(c), "letter", ins(up(c)), "")),
    L[1].split("").map(c => key(up(c), "letter", ins(up(c)), "")).concat([key("⌫", "fn", back, "")]),
    [key("⇧", "fn" + (shift ? " on" : ""), () => { shift = !shift; render(); }, "")]
      .concat(L[2].split("").map(c => key(up(c), "letter", ins(up(c)), "")))
      .concat([key(".", "p", ins("."), ""), key("-", "", ins("-"), ""), key("⏎", "fn", ins("\n"), "")]),
  ];
}
function bottom() {
  const tab = (id, lab) => key(lab, "tab" + (page === id ? " on" : ""), () => { page = id; store.set("page", id); render(); }, "");
  return [tab("fn", "f(x)"), tab("q", "q"), tab("abc", "abc"), key("space", "fn wide", ins(" "), ""),
          key("◀", "fn", () => move(-1), ""), key("▶", "fn", () => move(1), ""), key("↑", "fn", () => recall(-1), ""),
          key("Run", "go", run, "")];
}
function render() {
  kb.innerHTML = "";
  const rows = page === "fn" ? pageFn() : page === "abc" ? pageAbc() : null;
  if (page === "q") {
    const w = document.createElement("div"); w.className = "words";
    const seen = new Set();
    for (const x of K.words) { if (seen.has(x.w)) continue; seen.add(x.w); w.append(mk(key(x.w, "word", () => insert(x.w + " "), ""))); }
    kb.append(w);
  }
  for (const r of rows || []) { const d = document.createElement("div"); d.className = "row"; r.forEach(k => d.append(mk(k))); kb.append(d); }
  const d = document.createElement("div"); d.className = "row"; bottom().forEach(k => d.append(mk(k))); kb.append(d);
}
function mk(k) {
  const b = document.createElement("button"); b.className = "k " + k.cls; b.type = "button";
  b.innerHTML = '<span class="g">' + escH(k.g) + "</span>";
  b._k = k; return b;
}

// pointer handling: act on release, hold for the card, hold ⌫ and the arrows to repeat
let held = null, timer = 0, rep = 0, longDone = false;
const repeating = new Set(["⌫", "◀", "▶"]);
kb.addEventListener("pointerdown", e => {
  const b = e.target.closest(".k"); if (!b) return;
  e.preventDefault(); held = b; longDone = false; b.classList.add("down");
  const k = b._k;
  if (repeating.has(k.g)) { k.act(); timer = setTimeout(() => { rep = setInterval(k.act, 55); }, 380); longDone = true; return; }
  if (info.has(k.g)) timer = setTimeout(() => { longDone = true; showCard(k.g); }, 430);
});
const release = e => {
  if (!held) return; const b = held, k = b._k; held = null; b.classList.remove("down");
  clearTimeout(timer); clearInterval(rep);
  if (e.type === "pointercancel") return;
  if (!longDone) { hideCard(); k.act(); if (info.has(k.g)) showHint(k.g); }
};
kb.addEventListener("pointerup", release); kb.addEventListener("pointercancel", release);
kb.addEventListener("pointerleave", e => { if (held && e.target === kb) release({ type: "pointercancel" }); });
document.addEventListener("pointerdown", e => { if (!card.contains(e.target) && !kb.contains(e.target)) hideCard(); });
kb.addEventListener("contextmenu", e => e.preventDefault());

// the system keyboard on demand (for long names), back to ours on Run or from the menu
let sysKb = false;
function setSysKb(on) { sysKb = on; ed.setAttribute("inputmode", on ? "text" : "none"); kb.classList.toggle("hidden", on);
  hint.classList.toggle("hidden", on); ed.blur(); setTimeout(() => ed.focus(), 30); }
ed.addEventListener("keydown", e => { if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey || sysKb)) { e.preventDefault(); run(); } });
ed.addEventListener("input", grow);

// ---------------------------------------------------------------- menu
const SNIPS = [
  ["A table and a query", "t:([]sym:`a`b`a`c`b;px:10 20 30 40 50.0;sz:1 2 3 4 5)\nselect vwap:sz wavg px by sym from t"],
  ["Trains: z-score", "zs:(((-;avg)@);%;dev)\nzs 2 4 4 4 5 5 7 9.0"],
  ["Newton's method for √2", "{(x+2%x)%2}\\1"],
  ["Each-prior and scans", "deltas 1 4 9 16\n+\\1 2 3 4\n-':12 13 11 17"],
  ["Dates", "d:2026.01.05+til 5\nd\n`date$2026.01.05D09:30:00.000000000"],
  ["Ticks and bars", "gentq 1000\nselect o:first px,h:max px,l:min px,c:last px by sym from trades"],
  ["Dicts and grouping", "d:`a`b`c!1 2 3\nd`b\n=`x`y`x`z`y"],
];
function openSheet(html, bind) { sheet.innerHTML = '<div class="panel">' + html + "</div>"; sheet.classList.remove("hidden"); bind && bind(sheet); }
function closeSheet() { sheet.classList.add("hidden"); }
sheet.addEventListener("click", e => { if (e.target === sheet) closeSheet(); });
$("#menuBtn").onclick = () => openSheet(
  "<h3>Amber</h3>" +
  '<button class="item" data-a="snip">Examples<small>tables, trains, Newton, dates, ticks</small></button>' +
  '<button class="item" data-a="sys">' + (sysKb ? "Use the Amber keyboard" : "Use the system keyboard") + "<small>for typing long names</small></button>" +
  '<button class="item" data-a="clear">Clear the log</button>' +
  '<button class="item" data-a="reset">Reset the session<small>a fresh interpreter, saved definitions forgotten</small></button>' +
  '<button class="item" data-a="about">About</button>',
  s => s.querySelectorAll(".item").forEach(b => b.onclick = () => {
    const a = b.dataset.a; closeSheet();
    if (a === "snip") openSheet("<h3>Examples</h3>" + SNIPS.map((x, n) => '<button class="item" data-n="' + n + '">' + x[0] +
      "<small>" + escH(x[1].split("\n")[0]) + "</small></button>").join(""),
      s2 => s2.querySelectorAll(".item").forEach(c => c.onclick = () => { ed.value = SNIPS[+c.dataset.n][1]; grow(); placeEnd(); closeSheet(); }));
    if (a === "sys") setSysKb(!sysKb);
    if (a === "clear") { log.innerHTML = ""; }
    if (a === "reset") { store.set("defs", []); log.innerHTML = '<div class="cell sys">a fresh session</div>'; boot(); }
    if (a === "about") openSheet('<h3>About</h3><div class="about">Amber ' + (vm ? vm.version() : "") +
      ", the q-flavoured array language, compiled to WebAssembly and running entirely on this device. Nothing is sent anywhere." +
      "<br><br>The first keyboard page holds every primitive and adverb: tap to type, hold for what it does and examples, each" +
      " answered by this engine. <b>q</b> has the words, <b>abc</b> the letters. Tap an earlier input in the log to edit it again." +
      "<br><br>Amber is free software under the GNU AGPLv3. Source: github.com/BonucciAndrea/amber</div>");
  })
);
$("#runBtn").onclick = () => { if (sysKb) setSysKb(false); run(); };

// ---------------------------------------------------------------- start
ed.value = store.get("draft", ""); grow(); render(); boot();
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
