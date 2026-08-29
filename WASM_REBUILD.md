# Rebuilding `amber.wasm`

`amber.wasm` is the real Amber engine compiled to `wasm32` with a **freestanding
clang / wasm-ld** toolchain — no emscripten, no wasi-sdk. It uses Amber's built-in
`-Dwasm` mode (`src/0.c`), which supplies its own tiny virtual filesystem and
syscall shims, plus a hand-written libc (`src/wsys/*.h` + `src/wasmlibc.c`).

## One command

```sh
AMBER_SRC=/path/to/amber \
CLANG=/path/to/clang WLD=/path/to/wasm-ld \
./build-wasm.sh
```

That runs `genfs.py` (bakes the 8 `.k` stdlib modules + 12 examples into
`$AMBER_SRC/o/w/fs.h`, the VFS the engine reads at boot), compiles every
`src/*.c` for `wasm32`, links exporting the six browser entry points
(`amber_init` / `amber_inbuf` / `amber_eval` / `amber_load` / `amber_read` /
`amber_version`) plus `memory` and `__heap_base`, and base64-embeds the result
into `amber.wasm.js` for `amber.js`.

## Toolchain

Any recent upstream `clang` + `wasm-ld` (LLVM ≥ 15). No sysroot is needed — the
build passes `-nostdinc -isystem <clang-resource>/include -Isrc/wsys` so the
freestanding libc in `src/wsys` is used, with only `stdarg.h`/`stddef.h` coming
from clang. A prebuilt LLVM release works; e.g. LLVM 18.1.8's
`clang+llvm-*-x86_64-linux-gnu` (on newer distros it links `libtinfo.so.6`, so an
ubuntu-18.04 build additionally needs `libtinfo.so.5` on `LD_LIBRARY_PATH`).

## Verifying without a browser

Node runs the same module the page does:

```sh
node -e 'global.window=global;require("./amber.wasm.js");require("./amber.js");
(async()=>{const v=new AmberVM();await v.boot();
console.log(v.eval("2+2"),"|",v.eval("2 3 in 2 3 4"),"|",v.eval("=`a`b`a"));})()'
```

## 2.0.0 notes

This build is the first to compile the full post-1.9.5 line editor (`src/ln.c`)
for wasm — the browser never uses it, so it links against small stubs, and the
`libamber.so` C API (`ext.c` section 6) is excluded from the wasm build to avoid
its `amber_init(const char*)` colliding with the browser's `amber_init(void)`.
The engine changes shipped: infix dyads, bare qSQL in scripts, the ~19× symbol
group-by, and the two lexer/verb fixes — all verified in the wasm via the Node
check above.
