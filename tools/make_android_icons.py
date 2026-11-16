"""Launcher icons for the Android app (android/), made from the web icon.

- mipmap-*/ic_launcher.png: the rounded web icon at 48 dp (Android 7 and 7.1)
- mipmap-*/ic_launcher_foreground.png + mipmap-anydpi-v26/ic_launcher.xml:
  an adaptive icon (Android 8+). The launcher crops it to its own shape and
  shows about the middle 72 of its 108 dp, so the art is drawn 86 dp wide on
  the icon's own purple gradient (continued past the art's rounded corners):
  only a thin rim of the art is cut off.

Run from the repository root:  python3 tools/make_android_icons.py
"""
from pathlib import Path

from PIL import Image

SRC = Path('assets/icons/icon-512.png')
RES = Path('android/app/src/main/res')
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
ART_DP = 86


def gradient(y):
    """The web icon's background: a vertical gradient, sampled from its edges."""
    top, bottom = (89, 41, 98), (163, 60, 108)
    t = y / 511
    return tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))


def main():
    art = Image.open(SRC).convert('RGBA')
    n = art.width
    # fill the rounded corners with the gradient: a full-bleed square
    full = Image.new('RGBA', art.size)
    for y in range(n):
        full.paste(gradient(y) + (255,), (0, y, n, y + 1))
    full.alpha_composite(art)

    for name, k in DENSITIES.items():
        out = RES / f'mipmap-{name}'
        out.mkdir(parents=True, exist_ok=True)
        art.resize((round(48 * k),) * 2, Image.LANCZOS).save(out / 'ic_launcher.png', optimize=True)

        size = round(108 * k)
        side = round(ART_DP * k)
        off = (size - side) // 2
        fg = Image.new('RGBA', (size, size))
        for y in range(size):  # the gradient carries on past the art's edges
            fg.paste(gradient((y - off) * (n - 1) / max(1, side - 1)) + (255,), (0, y, size, y + 1))
        fg.alpha_composite(full.resize((side, side), Image.LANCZOS), (off, off))
        fg.convert('RGB').save(out / 'ic_launcher_foreground.png', optimize=True)

    (RES / 'mipmap-anydpi-v26').mkdir(parents=True, exist_ok=True)
    (RES / 'mipmap-anydpi-v26' / 'ic_launcher.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background" />\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        '</adaptive-icon>\n'
    )
    print('icons written to', RES)


if __name__ == '__main__':
    main()
