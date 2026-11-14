#!/usr/bin/env python3
"""Cut the sprite sheet (assets/source/sheet.jpg) into individual PNGs with alpha.

The sheet is a JPEG with a pure-black background, and the boots themselves are
mostly pure black too, so colour keying cannot separate them. Instead we take
the visible (non-black) outline/highlight pixels, close the gaps
morphologically, seal the cut-off top of the leg shaft, and fill the enclosed
area. The result is a silhouette mask used as the alpha channel.

Usage: python3 tools/extract_sprites.py
Requires: pillow, numpy, scipy
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "source", "sheet.jpg")
OUT = os.path.join(ROOT, "assets", "sprites")

# name: (x0, y0, x1, y1, kind)
CELLS = {
    "lift_0":  (0,   0,   166, 252, "boot"),
    "stand_0": (166, 0,   326, 252, "boot"),
    "stand_1": (326, 0,   488, 252, "boot"),
    "twist_0": (488, 0,   652, 252, "boot"),
    "lift_1":  (0,   254, 168, 510, "boot"),
    "stand_2": (166, 254, 326, 510, "boot"),
    "stand_3": (326, 254, 490, 510, "boot"),
    "twist_1": (490, 254, 660, 510, "boot"),
    "lift_2":  (0,   514, 176, 740, "boot"),
    "stand_4": (166, 514, 326, 768, "boot"),
    "stand_5": (326, 514, 490, 768, "boot"),
    "frame":   (642, 0,   770, 132, "ui"),
    "face_0":  (768, 0,   896, 132, "face"),
    "face_1":  (894, 0,   1024, 132, "face"),
}

BRIGHT = 22        # max-channel value above which a pixel is "visible ink"
CLOSE_R = 6        # closing radius used to bridge gaps in the outline


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r


def silhouette(rgb, seal_top):
    lum = rgb.max(axis=2)
    ink = lum > BRIGHT
    # drop isolated JPEG speckles before closing
    ink = ndi.binary_opening(ink, structure=np.ones((2, 2)))
    pad = CLOSE_R + 2
    ink = np.pad(ink, pad)
    closed = ndi.binary_closing(ink, structure=disk(CLOSE_R))
    if seal_top:
        # The leg shaft is cut by the cell's top edge; draw a lid across it so
        # the shaft interior becomes an enclosed region that fill_holes fills.
        for row in range(pad, pad + 6):
            xs = np.nonzero(closed[row])[0]
            if len(xs) >= 2:
                closed[row, xs.min():xs.max() + 1] = True
    filled = ndi.binary_fill_holes(closed)
    filled = filled[pad:-pad, pad:-pad]
    ink = ink[pad:-pad, pad:-pad]
    # Orthogonal hull: a pixel is inside if it lies between ink on its row AND
    # between ink on its column. Boots are near orthogonally-convex, so this
    # recovers the pure-black leather that has no visible outline, while the
    # gap under the arch (open on one side) stays empty.
    src = ndi.binary_closing(ink, structure=disk(2))
    h, w = src.shape
    rows = np.zeros_like(src)
    for y in range(h):
        xs = np.nonzero(src[y])[0]
        if len(xs):
            rows[y, xs.min():xs.max() + 1] = True
    cols = np.zeros_like(src)
    for x in range(w):
        ys = np.nonzero(src[:, x])[0]
        if len(ys):
            top = 0 if seal_top and ys.min() < 8 else ys.min()
            cols[top:ys.max() + 1, x] = True
    hull = rows & cols
    # Rows with no visible ink on one side leave rectangular notches; a tall
    # vertical closing bridges them without touching gaps that are open below
    # (e.g. under the arch, between toe and heel spike).
    for _ in range(2):
        hull = ndi.binary_closing(np.pad(hull, 30), structure=np.ones((61, 1)))[30:-30, 30:-30]
        hull = ndi.binary_closing(np.pad(hull, 10), structure=np.ones((1, 9)))[10:-10, 10:-10]
        hull = ndi.binary_fill_holes(hull)
    filled = filled | hull
    filled = ndi.binary_opening(filled, structure=disk(2))
    # keep components that are reasonably large
    lab, n = ndi.label(filled)
    if n:
        sizes = ndi.sum(filled, lab, range(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = sizes >= max(300, sizes.max() * 0.04)
        filled = keep[lab]
    return filled


def boot_points(rgba):
    """Landmarks the game uses for hit-testing and alignment (sprite pixels).

    toe:   [x0, x1, y] - span of the toe box touching the ground
    heel:  [x, y]      - tip of the stiletto heel
    sole:  [x, y]      - centroid of the red sole (null if not visible)
    shaft: [x0, x1]    - leg width at row 6, used to extend the leg upward
    """
    a = rgba[:, :, 3] > 128
    h, w = a.shape
    bottoms = np.full(w, -1)
    for x in range(w):
        ys = np.nonzero(a[:, x])[0]
        if len(ys):
            bottoms[x] = ys.max()
    ground = bottoms.max()
    half = w // 2
    left = np.nonzero(bottoms[:half] >= ground - 6)[0]
    toe = [int(left.min()), int(left.max()), int(ground)] if len(left) else None
    start = (toe[1] + 12) if toe else int(w * 0.55)
    right = bottoms[start:]
    hx = int(np.argmax(right) + start)
    heel = [hx, int(bottoms[hx])]
    r, g, b = (rgba[:, :, i].astype(int) for i in range(3))
    red = (r > 120) & (g < 70) & (b < 70) & a
    ys, xs = np.nonzero(red)
    sole = [int(xs.mean()), int(ys.mean())] if len(xs) > 200 else None
    row = np.nonzero(a[min(6, h - 1)])[0]
    shaft = [int(row.min()), int(row.max())] if len(row) else None
    return {"toe": toe, "heel": heel, "sole": sole, "shaft": shaft}


def main():
    sheet = np.asarray(Image.open(SRC).convert("RGB"))
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for name, (x0, y0, x1, y1, kind) in CELLS.items():
        rgb = sheet[y0:y1, x0:x1].copy()
        if kind == "ui":
            # rounded frame: keep the light border only
            lum = rgb.max(axis=2)
            mask = lum > 60
        else:
            mask = silhouette(rgb, seal_top=(kind == "boot"))
        alpha = ndi.gaussian_filter(mask.astype(float), 0.6)
        alpha = np.clip(alpha * 1.15, 0, 1)
        alpha[~ndi.binary_dilation(mask, iterations=1)] = 0
        if kind == "boot":
            # pure-black JPEG blocks look flat; lift the darkest tone slightly
            # so the patent leather reads against a dark night scene
            rgb = np.maximum(rgb, 6)
        ys, xs = np.nonzero(alpha > 0.02)
        by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgba = np.dstack([rgb, (alpha * 255).astype(np.uint8)])[by0:by1, bx0:bx1]
        Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, f"{name}.png"), optimize=True)
        meta[name] = {"w": int(bx1 - bx0), "h": int(by1 - by0),
                      "sx": int(x0 + bx0), "sy": int(y0 + by0)}
        if kind == "boot":
            meta[name].update(boot_points(rgba))
    with open(os.path.join(OUT, "sprites.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
