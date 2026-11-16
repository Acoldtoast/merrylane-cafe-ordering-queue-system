/**
 * Generates valid PNG favicon icons for the web app manifest.
 * Replaces the 85-byte invalid stubs in public/ so the manifest
 * "resource isn't a valid image" console warnings go away.
 */
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(process.cwd(), "public");

// Theme brown from the app (#4A2E1F), lighter cup (#D8C3A5), highlight (#F5E9D8).
const BG = [0x4a, 0x2e, 0x1f, 0xff];
const CUP = [0xd8, 0xc3, 0xa5, 0xff];
const HIGHLIGHT = [0xf5, 0xe9, 0xd8, 0xff];

function crc32(buf) {
  // Simple CRC-32 (IEEE) implementation used by PNG.
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function ihdr(w, h) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0);
  d.writeUInt32BE(h, 4);
  d[8] = 8; // bit depth
  d[9] = 6; // color type RGBA
  d[10] = 0; // compression
  d[11] = 0; // filter
  d[12] = 0; // interlace
  return chunk("IHDR", d);
}

function iend() {
  return chunk("IEND", Buffer.alloc(0));
}

function idat(scanlines) {
  const raw = Buffer.concat(scanlines);
  const deflated = zlib.deflateSync(raw);
  return chunk("IDAT", deflated);
}

function makeIcon(size) {
  const cx = size / 2;
  const cy = size / 2;
  const cupRadius = size * 0.22;
  const cupTop = size * 0.30;
  const cupBottom = size * 0.78;
  const handleOff = size * 0.34;

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: none
    let p = 1;
    for (let x = 0; x < size; x++) {
      let color = BG;
      const dx = x - cx;
      const dy = y - cy;
      const inCup =
        x >= cx - cupRadius &&
        x <= cx + cupRadius &&
        y >= cupTop &&
        y <= cupBottom;
      const inHandle =
        Math.hypot(dx - handleOff, dy - cy) < cupRadius * 0.55 &&
        Math.hypot(dx - handleOff, dy - cy) > cupRadius * 0.30;
      if (inHandle) color = CUP;
      else if (inCup) color = CUP;
      else if (
        Math.hypot(dx, dy - cupTop) < cupRadius * 0.5 &&
        y < cupTop + cupRadius * 0.6
      ) {
        color = HIGHLIGHT;
      }
      row[p++] = color[0];
      row[p++] = color[1];
      row[p++] = color[2];
      row[p++] = color[3];
    }
    rows.push(row);
  }

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr(size, size),
    idat(rows),
    iend(),
  ]);
  return png;
}

for (const size of [192, 512]) {
  const out = path.join(PUBLIC, `favicon-${size}.png`);
  fs.writeFileSync(out, makeIcon(size));
  console.log(`Wrote ${out} (${fs.statSync(out).size} bytes)`);
}
