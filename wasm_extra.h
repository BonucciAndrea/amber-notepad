/* wasm_extra.h - libc declarations the freestanding wasm libc (the engine's src/wsys) does not
 * have yet. Force-included into every engine file by build-wasm.sh; the definitions are in
 * wasm_extra.c. Remove an entry once src/wsys provides it. */
#ifndef WASM_EXTRA_H
#define WASM_EXTRA_H
#include <stddef.h>
void qsort(void *base, size_t n, size_t width, int (*cmp)(const void *, const void *));   /* src/f.c, 2.9 */
#endif
