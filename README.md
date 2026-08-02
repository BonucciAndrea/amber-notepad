# Amber — browser showcase (WebAssembly)

A self-contained website that runs the **real Amber interpreter** (the C engine in
`../src`) compiled to WebAssembly. No install, no server — open the HTML and go.

## Use it

Open **`index.html`** in any modern browser (double-click it, or drag it into a
browser tab). Pick a theme, then click **Enter the REPL**. Everything runs locally
on your machine; nothing is sent anywhere.

In the REPL you can:

- type Amber expressions and press Enter (`2+3*4`, `!10`, `+/1 2 3 4 5`);
- build tables and query them (`t:([]sym:`AAPL`MSFT;px:191.2 402.5)` then
  `select avg px by sym from t`);
- draw charts (`plot 10*{sin x%6}'!120`, `candle bars[10;sel"select from trades where sym=`AAPL"]`);
- **Load example…** — run any of the twelve bundled programs with one click;
- switch between six themes (your choice follows you between pages);
- **Reset session** to start with fresh memory.

Colours, braille line charts, and Unicode candlesticks all render live (ANSI is
translated to HTML).

## Files

| file | what it is |
|------|------------|
| `index.html`    | themed landing page |
| `repl.html`     | the interactive terminal |
| `amber.js`      | runtime: boots the WASM VM, evaluates input, converts ANSI → HTML |
| `amber.wasm.js` | the interpreter as base64-embedded WebAssembly (so it works from `file://`) |
| `amber.wasm`    | the same module as a raw `.wasm` (reference / if you serve over HTTP) |

The core libraries (`amber.k`, `fin.k`, `std.k`, `qsql.k`, `temporal.k`, `sys.k`)
and all example programs are embedded inside the `.wasm` as a small virtual
filesystem, so the page is fully offline.

## How it was built

Compiled with **wasi-sdk clang** targeting `wasm32` in the interpreter's built-in
freestanding `wasm` mode (`-Dwasm`), which routes I/O through JS import hooks
(`js_out`, `js_alloc`, `js_time`, …). The browser side implements those hooks and
a small free-list allocator over the WebAssembly memory. Math (`sin`/`cos`/`log`/
`exp`) is provided from JavaScript; 128-bit integer helpers come from compiler-rt.

The engine is unmodified in behaviour — the WASM build passes the same 104-test
suite as the native binary (load `test.k` from the examples menu to see it).

> Note: parallel `peach` runs sequentially in the browser sandbox (no processes),
> and networking/IPC is disabled — everything else is the full language.
