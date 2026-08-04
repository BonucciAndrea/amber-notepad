# (superseded)

This file documented an earlier, failed attempt at rebuilding `amber.wasm`
in a sandbox without emscripten/wasi-sdk access. That attempt is no longer
relevant: `amber.wasm` **was** successfully rebuilt in this delivery, from
the real C sources, using a freestanding `clang`/`wasm-ld` toolchain (no
emscripten, no wasi-sdk). See the **"How it was built"** section of
`README.md` for the real, working recipe and the bugs that were found and
fixed along the way.

`wasm_glue.c` (the old unverified sketch this file referenced) has likewise
been superseded — the real glue code is `src/amber_wasm.c` in the main
`amber` engine repository.
