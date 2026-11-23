// Package the Wallpaper Engine wallpaper:
//
//   npm run build:wallpaper-engine
//
// Builds the app as one self-contained index.html (TARGET=wallpaper-engine, see vite.config.ts),
// adds project.json and preview.jpg from wallpaper-engine/, and writes:
//   dist-wallpaper-engine/lyric-lights/              the folder to copy into Wallpaper Engine
//   dist-wallpaper-engine/lyric-lights-wallpaper-engine.zip  the same, zipped
// The deploy workflow publishes the zip next to the website.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";

const OUT = new URL("../dist-wallpaper-engine/", import.meta.url);
const PKG = new URL("lyric-lights/", OUT);
const SRC = new URL("../wallpaper-engine/", import.meta.url);

rmSync(PKG, { recursive: true, force: true });
mkdirSync(PKG, { recursive: true });
copyFileSync(new URL("index.html", OUT), new URL("index.html", PKG));
for (const f of ["project.json", "preview.jpg"]) copyFileSync(new URL(f, SRC), new URL(f, PKG));

// A minimal zip writer (deflate, no dependencies). Entries go in a lyric-lights/ folder.
const entries = ["index.html", "project.json", "preview.jpg"].map((name) => {
  const data = readFileSync(new URL(name, PKG));
  return { name: `lyric-lights/${name}`, data, packed: deflateRawSync(data, { level: 9 }), crc: crc32(data) };
});
const parts = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const name = Buffer.from(e.name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(0, 10); // time
  local.writeUInt16LE(0x21, 12); // date: 1980-01-01
  local.writeUInt32LE(e.crc, 14);
  local.writeUInt32LE(e.packed.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  parts.push(local, name, e.packed);

  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(8, 10);
  c.writeUInt16LE(0, 12);
  c.writeUInt16LE(0x21, 14);
  c.writeUInt32LE(e.crc, 16);
  c.writeUInt32LE(e.packed.length, 20);
  c.writeUInt32LE(e.data.length, 24);
  c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += local.length + name.length + e.packed.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(new URL("lyric-lights-wallpaper-engine.zip", OUT), Buffer.concat([...parts, centralBuf, end]));
console.log("Wallpaper Engine package: dist-wallpaper-engine/lyric-lights/ and lyric-lights-wallpaper-engine.zip");
