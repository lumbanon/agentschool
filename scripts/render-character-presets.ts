/**
 * Renders every school uniform preset (with and without the optional headscarf)
 * plus the default office outfit into one enlarged PNG for art review.
 * Uses the same composer as the game. No dependencies beyond Node's zlib.
 *
 *   npm run characters:preview            -> docs/character-presets.png (standing frames)
 *   npx vite-node scripts/render-character-presets.ts out.png all   (all 12 frames)
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { renderSheetRGBA, SHEET_W, SHEET_H } from '../src/characters/customization/spriteComposer';
import { DEFAULT_BODY } from '../src/characters/customization/palette';
import { SCHOOL_PRESETS } from '../src/domains/school/uniforms/presets';
import { outfitFromPreset } from '../src/characters/customization/wardrobe';
import { defaultOfficeOutfit } from '../src/domains/office/outfits';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(w: number, h: number, rgba: Uint8Array) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const specs = SCHOOL_PRESETS.flatMap((p) => {
  const base = [{ presentation: p.presentation, body: DEFAULT_BODY, outfit: outfitFromPreset(p, false) }];
  if (p.optionalHeadwear) base.push({ presentation: p.presentation, body: DEFAULT_BODY, outfit: outfitFromPreset(p, true) });
  return base;
});
specs.push({ presentation: 'male', body: DEFAULT_BODY, outfit: defaultOfficeOutfit() });
const STAND = process.argv[3] !== 'all';
const S = 8, GAP = 4, BG = [42, 37, 51, 255];
const CW = STAND ? 16 : SHEET_W;
const W = specs.length * (CW + GAP) * S, H = SHEET_H * S;
const out = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) out.set(BG, i * 4);
specs.forEach((spec, k) => {
  const sheet = renderSheetRGBA(spec);
  for (let y = 0; y < SHEET_H; y++) for (let x = 0; x < SHEET_W; x++) {
    if (STAND && x >= 16) continue;
    const a = sheet[(y * SHEET_W + x) * 4 + 3] / 255; if (!a) continue;
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
      const o = (((y * S + dy) * W) + (k * (CW + GAP) + x) * S + dx) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(sheet[(y * SHEET_W + x) * 4 + c] * a + out[o + c] * (1 - a));
    }
  }
});
writeFileSync(process.argv[2] ?? 'docs/character-presets.png', png(W, H, out));
console.log('specs', specs.length, W, H);
