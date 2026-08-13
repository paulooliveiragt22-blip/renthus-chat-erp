/**
 * Rasteriza public/brand/lysthub-mark-dark.svg → PWA / Apple / favicon ICO.
 * Uso: node scripts/build-lysthub-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const mark = path.join(root, "public", "brand", "lysthub-mark-dark.svg");
const iconsDir = path.join(root, "public", "icons");
const publicDir = path.join(root, "public");
const appDir = path.join(root, "app");

function pngToIco(images) {
    const count = images.length;
    const headerSize = 6 + 16 * count;
    const total = headerSize + images.reduce((n, img) => n + img.buf.length, 0);
    const out = Buffer.alloc(total);
    out.writeUInt16LE(0, 0);
    out.writeUInt16LE(1, 2);
    out.writeUInt16LE(count, 4);
    let dataAt = headerSize;
    let cursor = 6;
    for (const img of images) {
        out.writeUInt8(img.size >= 256 ? 0 : img.size, cursor);
        out.writeUInt8(img.size >= 256 ? 0 : img.size, cursor + 1);
        out.writeUInt8(0, cursor + 2);
        out.writeUInt8(0, cursor + 3);
        out.writeUInt16LE(1, cursor + 4);
        out.writeUInt16LE(32, cursor + 6);
        out.writeUInt32LE(img.buf.length, cursor + 8);
        out.writeUInt32LE(dataAt, cursor + 12);
        img.buf.copy(out, dataAt);
        dataAt += img.buf.length;
        cursor += 16;
    }
    return out;
}

const svg = fs.readFileSync(mark);
const master = sharp(svg, { density: 384 }).resize(512, 512, { fit: "fill" }).png();

const png512 = await master.clone().png().toBuffer();
const png192 = await sharp(png512).resize(192, 192).png().toBuffer();
const png180 = await sharp(png512).resize(180, 180).png().toBuffer();
const png48 = await sharp(png512).resize(48, 48).png().toBuffer();
const png32 = await sharp(png512).resize(32, 32).png().toBuffer();
const png16 = await sharp(png512).resize(16, 16).png().toBuffer();

fs.mkdirSync(iconsDir, { recursive: true });
fs.writeFileSync(path.join(iconsDir, "icon-512.png"), png512);
fs.writeFileSync(path.join(iconsDir, "icon-192.png"), png192);
fs.writeFileSync(path.join(iconsDir, "apple-touch-icon.png"), png180);

const ico = pngToIco([
    { size: 16, buf: png16 },
    { size: 32, buf: png32 },
    { size: 48, buf: png48 },
]);
fs.writeFileSync(path.join(publicDir, "favicon.ico"), ico);
fs.writeFileSync(path.join(appDir, "favicon.ico"), ico);
fs.writeFileSync(path.join(appDir, "icon.ico"), ico);

console.log("ok", {
    "icon-512": png512.length,
    "icon-192": png192.length,
    apple: png180.length,
    ico: ico.length,
});
