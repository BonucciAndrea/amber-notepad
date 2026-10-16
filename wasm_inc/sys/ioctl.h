/* sys/ioctl.h - stub for the freestanding wasm build (the engine's src/wsys has none). The browser
 * has no terminal, so ioctl fails and src/i.c keeps its default plot size. */
#ifndef WASM_SYS_IOCTL_H
#define WASM_SYS_IOCTL_H
struct winsize { unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel; };
#define TIOCGWINSZ 0x5413
static inline int ioctl(int fd, unsigned long req, ...) { (void)fd; (void)req; return -1; }
#endif
