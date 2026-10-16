#!/usr/bin/env python3
"""genicons.py - the home-screen icons: Amber's logo (the same two polygons as the site's SVG) with its
amber gradient on the app's dark background. Run from phone/: python tools/genicons.py"""
from PIL import Image, ImageDraw
OUTER = [(16, 2.6), (28.4, 24), (27.2, 26.1), (22.3, 26.1), (16, 14.2), (9.7, 26.1), (4.8, 26.1), (3.6, 24)]
INNER = [(16, 18.4), (20.1, 26.1), (11.9, 26.1)]
STOPS = [(0, (0xFF, 0xD9, 0x8A)), (.45, (0xFF, 0xB0, 0x20)), (1, (0xFF, 0x7A, 0x18))]
BG = (0x0B, 0x0B, 0x0F)

def grad(t):
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            u = (t - a) / (b - a) if b > a else 0
            return tuple(round(ca[i] + (cb[i] - ca[i]) * u) for i in range(3))
    return STOPS[-1][1]

def icon(size, scale):
    S = size * 4                                   # draw 4x and downsample for smooth edges
    img = Image.new("RGB", (S, S), BG)
    k = S * scale / 32; off = (S - 32 * k) / 2 + 0.6 * k
    pt = lambda p: (off + p[0] * k, off + p[1] * k - 0.8 * k)
    mask = Image.new("L", (S, S), 0); ImageDraw.Draw(mask).polygon([pt(p) for p in OUTER], fill=255)
    g = Image.new("RGB", (S, S))
    gp = g.load()
    for y in range(S):                              # gradient from bottom-left to top-right
        for x in range(0, S, 4):
            t = max(0, min(1, ((x / S) + (1 - y / S)) / 2))
            c = grad(t)
            for dx in range(4):
                if x + dx < S: gp[x + dx, y] = c
    img.paste(g, (0, 0), mask)
    over = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(over).polygon([pt(p) for p in INNER], fill=(0xFF, 0x7A, 0x18, 158))
    img = Image.alpha_composite(img.convert("RGBA"), over).convert("RGB")
    return img.resize((size, size), Image.LANCZOS)

icon(180, 0.78).save("icons/apple-touch-icon.png")
icon(192, 0.78).save("icons/icon-192.png")
icon(512, 0.78).save("icons/icon-512.png")
icon(512, 0.56).save("icons/icon-maskable-512.png")    # inside the maskable safe zone
print("icons written")
