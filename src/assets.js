const SPRITES = [
  'stand_0', 'stand_1', 'stand_2', 'stand_4',
  'twist_0', 'twist_1',
  'lift_1', 'lift_2',
  'frame', 'face_0', 'face_1',
];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`无法加载 ${src}`));
    img.src = src;
  });
}

/** Pre-tinted copy used for the leg that stands further back in the scene. */
function darken(img, tint) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = tint;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export async function loadAssets(onProgress) {
  const meta = await fetch('assets/sprites/sprites.json').then((r) => {
    if (!r.ok) throw new Error('无法加载 sprites.json');
    return r.json();
  });
  const img = {};
  let done = 0;
  await Promise.all(
    SPRITES.map(async (name) => {
      img[name] = await loadImage(`assets/sprites/${name}.png`);
      done += 1;
      onProgress?.(done / SPRITES.length);
    }),
  );
  const dark = {};
  for (const name of ['stand_0', 'stand_1', 'stand_2', 'stand_4', 'twist_0']) {
    dark[name] = darken(img[name], 'rgba(28, 6, 40, 0.42)');
  }
  return { img, dark, meta };
}
