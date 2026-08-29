#!/usr/bin/env bash
# build-wasm.sh - rebuild amber.wasm (+ amber.wasm.js) from the Amber engine
# sources with a freestanding clang/wasm-ld toolchain: NO emscripten, NO wasi-sdk.
# It compiles every src/*.c for wasm32 in Amber's built-in `-Dwasm` mode (which
# supplies its own tiny VFS/syscall shims in src/0.c and a hand-written libc in
# src/wsys/*.h + src/wasmlibc.c), bakes the .k stdlib + examples into the VFS via
# genfs.py, links exporting the 6 browser entry points, and base64-embeds the
# result for amber.js.
#
#   AMBER_SRC=/path/to/amber CLANG=/path/to/clang WLD=/path/to/wasm-ld ./build-wasm.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AMBER_SRC="${AMBER_SRC:-$HERE/../amber}"
CLANG="${CLANG:-clang}"
WLD="${WLD:-wasm-ld}"
RES="$("$CLANG" -print-resource-dir)"
O="$AMBER_SRC/o/w"; mkdir -p "$O"

echo "genfs -> $O/fs.h"
python3 "$HERE/genfs.py" "$AMBER_SRC" > "$O/fs.h"

CFLAGS="--target=wasm32 -Dwasm -O2 -ffreestanding -fno-builtin -w
        -nostdinc -isystem $RES/include -I$AMBER_SRC/src/wsys -I$AMBER_SRC/src -I$AMBER_SRC"
objs=""
for f in "$AMBER_SRC"/src/*.c; do
  b="$(basename "$f" .c)"
  # amber_wasm.c is the browser entry seam; every other src/*.c is engine code.
  "$CLANG" $CFLAGS -c "$f" -o "$O/$b.o"
  objs="$objs $O/$b.o"
done

echo "wasm-ld -> amber.wasm"
"$WLD" --no-entry --allow-undefined --export-dynamic \
  --export=amber_init --export=amber_inbuf --export=amber_eval \
  --export=amber_load --export=amber_read --export=amber_version \
  --export=memory --export=__heap_base \
  --initial-memory=67108864 -z stack-size=1048576 \
  -o "$HERE/amber.wasm" $objs

printf 'window.AMBER_WASM_B64="%s";\n' "$(base64 -w0 "$HERE/amber.wasm")" > "$HERE/amber.wasm.js"
echo "OK: $(wc -c < "$HERE/amber.wasm") byte amber.wasm, $(wc -c < "$HERE/amber.wasm.js") byte amber.wasm.js"
