/* wasm_extra.c - libc functions the freestanding wasm libc (the engine's src/wsys) does not have
 * yet; see wasm_extra.h. qsort is a heapsort: no recursion, no allocation, O(n log n). Like any
 * qsort it is not stable, and the engine's one caller (src/f.c) does not need it to be. */
#include "wasm_extra.h"

static void swapb(char *a, char *b, size_t w) { while (w--) { char t = *a; *a++ = *b; *b++ = t; } }

static void sift(char *b, size_t i, size_t n, size_t w, int (*cmp)(const void *, const void *)) {
  for (;;) {
    size_t l = 2 * i + 1, m = i;
    if (l < n && cmp(b + l * w, b + m * w) > 0) m = l;
    if (l + 1 < n && cmp(b + (l + 1) * w, b + m * w) > 0) m = l + 1;
    if (m == i) return;
    swapb(b + i * w, b + m * w, w);
    i = m;
  }
}

void qsort(void *base, size_t n, size_t w, int (*cmp)(const void *, const void *)) {
  char *b = base;
  if (n < 2) return;
  for (size_t i = n / 2; i-- > 0;) sift(b, i, n, w, cmp);
  for (size_t e = n - 1; e > 0; e--) { swapb(b, b + e * w, w); sift(b, 0, e, w, cmp); }
}
