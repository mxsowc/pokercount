// Take qlmanage's white-background chip render and punch the background out with
// an anti-aliased circular mask (the chip is round), so the favicon has clean
// transparent corners and smooth edges. No external image libraries.
const fs = require('fs');
const zlib = require('zlib');

// ---- PNG decode (RGBA, 8-bit) ----
function decode(file) {
  const buf = fs.readFileSync(file);
  let p = 8, W, H, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = 4, stride = W * ch, out = Buffer.alloc(H * stride);
  let pos = 0;
  for (let y = 0; y < H; y++) {
    const ft = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[(y - 1) * stride + x - ch] : 0;
      let val;
      switch (ft) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); val = v + pr; break; }
        default: val = v;
      }
      out[y * stride + x] = val & 255;
    }
  }
  return { W, H, data: out };
}

// ---- CRC32 + PNG encode (RGBA, 8-bit) ----
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encode(W, H, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = W * 4, rawb = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) { rawb[y * (stride + 1)] = 0; rgba.copy(rawb, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const idat = zlib.deflateSync(rawb, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- apply circular mask ----
const src = process.argv[2], dst = process.argv[3];
const { W, H, data } = decode(src);
const cx = (W - 1) / 2, cy = (H - 1) / 2;
const nearWhite = (i) => data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250;
// Auto-detect rim radius: scan from centre outward along +x for the last
// non-white pixel (the chip rim), so we mask exactly at the chip edge.
let R = 0;
for (let x = Math.floor(cx); x < W; x++) { if (!nearWhite((Math.floor(cy) * W + x) * 4)) R = x - cx; }
R += 0.5; // include the rim's own antialiased edge
const AA = Math.max(1, W / 256); // antialias band scales with resolution
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = Math.hypot(x - cx, y - cy);
  // coverage: 1 inside, 0 well outside, smooth across the AA band at radius R
  let cov = (R + AA / 2 - d) / AA;
  cov = cov < 0 ? 0 : cov > 1 ? 1 : cov;
  const i = (y * W + x) * 4;
  data[i + 3] = Math.round(data[i + 3] * cov);
}
fs.writeFileSync(dst, encode(W, H, data));
console.log(`masked ${src} -> ${dst}  (size ${W}x${H}, detected R=${R.toFixed(1)})`);
