// High-resolution sprites cut by tools/extract_hd.py.
const DIR = 'assets/sprites/hd';
const SPRITES = ['stand_0', 'stand_1', 'twist_0', 'lift_0', 'lift_1', 'lift_2', 'face_green', 'face_red'];
// pre-tinted copies for the leg that stands further back in the scene
const DARK = ['stand_1', 'lift_0'];

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

export async function loadAssets(onProgress) {
  const meta = await fetch(`${DIR}/sprites.json`).then((r) => {
    if (!r.ok) throw new Error('无法加载 sprites.json');
    return r.json();
  });
  // fail loudly at load time instead of freezing mid-game on a null landmark
  const NEED = {
    stand_0: ['toe', 'heel', 'shaft'],
    stand_1: ['toe', 'heel', 'shaft'],
    twist_0: ['toe', 'heel', 'shaft'],
    lift_0: ['toe', 'shaft'],
    lift_1: ['toe', 'sole', 'shaft'],
    lift_2: ['toe', 'sole', 'shaft'],
  };
  for (const [name, keys] of Object.entries(NEED)) {
    for (const k of keys) {
      if (!Array.isArray(meta[name]?.[k])) throw new Error(`sprites.json 缺少 ${name}.${k}`);
    }
  }
  const img = {};
  let done = 0;
  await Promise.all(
    SPRITES.map(async (name) => {
      img[name] = await loadImage(`${DIR}/${name}.webp`);
      done += 1;
      onProgress?.(done / SPRITES.length);
    }),
  );
  const dark = {};
  for (const name of DARK) dark[name] = darken(img[name], 'rgba(28, 6, 40, 0.42)');
  return { img, dark, meta };
}
