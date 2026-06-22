// Compress README screenshots to webp + png fallback for fast GitHub loading.
const sharp = require(require.resolve('sharp', { paths: [require('path').join(__dirname, '..', 'site', 'node_modules')] }));
const path = require('path');
const fs = require('fs');

const inputs = [
  { src: 'assets/webui-overview-1.png',  webp: 'assets/webui-overview-1.webp',  png: 'assets/webui-overview-1.png',  width: 1280 },
  { src: 'assets/webui-overview-2.png',  webp: 'assets/webui-overview-2.webp',  png: 'assets/webui-overview-2.png',  width: 1280 },
  { src: 'assets/webui-api-call.png',     webp: 'assets/webui-api-call.webp',     png: 'assets/webui-api-call.png',     width: 1280 },
];

(async () => {
  for (const { src, webp, png, width } of inputs) {
    if (!fs.existsSync(src)) {
      console.log(`skip (not found): ${src}`);
      continue;
    }
    const beforeBytes = fs.statSync(src).size;
    const meta = await sharp(src).metadata();
    const targetW = Math.min(width, meta.width);
    const pipeline = sharp(src).resize({ width: targetW, withoutEnlargement: true });
    const webpBuf = await pipeline.clone().webp({ quality: 78, effort: 5 }).toBuffer();
    fs.writeFileSync(webp, webpBuf);
    const pngBuf = await sharp(src).resize({ width: targetW, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, quality: 80 }).toBuffer();
    fs.writeFileSync(png, pngBuf);
    console.log(`${path.basename(src)} ${(beforeBytes/1024).toFixed(0)}KB -> webp ${(webpBuf.length/1024).toFixed(0)}KB / png ${(pngBuf.length/1024).toFixed(0)}KB`);
  }
})();
