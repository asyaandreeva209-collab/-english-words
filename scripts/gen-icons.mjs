// Генерация PNG-иконок PWA из SVG: npm run icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const svg = await readFile(dir + 'icon.svg');

// maskable: без скруглений, контент в безопасной зоне (~80%)
const maskableSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#4f46e5"/>
  <rect x="136" y="166" width="240" height="186" rx="28" fill="#ffffff"/>
  <text x="256" y="294" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="112" font-weight="700" fill="#4f46e5">Aa</text>
</svg>`);

await sharp(svg).resize(192, 192).png().toFile(dir + 'icon-192.png');
await sharp(svg).resize(512, 512).png().toFile(dir + 'icon-512.png');
await sharp(svg).resize(180, 180).flatten({ background: '#4f46e5' }).png().toFile(dir + 'apple-touch-icon-180.png');
await sharp(maskableSvg).resize(512, 512).png().toFile(dir + 'icon-maskable-512.png');
console.log('Иконки сгенерированы в', dir);
