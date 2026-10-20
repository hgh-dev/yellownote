import sharp from 'sharp';

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  let icon = sharp('public/favicon.svg').resize(size, size);
  if (name === 'icon-maskable.png') icon = icon.flatten({ background: '#ffed91' });
  await icon.png().toFile(`public/${name}`);
}
