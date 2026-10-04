// SV-42: PWA のアイコンを生成する（依存パッケージなし。Node の組み込みの zlib と fs だけ）。
// 実行: node scripts/make-icons.mjs  → public/icons/*.png を書き、読み直して IHDR の大きさを表示する。
// 絵は 32×32 の論理ピクセル（黒地に淡緑の一人称の通路の線画と、奥の扉の中の黄の印。このリポジトリのオリジナル）を
// 最近傍で整数倍する。出力は決定的（同じ入力から同じバイト列）。
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 色は src/presenter/palette.ts の PALETTE と同じ値（black / lightGreen / yellow）。
const BG = "#000000";
const LINE = "#B8F8B8";
const MARK = "#F8B800";

const N = 32;

/** 32×32 の絵。値は色の文字列 */
function drawPicture() {
  const px = Array.from({ length: N * N }, () => BG);
  const set = (x, y, c) => {
    if (x >= 0 && x < N && y >= 0 && y < N) px[y * N + x] = c;
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let x = x0; x <= x1; x++) {
      set(x, y0, c);
      set(x, y1, c);
    }
    for (let y = y0; y <= y1; y++) {
      set(x0, y, c);
      set(x1, y, c);
    }
  };
  // 外枠と、奥へ 2 段の矩形
  rect(1, 1, 30, 30, LINE);
  rect(7, 7, 24, 24, LINE);
  rect(11, 11, 20, 20, LINE);
  // 四隅から奥への斜線
  for (let k = 0; k <= 10; k++) {
    set(1 + k, 1 + k, LINE);
    set(30 - k, 1 + k, LINE);
    set(1 + k, 30 - k, LINE);
    set(30 - k, 30 - k, LINE);
  }
  // 奥の正面の扉の枠（下辺は奥の床の線と共有）
  rect(14, 13, 17, 20, LINE);
  // 扉の中の印（取っ手）
  set(16, 17, MARK);
  return px;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** size×size の PNG（8bit RGB）。絵を scale 倍して中央に置き、余白は BG */
function encodeIcon(pic, size, scale) {
  const drawn = N * scale;
  const off = Math.floor((size - drawn) / 2);
  const bg = hexToRgb(BG);
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const lx = x - off;
      const ly = y - off;
      const inside = lx >= 0 && ly >= 0 && lx < drawn && ly < drawn;
      const rgb = inside ? hexToRgb(pic[Math.floor(ly / scale) * N + Math.floor(lx / scale)]) : bg;
      raw.set(rgb, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const OUTPUTS = [
  { file: "icon-192.png", size: 192, scale: 6 },
  { file: "icon-512.png", size: 512, scale: 16 },
  // 160 を中央（余白 10）
  { file: "apple-touch-icon.png", size: 180, scale: 5 },
  // 288 を中央（余白 112）。maskable の安全域（直径 409.6 の円）に対角 407 が収まる
  { file: "icon-maskable-512.png", size: 512, scale: 9 },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });
const pic = drawPicture();
for (const o of OUTPUTS) {
  const path = join(outDir, o.file);
  writeFileSync(path, encodeIcon(pic, o.size, o.scale));
  // 自己検査: 書いたファイルを読み直して署名と IHDR の幅・高さを確かめる
  const b = readFileSync(path);
  const okSig = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (!okSig || w !== o.size || h !== o.size) throw new Error(`bad png: ${o.file}`);
  console.log(`${o.file}: ${w}x${h} ${b.length} bytes`);
}
