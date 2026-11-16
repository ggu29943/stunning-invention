// High-resolution sprites cut by tools/extract_hd.py. A "skin" is one set of
// the 11 poses (same names, same order); the portraits are shared.
export const SKINS = {
  boots: { dir: 'assets/sprites/hd', label: '长靴' },
  stockings: { dir: 'assets/sprites/stockings', label: '黑丝' },
};
const FACE_DIR = 'assets/sprites/hd';
// the deployed site loads this module as assets.js?v=<build>; the sprites get
// the same tag, so a new deploy never mixes fresh code with cached art
const VER = new URL(import.meta.url).searchParams.get('v');
const tag = (url) => (VER ? `${url}?v=${VER}` : url);
const FRAMES = ['stand_0', 'stand_1', 'twist_0', 'twist_1', 'lift_0', 'lift_1', 'lift_2'];
const FACES = ['face_green', 'face_red'];
// pre-tinted copies for the leg that stands further back in the scene
const DARK = ['stand_1', 'twist_0', 'twist_1', 'lift_0'];
// fail loudly at load time instead of freezing mid-game on a null landmark
const NEED = {
  stand_0: ['toe', 'heel', 'shaft', 'footc'],
  stand_1: ['toe', 'heel', 'shaft'],
  twist_0: ['toe', 'heel', 'shaft'],
  twist_1: ['toe', 'heel', 'shaft'],
  lift_0: ['toe', 'shaft', 'footc'],
  lift_1: ['toe', 'sole', 'soleAxis', 'shaft', 'footc'],
  lift_2: ['toe', 'sole', 'soleAxis', 'shaft', 'footc'],
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`无法加载 ${src}`));
    img.src = src;
  });
}

function darken(img, tint) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = tint;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

let facesPromise = null;
function loadFaces() {
  // spelled out (not the logical-assignment operator): older Android WebViews,
  // before Chromium 85, reject that syntax
  facesPromise = facesPromise || Promise.all(FACES.map((n) => loadImage(tag(`${FACE_DIR}/${n}.webp`)))).then((imgs) =>
    Object.fromEntries(FACES.map((n, i) => [n, imgs[i]])),
  );
  return facesPromise;
}

const skinCache = {};

/** Load one skin: { name, img (poses + portraits), dark, meta }. Cached. */
export function loadSkin(name, onProgress) {
  const skin = SKINS[name] ? name : 'boots';
  skinCache[skin] = skinCache[skin] || (async () => {
    const { dir } = SKINS[skin];
    const meta = await fetch(tag(`${dir}/sprites.json`)).then((r) => {
      if (!r.ok) throw new Error(`无法加载 ${dir}/sprites.json`);
      return r.json();
    });
    for (const [frame, keys] of Object.entries(NEED)) {
      for (const k of keys) {
        if (!Array.isArray(meta[frame]?.[k])) throw new Error(`sprites.json 缺少 ${frame}.${k}`);
      }
    }
    const img = {};
    let done = 0;
    const total = FRAMES.length + 1;
    await Promise.all([
      ...FRAMES.map(async (f) => {
        img[f] = await loadImage(tag(`${dir}/${f}.webp`));
        onProgress?.(++done / total);
      }),
      loadFaces().then((faces) => {
        Object.assign(img, faces);
        onProgress?.(++done / total);
      }),
    ]);
    const dark = {};
    for (const f of DARK) dark[f] = darken(img[f], 'rgba(28, 6, 40, 0.42)');
    return { name: skin, img, dark, meta };
  })();
  // a failed load may be retried later
  skinCache[skin].catch(() => delete skinCache[skin]);
  return skinCache[skin];
}

/** Kept for callers that only need the boots. */
export function loadAssets(onProgress) {
  return loadSkin('boots', onProgress);
}
