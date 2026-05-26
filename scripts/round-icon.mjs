// Apply macOS-style squircle (rounded square) mask to icon-source.png and
// produce /tmp/vellum-icon-rounded-1024.png, ready to feed into `tauri icon`.
//
// Approximation: rect with rx = 22.37% of side length. Apple's actual squircle
// is a Lamé curve but the rounded-rect approximation looks native at typical
// dock/launchpad sizes.

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

const SIZE = 1024;
const RADIUS = Math.round(SIZE * 0.2237);

const src = resolve(projectRoot, "public/icon-source.png");
const out = "/tmp/vellum-icon-rounded-1024.png";

const maskSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
     <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/>
   </svg>`
);

await sharp(src)
  .resize(SIZE, SIZE, { fit: "cover", position: "centre" })
  .composite([{ input: maskSvg, blend: "dest-in" }])
  .png()
  .toFile(out);

console.log(`wrote ${out} (${SIZE}x${SIZE}, rx=${RADIUS}px)`);
