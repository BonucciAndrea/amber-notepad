# Amber — browser IDE (WebAssembly)

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
exports the four functions the browser side calls
(`amber_init`, `amber_inbuf`, `amber_eval`, `amber_load`); the linker
exports `memory` and `__heap_base` alongside them. The browser side
(`amber.js`) implements the JS-side imports the wasm module needs
(`js_alloc`/`js_free`/`js_out`/`js_log`/`js_in`/`js_time`/`js_exit`, plus
`sin`/`cos`/`log`/`exp`) with a small free-list allocator over the
WebAssembly memory.

While bringing this up, three genuine (pre-existing, not new) bugs in the
wasm-mode VFS shim in `src/0.c` were found and fixed, all only reachable in
this freestanding mode (never on the native binary, which uses the real
OS's `open`/`write`):

- the VFS's per-file name buffer was 16 bytes, silently truncating/rejecting
  any path 16 characters or longer;
- `write()` never advanced the file offset, so a second `write()` on the
  same fd overwrote the first instead of appending;
- `write()`'s buffer-growth path copied the wrong number of bytes when
  reallocating, corrupting previously-written data across repeated writes to
  the same fd.

All three were only exposed by the engine's own self-tests
(`` `csv0 `` and `` `astt ``, which write/read back a temp file and capture
redirected stdout respectively) — every other operation in the test suite
was unaffected. With the fixes in place, the wasm build passes the exact
same 104-assertion test suite as the native binary (load `test.k` from
**Examples…**, or run `` `astt 0 ``/`` `csv0 0 ``/`` `vmd 0 ``/`` `para 0 ``
directly in the IDE to see all four built-in self-tests report `1`).

> Note: parallel `peach`/the multithreaded vector engine run single-threaded
> in the browser sandbox (no real worker pool), and networking/IPC is
> disabled — everything else is the full language, including `\ast`,
> `\disasm`, the bytecode VM, SIMD kernels, and the CSV parser.

## About

Play around with Amber!

https://bonucciandrea.github.io/amber-notepad/
