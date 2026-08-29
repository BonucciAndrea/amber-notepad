#!/usr/bin/env python3
# genfs.py - generate o/w/fs.h, the baked-in virtual filesystem for amber.wasm.
# Emits one `{.p="name",.a="<C-escaped content>",.n=<bytes>},` entry per bundled
# file, in the exact shape src/0.c's freestanding `wasm` VFS expects (see the
# `ST{C*a,p[16];N n;}s[]` initializer there). Bundles the 8 stdlib modules the
# browser's amber_init() loads at boot, then the 12 examples the IDE offers.
# Usage:  python3 genfs.py /path/to/amber-source > o/w/fs.h
import sys, os

STDLIB   = ["amber.k","fin.k","std.k","qsql.k","temporal.k","sys.k","hdb.k","ipc.k"]
EXAMPLES = ["basics.k","tour.k","practice.k","extended.k","attributes.k","graphs.k",
            "hft.k","tick.k","wj.k","peach.k","bench.k","test.k"]

def cesc(b):
    out = []
    for c in b:
        if   c == 0x22: out.append('\\"')     # "
        elif c == 0x5c: out.append('\\\\')    # backslash
        elif c == 0x0a: out.append('\\n')
        elif c == 0x09: out.append('\\t')
        elif 0x20 <= c <= 0x7e: out.append(chr(c))
        else: out.append('\\%03o' % c)         # 3-digit octal: never ambiguous next to a digit
    return ''.join(out)

def entry(path, name):
    assert len(name) < 16, "VFS path must be < 16 chars: " + name   # src/0.c p[16]
    with open(path, "rb") as f:
        b = f.read().replace(b"\r\n", b"\n")   # normalise CRLF so a Windows checkout is byte-clean
    return '{.p="%s",.a="%s",.n=%d},' % (name, cesc(b), len(b))

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    lines = [entry(os.path.join(root, f), f) for f in STDLIB]
    lines += [entry(os.path.join(root, "examples", f), f) for f in EXAMPLES]
    sys.stdout.write("\n".join(lines) + "\n")

if __name__ == "__main__":
    main()
