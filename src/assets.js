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
