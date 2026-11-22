"use strict";

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const srcWww = path.join(rootDir, "www");
const destWww = path.join(__dirname, "app-www");
const buildDir = path.join(__dirname, "build");
const srcIconPng = path.join(srcWww, "pins", "base-smile-256.png");

if (!fs.existsSync(srcWww)) {
  throw new Error("Missing shared web directory at: " + srcWww);
}
if (!fs.existsSync(srcIconPng)) {
  throw new Error("Missing base smiley pin PNG at: " + srcIconPng);
}

// 1. Sync shared www assets into desktop/app-www for reliable electron-builder ASAR packaging
fs.rmSync(destWww, { recursive: true, force: true });
fs.cpSync(srcWww, destWww, { recursive: true });

// 2. Build Windows icon resources (256x256 PNG + valid Vista+ PNG-wrapped ICO)
fs.mkdirSync(buildDir, { recursive: true });
const pngBuf = fs.readFileSync(srcIconPng);
const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (pngBuf.length < 24 || !pngBuf.subarray(0, 8).equals(pngSig)) {
  throw new Error("Invalid PNG icon source: " + srcIconPng);
}

const width = pngBuf.readUInt32BE(16);
const height = pngBuf.readUInt32BE(20);
if (width < 256 || height < 256) {
  throw new Error("Icon PNG must be at least 256x256, got " + width + "x" + height);
}

fs.writeFileSync(path.join(buildDir, "icon.png"), pngBuf);

// Construct ICO container (ICONDIR 6 bytes + 1 ICONDIRENTRY 16 bytes + raw 256x256 PNG)
const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0); // Reserved
header.writeUInt16LE(1, 2); // Type: 1 = ICO
header.writeUInt16LE(1, 4); // Image count: 1

header.writeUInt8(width >= 256 ? 0 : width, 6);   // 0 encodes 256px in ICO spec
header.writeUInt8(height >= 256 ? 0 : height, 7);
header.writeUInt8(0, 8);  // Color palette count
header.writeUInt8(0, 9);  // Reserved
header.writeUInt16LE(1, 10); // Color planes
header.writeUInt16LE(32, 12); // Bits per pixel
header.writeUInt32LE(pngBuf.length, 14); // Payload size
header.writeUInt32LE(22, 18); // Offset to image data (6 + 16)

fs.writeFileSync(path.join(buildDir, "icon.ico"), Buffer.concat([header, pngBuf]));
console.log("Prepared desktop/app-www and build/icon.ico (" + width + "x" + height + ")");
