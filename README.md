# Amber — browser IDE (WebAssembly)

**Amber v1.9.4** · engine rebuilt from the current C sources.

What's new in this build:

- **Bare qSQL everywhere.** `select … from t where …` now works in the editor
  *and* inside the bundled examples. Examples used to have to spell it
  `sel"select …"`, because the loader ran files through the C loader, which
  bypasses the per-line `qrw` rewriter that the editor gets. The loader now runs
  files through the same `eval()` the editor uses (accumulating statements until
  their brackets balance, so multi-line lambdas still work).
- **Binary serialization.** `-8!x` packs any value into bytes, `-9!y` unpacks it
  byte-exact — attributes, nulls and infinities included. See `serialize.k`.
- **Rust-style diagnostics.** Errors render once, with a category code
  (`E0101`…`E0112`), a token-spanning underline, an inline label and actionable
  help. The engine's internal eval-wrapper diagnostic is filtered out so you see
  exactly one report, for your own code.
- **Syntax highlighting** for `-8!`/`-9!`, `plot`/`candle`, the `fin.k`
  analytics (`gentq`, `taq`, `bars`, `vwap`, `symstats`) and bare-qSQL keywords.


A self-contained website that runs the **real Amber interpreter** (the C engine
in `../src`, including SIMD kernels, the bytecode VM, the AST inspector, the
multithreaded vector engine, and the CSV parser) compiled to WebAssembly. No
install, no server — open the HTML and go.

## Use it

Open **`index.html`** in any modern browser (double-click it, or drag it into
a browser tab). Pick a theme, then click **Enter the IDE**. Everything runs
locally on your machine; nothing is sent anywhere.

In the IDE (`repl.html`) you get a split-pane layout: a multi-line editor
with live syntax highlighting on the left (cyan verbs, magenta adverbs, green
numbers, yellow variables, red strings), and a tabbed output panel on the
right:

- **Result** — your code's output, ANSI colours rendered live. Tables
  (`` `m ``/`` `M `` results) render automatically as a box-drawn grid —
  no `show` or special call needed.
- **AST** — the parsed syntax tree for the last statement (`\ast`).
- **Bytecode** — the compiled VM bytecode for the last statement (`\disasm`).

Press **Run**, or **Shift+Enter**, to evaluate the editor's contents. Use
**Snippets…** for ready-made examples (HFT/tick analytics, SIMD vector math,
tacit/point-free functions, CSV ingestion), or **Examples…** to load any of
the twelve bundled programs' actual source into the editor (it loads the
code, not its output, so you can see exactly what's in it — run it yourself
when ready). **Reset** starts a fresh session. Each pane has its own **A−/A+**
zoom controls. The layout stacks vertically on narrow screens, and the pane
divider is draggable.

## Files

| file              | what it is                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| `index.html`      | themed landing page                                                            |
| `repl.html`       | the split-pane IDE (editor + AST/bytecode/table tabs)                          |
| `amber.js`        | runtime: boots the WASM VM, evaluates input, converts ANSI → HTML              |
| `amber.wasm.js`   | the interpreter as base64-embedded WebAssembly (so it works from `file://`)    |
| `amber.wasm`      | the same module as a raw `.wasm` (reference / if you serve over HTTP)          |

The core libraries (`amber.k`, `fin.k`, `std.k`, `qsql.k`, `temporal.k`,
`sys.k`, `hdb.k`, `ipc.k`) and all twelve example programs are embedded
inside the `.wasm` as a small virtual filesystem, so the page is fully
offline.

## How it was built

The C sources (`src/*.c`, all 34 files including `vm.c`, `simd.c`, `ast.c`,
`csv.c`, `parallel.c`, `ar.c`) are compiled directly for `wasm32` with plain
upstream `clang`/`wasm-ld` (no emscripten, no wasi-sdk) using Amber's
existing freestanding `wasm` mode (`-Dwasm` in `src/0.c`), which already
implements its own tiny virtual filesystem and syscall shims
(`open`/`read`/`write`/`close`/`lseek`/`fstat`/`mmap`/`gettimeofday`/`exit`)
designed exactly for this. A small hand-written libc
(`src/wsys/*.h` + `src/wasmlibc.c`) supplies everything else the sources
need beyond that (malloc, a printf family, `FILE*`-based stdio wrapping the
VFS shims, string/math helpers, 128-bit multiply/shift compiler-rt
intrinsics, and single-threaded emulation for `pthread_create`/`pthread_join`
since there's no real worker pool in the browser sandbox). `src/amber_wasm.c`
exports the five functions the browser side calls (`amber_init`,
`amber_inbuf`, `amber_eval`, `amber_load`, `amber_read` — the last one lets
the IDE show an example's actual source without running it); the linker
exports `memory` and `__heap_base` alongside them. The browser side
(`amber.js`) implements the JS-side imports the wasm module needs
(`js_alloc`/`js_free`/`js_out`/`js_log`/`js_in`/`js_time`/`js_exit`, plus
`sin`/`cos`/`log`/`exp`) with a small free-list allocator over the
WebAssembly memory.

While bringing this up, several genuine (pre-existing, not new) bugs in the
wasm-mode VFS shim in `src/0.c` and elsewhere were found and fixed, all only
reachable in this freestanding mode (never on the native binary, which uses
the real OS's `open`/`write`/`fork`):

- the VFS's per-file name buffer was 16 bytes, silently truncating/rejecting
  any path 16 characters or longer;
- `write()` never advanced the file offset, so a second `write()` on the
  same fd overwrote the first instead of appending;
- `write()`'s buffer-growth path copied the wrong number of bytes when
  reallocating, corrupting previously-written data across repeated writes to
  the same fd;
- the VFS's file table was declared `s[8]` but initialized with more than
  8 entries (8 libraries + 12 examples = 20) — C only warns on this, it
  doesn't error, and silently overran the array's real storage into
  whatever followed it in memory. Fixed by declaring it unsized (`s[]`) so
  the compiler sizes it from the actual entry count;
- `peach` (fork-based parallel-each) had no fallback for a sandbox with no
  real `fork()`/`pipe()` — every call was a hard WebAssembly trap (crashing
  the whole page, not a catchable error). It now probes for `fork()`/`pipe()`
  support up front and falls back to plain serial evaluation when they're
  unavailable, matching what `std.k`'s own `peach` wrapper already claimed
  ("this build is single-threaded, so peach evaluates sequentially") but
  didn't actually do;
- `dup()` (used by the `` `astt``/`` `vmd`` self-tests to redirect stdout)
  had no wasm stub at all, which made `amber.wasm` fail to even
  **instantiate** — every page load, not just the self-tests;
- `amber_init()` only loaded 4 of the 8 bundled `.k` libraries
  (`amber.k`/`fin.k`/`std.k`/`qsql.k`), silently leaving out
  `temporal.k`/`sys.k`/`hdb.k`/`ipc.k` — `plot`/`candle` (defined in
  `sys.k`) failed with a bare `'value` error as a result, which is why
  charts didn't render. All 8 now load at boot, in the same order the
  native REPL uses;
- `ss` (string search, used throughout `qsql.k`'s parser) returned a
  spurious non-empty result for "pattern longer than remaining string" —
  the specific case hit by bare `select from t` / `exec col from t` with no
  `where`/`by` clause, which is why many qSQL commands failed with a
  confusing `'type` error deep in `trim`/`qsplit`. Traced to a real bug in
  the C `` `&`` (where) kernel's generic-empty-list case (`src/v.c`); worked
  around at the K level in `ss` itself rather than risk destabilizing a
  core verb used everywhere — the underlying `` `&`` bug is tracked in
  `../docs/MISSING.md`.

With the fixes in place, the wasm build passes the exact same 277-assertion
test suite as the native binary, all twelve bundled examples run start to
finish with no errors, and every qSQL form in `../docs/AMBER.md` §7 (bare
`select`/`exec`/`update`/`delete`, with and without `where`/`by`, all-column
forms) works identically to the native REPL.

> Note: `peach`/the multithreaded vector engine fall back to sequential
> evaluation in the browser sandbox (no real worker pool or `fork()`), and
> networking/IPC is disabled — everything else is the full language,
> including `\ast`, `\disasm`, the bytecode VM, SIMD kernels, terminal
> charting (`plot`/`candle`), and the CSV parser. `hdb.k`'s on-disk
> functions (`splay`/`dload`/`partsave`) load fine but aren't callable here
> either (no real filesystem to write to) — see `examples/hdb_demo.k` in
> the main engine repo for that tour, native-only.

## About

Play around with Amber!

https://bonucciandrea.github.io/amber-notepad/
