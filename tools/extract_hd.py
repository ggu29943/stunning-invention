#!/usr/bin/env python3
"""Turn the storyboard images in assets/source/hd/*.png into game sprites
(assets/sprites/hd/<name>.webp) plus landmark metadata (sprites.json).

The sources are hand-cut PNGs with transparency, and their alpha is used as is.
For a source without alpha (black boot on black background), the silhouette is
rebuilt from the visible highlights: morphological closing plus an
"orthogonal hull" (inside if there is ink on both sides along the row AND the
column), which fills the black leather but keeps the gap under the arch open.

Landmarks (sprite pixels) used by src/foot.js: toe [x0, x1, groundY],
heel [x, y] (stiletto tip), sole [x, y] (red sole centre), shaft
[x0, x1, row] (first solid row near the top; the game stretches it upward).

Usage:  python3 tools/extract_hd.py [--preview out.jpg]
Needs:  pillow (with WebP), numpy, scipy
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "source", "hd")
OUT = os.path.join(ROOT, "assets", "sprites", "hd")

BOOTS = {
    "01_boot": "lift_0",   # foot coming up, toe down (used for the back-leg step)
    "02_boot": "stand_0",
    "03_boot": "stand_1",
    "04_boot": "twist_0",
    "05_boot": "lift_1",   # sole up, cocked back (full pressure)
    "06_boot": "stand_2",
    "07_boot": "stand_3",
    "08_boot": "twist_1",
    "09_boot": "lift_2",   # sole up
    "10_boot": "stand_4",
    "11_boot": "stand_5",
}
FACES = {"12_green_portrait": "face_green", "13_red_portrait": "face_red"}

BOOT_SCALE = 0.62     # output size relative to the 1254px source
FACE_SIZE = 320
INK = 22              # max-channel value that counts as visible ink


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r


def close_pad(mask, structure):
    p = max(structure.shape) // 2 + 2
    return ndi.binary_closing(np.pad(mask, p), structure=structure)[p:-p, p:-p]


def keep_big(mask, frac=0.03, minimum=60):
    lab, n = ndi.label(mask)
    if not n:
        return mask
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= max(minimum, sizes.max() * frac)
    return keep[lab]


def boot_mask(rgb):
    """Silhouette at half resolution, returned upsampled to full size."""
    h, w = rgb.shape[:2]
    lum = Image.fromarray(rgb.max(axis=2).astype(np.uint8))
    small = np.asarray(lum.resize((w // 2, h // 2), Image.BOX)).astype(int)
    ink = small > INK
    ink = ndi.binary_opening(ink, structure=np.ones((2, 2)))
    ink = keep_big(ink, frac=0.002, minimum=25)

    # 1) closing + hole filling, with the leg's cut-off top sealed shut
    closed = close_pad(ink, disk(7))
    top = np.nonzero(closed.any(axis=1))[0]
    near_top = max(6, int(closed.shape[0] * 0.03))
    if len(top) and top[0] < near_top:
        for r in range(top[0], top[0] + 8):
            xs = np.nonzero(closed[r])[0]
            if len(xs) >= 2:
                closed[r, xs.min():xs.max() + 1] = True
    filled = ndi.binary_fill_holes(closed)

    # 2) orthogonal hull for leather with no visible outline
    src = close_pad(ink, disk(3))
    hh, ww = src.shape
    rows = np.zeros_like(src)
    for y in range(hh):
        xs = np.nonzero(src[y])[0]
        if len(xs):
            rows[y, xs.min():xs.max() + 1] = True
    cols = np.zeros_like(src)
    for x in range(ww):
        ys = np.nonzero(src[:, x])[0]
        if len(ys):
            t = 0 if ys.min() < near_top + 2 else ys.min()
            cols[t:ys.max() + 1, x] = True
    hull = rows & cols
    for _ in range(2):
        hull = close_pad(hull, np.ones((121, 1), bool))
        hull = close_pad(hull, np.ones((1, 13), bool))
        hull = ndi.binary_fill_holes(hull)

    mask = (filled | hull)
    # The shaft near the cut-off top is a plain tube; fill each row of the
    # top band edge to edge so highlight stripes don't leave V-shaped notches.
    rows_any = np.nonzero(mask.any(axis=1))[0]
    if len(rows_any) and rows_any[0] < near_top:
        band = int(mask.shape[0] * 0.14)
        for y in range(rows_any[0], band):
            xs = np.nonzero(mask[y])[0]
            if len(xs) >= 2:
                mask[y, xs.min():xs.max() + 1] = True
    mask = ndi.binary_opening(mask, structure=disk(3))
    mask = keep_big(mask, frac=0.05)
    # back to full size with smooth edges
    big = Image.fromarray((mask * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)
    alpha = ndi.gaussian_filter(np.asarray(big).astype(float) / 255, 1.2)
    return np.clip((alpha - 0.5) * 2.2 + 0.5, 0, 1)


def boot_points(alpha, rgb):
    """Landmarks in output-sprite pixels (see src/foot.js)."""
    a = alpha > 0.5
    h, w = a.shape
    bottoms = np.full(w, -1)
    for x in range(w):
        ys = np.nonzero(a[:, x])[0]
        if len(ys):
            bottoms[x] = ys.max()
    ground = int(bottoms.max())
    cols = np.nonzero(bottoms >= 0)[0]
    x0, x1 = int(cols.min()), int(cols.max())
    # Columns touching (near) the ground line form runs: in this side view
    # the first run is the toe box and the last run is the stiletto tip.
    near = np.nonzero(bottoms >= ground - h * 0.03)[0]
    runs = np.split(near, np.nonzero(np.diff(near) > 3)[0] + 1)
    toe_run, heel_run = runs[0], runs[-1]
    toe = [int(toe_run.min()), int(toe_run.max()), ground]
    if len(runs) > 1:
        hx = int(heel_run[np.argmax(bottoms[heel_run])])
    else:
        # heel lifted (twist / lift frames): lowest point right of the toe box
        start = min(w - 1, toe[1] + int(w * 0.05))
        right = bottoms[start:]
        hx = int(np.argmax(right) + start) if len(right) else x1
    heel = [hx, int(bottoms[hx])]
    r, g, b = (rgb[:, :, i].astype(int) for i in range(3))
    red = (r > 130) & (g < 70) & (b < 80) & a
    ys, xs = np.nonzero(red)
    sole = [int(xs.mean()), int(ys.mean())] if len(xs) > 400 else None
    # Shaft row: the game stretches this row up to the top of the screen and
    # draws the sprite only from here down, so it must be one solid run of
    # leather. Hand-cut tops are wavy/open, so take the first row whose
    # neighbourhood (bilinear sampling reads r-1..r+2) is solid edge to edge.
    def solid(y):
        xs = np.nonzero(alpha[y] > 0.5)[0]
        return len(xs) > 4 and alpha[y, xs.min() + 2:xs.max() - 1].min() > 0.9
    tops = np.nonzero(a.any(axis=1))[0]
    shaft = None
    for r in range(max(1, int(tops.min()) + 1), h // 4):
        if all(solid(y) for y in range(r - 1, r + 3)):
            xs = np.nonzero(alpha[r] > 0.5)[0]
            shaft = [int(xs.min()), int(xs.max()), r]
            break
    return {"toe": toe, "heel": heel, "sole": sole, "shaft": shaft, "bbox": [x0, x1]}


def face_alpha(rgb):
    lum = rgb.max(axis=2).astype(int)
    dark = lum < 16
    dark = ndi.binary_opening(dark, structure=np.ones((3, 3)))
    lab, n = ndi.label(dark)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    # enclosed pockets between hair strands are background as well
    if n:
        sizes = ndi.sum(dark, lab, range(1, n + 1))
        means = ndi.mean(lum, lab, range(1, n + 1))
        big = [i + 1 for i in range(n) if sizes[i] > dark.size * 0.0008 and means[i] < 6]
        bg |= np.isin(lab, big)
    fg = ~bg
    a = ndi.gaussian_filter(fg.astype(float), 1.0)
    return np.clip(a, 0, 1)


def save_webp(arr, path, quality=86):
    Image.fromarray(arr, "RGBA").save(path, "WEBP", quality=quality, alpha_quality=90, method=6)


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    previews = []
    for src, name in BOOTS.items():
        im0 = Image.open(os.path.join(SRC, f"{src}.png"))
        rgb = np.asarray(im0.convert("RGB"))
        # hand-cut sources carry their own alpha; otherwise rebuild it
        alpha = (np.asarray(im0.getchannel("A")).astype(float) / 255
                 if im0.mode == "RGBA" else boot_mask(rgb))
        ys, xs = np.nonzero(alpha > 0.02)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgba = np.dstack([np.maximum(rgb, 5), (alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
        im = Image.fromarray(rgba, "RGBA")
        im = im.resize((round(im.width * BOOT_SCALE), round(im.height * BOOT_SCALE)), Image.LANCZOS)
        arr = np.asarray(im)
        save_webp(arr, os.path.join(OUT, f"{name}.webp"))
        m = {"w": im.width, "h": im.height, "src": src}
        m.update(boot_points(arr[:, :, 3] / 255.0, arr[:, :, :3]))
        meta[name] = m
        previews.append((name, im))
        print(name, m)
    for src, name in FACES.items():
        im0 = Image.open(os.path.join(SRC, f"{src}.png"))
        full = np.asarray(im0.convert("RGBA"))
        s = min(full.shape[0], full.shape[1])
        x0 = (full.shape[1] - s) // 2
        rgb = np.ascontiguousarray(full[:s, x0:x0 + s, :3])
        alpha = (full[:s, x0:x0 + s, 3].astype(float) / 255
                 if im0.mode == "RGBA" else face_alpha(rgb))
        im = Image.fromarray(np.dstack([rgb, (alpha * 255).astype(np.uint8)]), "RGBA")
        im = im.resize((FACE_SIZE, FACE_SIZE), Image.LANCZOS)
        save_webp(np.asarray(im), os.path.join(OUT, f"{name}.webp"), quality=90)
        meta[name] = {"w": FACE_SIZE, "h": FACE_SIZE, "src": src}
        previews.append((name, im))
    with open(os.path.join(OUT, "sprites.json"), "w") as f:
        json.dump(meta, f, indent=1)

    if "--preview" in sys.argv:
        out = sys.argv[sys.argv.index("--preview") + 1]
        th = 360
        tiles = [im.resize((max(1, int(im.width * th / im.height)), th)) for _, im in previews]
        W = sum(t.width + 6 for t in tiles)
        sheet = Image.new("RGBA", (W, th), (230, 60, 200, 255))
        x = 0
        for t in tiles:
            sheet.alpha_composite(t, (x, 0))
            x += t.width + 6
        sheet.convert("RGB").save(out, quality=88)


if __name__ == "__main__":
    main()
