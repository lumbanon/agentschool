import type { Outfit, Presentation, RenderSpec } from '../types';
import { hexToRgb, mix, ramp, type RGBA } from './palette';

/**
 * Layered, palette-swapped pixel-art character composer.
 *
 * 1. Each layer (legs/skirt, shoes, top, overlay, arms, neckwear, head/hair,
 *    headwear, face) is *painted as material + shade indices*, not colours.
 *    Layers are painted back-to-front into one index buffer per frame.
 * 2. A one-pixel outline and the ground shadow are added from the silhouette.
 * 3. Only at the end are indices resolved to RGBA: each material gets a
 *    highlight/base/shadow ramp from its chosen colour.
 *
 * So recolouring trousers can only ever change pixels whose material is
 * "bottom": skin, hair, outlines, other garments and transparency are untouched.
 * No sheet is stored per colour combination: sheets are recomputed (a 48x96
 * sheet takes well under a millisecond).
 *
 * Sheet layout matches the engine: 16x24 frames, 3 columns (stand, stepA,
 * stepB) x 4 rows (down, left, right, up). "right" is the mirrored "left".
 */

export const FRAME_W = 16;
export const FRAME_H = 24;
export const SHEET_COLS = 3;
export const SHEET_ROWS = 4;
export const SHEET_W = FRAME_W * SHEET_COLS;
export const SHEET_H = FRAME_H * SHEET_ROWS;
export const SHEET_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type SheetDirection = (typeof SHEET_DIRECTIONS)[number];

export const MATERIALS = ['skin', 'hair', 'eyes', 'blush', 'top', 'bottom', 'overlay', 'headwear', 'neckwear', 'shoes'] as const;
export type Material = (typeof MATERIALS)[number];
/** 0 = highlight, 1 = base, 2 = shadow. */
export type Shade = 0 | 1 | 2;

const MAT_ID: Record<Material, number> = Object.fromEntries(MATERIALS.map((m, i) => [m, i + 1])) as Record<Material, number>;
export const CODE_EMPTY = 0;
export const CODE_OUTLINE = 254;
export const CODE_SHADOW = 255;
const code = (m: Material, s: Shade) => (MAT_ID[m] << 2) | s;

/** Decode a material-sheet code. */
export function decode(c: number): { material: Material; shade: Shade } | 'outline' | 'shadow' | null {
  if (c === CODE_EMPTY) return null;
  if (c === CODE_OUTLINE) return 'outline';
  if (c === CODE_SHADOW) return 'shadow';
  return { material: MATERIALS[(c >> 2) - 1], shade: (c & 3) as Shade };
}

export const OUTLINE_RGBA: RGBA = [34, 26, 40, 255];
export const SHADOW_RGBA: RGBA = [0, 0, 0, 70];

// ------------------------------------------------------------------ painting

class Layer {
  readonly px = new Uint8Array(FRAME_W * FRAME_H);
  set(x: number, y: number, m: Material, s: Shade = 1) {
    if (x >= 0 && x < FRAME_W && y >= 0 && y < FRAME_H) this.px[y * FRAME_W + x] = code(m, s);
  }
  rect(x0: number, y0: number, x1: number, y1: number, m: Material, s: Shade = 1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, m, s);
  }
  h(x0: number, x1: number, y: number, m: Material, s: Shade = 1) {
    this.rect(x0, y, x1, y, m, s);
  }
  v(x: number, y0: number, y1: number, m: Material, s: Shade = 1) {
    this.rect(x, y0, x, y1, m, s);
  }
}

type PaintDir = 'down' | 'left' | 'up';
type Frame = 0 | 1 | 2;
type Ctx = { L: Layer; dir: PaintDir; f: Frame; oy: number };

function legsAndShoes({ L, dir, f, oy }: Ctx, mat: 'bottom' | 'skin') {
  if (dir !== 'left') {
    const [a, b] = ([[0, 0], [-1, 0], [0, -1]] as const)[f];
    L.rect(5, 18 + oy + a, 7, 21 + oy, mat);
    L.rect(8, 18 + oy + b, 10, 21 + oy, mat);
    L.v(7, 18 + oy + a, 21 + oy, mat, 2);
    L.v(10, 18 + oy + b, 21 + oy, mat, 2);
    L.h(5, 7, 22 + oy + a, 'shoes');
    L.h(8, 10, 22 + oy + b, 'shoes');
    L.set(7, 22 + oy + a, 'shoes', 2);
    L.set(10, 22 + oy + b, 'shoes', 2);
    return;
  }
  if (f === 0) {
    L.rect(6, 18 + oy, 9, 21 + oy, mat);
    L.v(9, 18 + oy, 21 + oy, mat, 2);
    L.h(5, 9, 22 + oy, 'shoes');
    return;
  }
  const [front, back] = f === 1 ? [[3, 6], [9, 11]] : [[5, 8], [7, 10]];
  L.rect(back[0], 18 + oy, back[1], 21 + oy, mat, 2);
  L.h(back[0], back[1], 22 + oy, 'shoes', 2);
  L.rect(front[0], 18 + oy, front[1], 21 + oy, mat);
  L.h(front[0] - 1, front[1], 22 + oy, 'shoes');
}

/** Feet peeking out under a floor-length skirt or dress. */
function skirtShoes({ L, dir, f, oy }: Ctx) {
  const y = 22 + oy;
  if (dir !== 'left') {
    const feet = f === 0 ? [[5, 6], [9, 10]] : f === 1 ? [[4, 6], [9, 10]] : [[5, 6], [9, 11]];
    for (const [x0, x1] of feet) {
      L.h(x0, x1, y, 'shoes');
      L.set(x1, y, 'shoes', 2);
    }
    return;
  }
  if (f === 0) L.h(5, 9, y, 'shoes');
  else if (f === 1) {
    L.h(9, 10, y, 'shoes', 2);
    L.h(2, 4, y, 'shoes');
  } else L.h(5, 8, y, 'shoes');
}

/**
 * A-line floor-length skirt (also the lower half of a pinafore).
 * Horizontally fixed in every frame: only the vertical bob (oy) and the feet move.
 */
function longSkirt({ L, dir, oy }: Ctx, mat: 'bottom' | 'overlay', pleats: boolean) {
  const hem = 21 + oy;
  if (dir !== 'left') {
    L.rect(4, 17 + oy, 11, 19 + oy, mat);
    L.rect(3, 20 + oy, 12, hem, mat);
    L.v(4, 17 + oy, 19 + oy, mat, 0);
    L.v(11, 17 + oy, 19 + oy, mat, 2);
    L.v(12, 20 + oy, hem, mat, 2);
    L.h(3, 12, hem, mat, 2);
    if (pleats) for (const x of [6, 9]) L.v(x, 18 + oy, 20 + oy, mat, 2);
    else L.v(8, 18 + oy, 20 + oy, mat, 2);
    return;
  }
  L.rect(5, 17 + oy, 10, 19 + oy, mat);
  L.rect(4, 20 + oy, 11, hem, mat);
  L.v(10, 17 + oy, 19 + oy, mat, 2);
  L.v(11, 20 + oy, hem, mat, 2);
  L.h(4, 11, hem, mat, 2);
  L.v(pleats ? 7 : 8, 18 + oy, 20 + oy, mat, 2);
}

function top({ L, dir, oy }: Ctx, o: Outfit) {
  const style = o.top.style;
  const bottomRow = (style === 'tunic' ? 18 : 17) + oy;
  if (dir !== 'left') {
    L.rect(4, 11 + oy, 11, bottomRow, 'top');
    if (style === 'tunic') L.rect(3, 17 + oy, 12, 18 + oy, 'top');
    L.v(4, 12 + oy, bottomRow - 1, 'top', 0);
    L.v(11, 11 + oy, bottomRow, 'top', 2);
    if (style === 'tunic') L.v(12, 17 + oy, 18 + oy, 'top', 2);
    L.h(style === 'tunic' ? 3 : 4, style === 'tunic' ? 12 : 11, bottomRow, 'top', 2);
    if (dir === 'down') {
      L.set(7, 11 + oy, 'skin', 2); // neck, shaded under the chin
      L.set(8, 11 + oy, 'skin', 2);
      if (style === 'shirt') {
        L.set(6, 11 + oy, 'top', 0);
        L.set(9, 11 + oy, 'top', 0);
      } else if (style === 'blouse') {
        // rounded collar
        L.h(5, 6, 11 + oy, 'top', 0);
        L.h(9, 10, 11 + oy, 'top', 0);
        L.set(6, 12 + oy, 'top', 0);
        L.set(9, 12 + oy, 'top', 0);
      }
      if (style === 'shirt') L.v(8, 13 + oy, bottomRow - 1, 'top', 2); // button placket
      if (style === 'tunic') L.v(8, 12 + oy, 13 + oy, 'top', 2); // neckline slit
    } else if (style !== 'tunic') {
      L.h(6, 9, 11 + oy, 'top', 0); // collar at the back
    }
    return;
  }
  L.rect(5, 11 + oy, 10, bottomRow, 'top');
  if (style === 'tunic') L.rect(4, 17 + oy, 11, 18 + oy, 'top');
  L.v(10, 11 + oy, bottomRow, 'top', 2);
  L.h(style === 'tunic' ? 4 : 5, style === 'tunic' ? 11 : 10, bottomRow, 'top', 2);
  if (style !== 'tunic') L.set(5, 11 + oy, 'top', 0);
}

function pinaforeBodice({ L, dir, oy }: Ctx) {
  if (dir === 'left') {
    L.rect(6, 12 + oy, 9, 16 + oy, 'overlay');
    L.v(9, 12 + oy, 16 + oy, 'overlay', 2);
    return;
  }
  L.rect(5, 12 + oy, 10, 16 + oy, 'overlay');
  L.v(10, 12 + oy, 16 + oy, 'overlay', 2);
  if (dir === 'down') L.h(6, 9, 12 + oy, 'overlay', 0);
}

function arms({ L, dir, f, oy }: Ctx, sleeves: 'short' | 'long') {
  if (dir !== 'left') {
    const [a, b] = ([[0, 0], [1, -1], [-1, 1]] as const)[f];
    for (const [x, d] of [[3, a], [12, b]] as const) {
      if (sleeves === 'long') L.v(x, 12 + oy + d, 15 + oy + d, 'top', 2);
      else {
        L.v(x, 12 + oy + d, 13 + oy + d, 'top', 2);
        L.v(x, 14 + oy + d, 15 + oy + d, 'skin');
      }
      L.set(x, 16 + oy + d, 'skin');
    }
    return;
  }
  // Side view: the sleeve stays put horizontally (no sideways swing); it bobs with the body.
  if (sleeves === 'long') L.rect(7, 12 + oy, 8, 15 + oy, 'top', 2);
  else {
    L.rect(7, 12 + oy, 8, 13 + oy, 'top', 2);
    L.rect(7, 14 + oy, 8, 15 + oy, 'skin');
  }
  L.h(7, 8, 16 + oy, 'skin');
}

function tie({ L, dir, oy }: Ctx) {
  if (dir === 'down') {
    L.set(7, 12 + oy, 'neckwear', 0);
    L.set(8, 12 + oy, 'neckwear');
    L.v(7, 13 + oy, 15 + oy, 'neckwear');
    L.v(8, 13 + oy, 15 + oy, 'neckwear', 2);
  } else if (dir === 'left') {
    L.v(5, 12 + oy, 14 + oy, 'neckwear');
  }
}

function head({ L, dir, oy }: Ctx, presentation: Presentation, covered: boolean) {
  L.rect(4, 3 + oy, 11, 10 + oy, 'skin');
  if (covered) return;
  const long = presentation === 'female';
  if (dir === 'down') {
    L.rect(3, 1 + oy, 12, 4 + oy, 'hair');
    L.rect(3, 5 + oy, 3, (long ? 11 : 7) + oy, 'hair');
    L.rect(12, 5 + oy, 12, (long ? 11 : 7) + oy, 'hair');
    L.set(5, 5 + oy, 'hair');
    L.set(10, 5 + oy, 'hair');
    if (long) L.set(4, 5 + oy, 'hair');
  } else if (dir === 'up') {
    L.rect(3, 1 + oy, 12, (long ? 11 : 9) + oy, 'hair');
    if (!long) L.h(6, 9, 10 + oy, 'skin');
    if (long) L.v(8, 6 + oy, 11 + oy, 'hair', 2);
  } else {
    L.rect(4, 1 + oy, 11, 4 + oy, 'hair');
    L.rect(8, 5 + oy, 11, (long ? 11 : 8) + oy, 'hair');
    L.set(4, 5 + oy, 'hair');
  }
}

function headscarf({ L, dir, oy }: Ctx) {
  const m = 'headwear';
  if (dir === 'down') {
    L.rect(3, 1 + oy, 12, 12 + oy, m);
    L.rect(4, 13 + oy, 11, 13 + oy, m, 2); // drape over the chest
    L.rect(5, 4 + oy, 10, 9 + oy, 'skin');
    L.h(6, 9, 10 + oy, 'skin');
    L.v(12, 4 + oy, 12 + oy, m, 2);
    L.h(5, 7, 2 + oy, m, 0);
    L.h(3, 12, 12 + oy, m, 2);
  } else if (dir === 'up') {
    L.rect(3, 1 + oy, 12, 13 + oy, m);
    L.v(7, 3 + oy, 12 + oy, m, 2);
    L.h(3, 12, 13 + oy, m, 2);
    L.h(5, 6, 2 + oy, m, 0);
  } else {
    L.rect(4, 1 + oy, 11, 12 + oy, m);
    L.rect(4, 4 + oy, 7, 9 + oy, 'skin');
    L.rect(10, 9 + oy, 12, 13 + oy, m);
    L.v(12, 9 + oy, 13 + oy, m, 2);
    L.h(4, 11, 12 + oy, m, 2);
    L.h(6, 8, 2 + oy, m, 0);
  }
}

function face({ L, dir, oy }: Ctx) {
  if (dir === 'down') {
    for (const x of [6, 9]) {
      L.set(x, 6 + oy, 'eyes');
      L.set(x, 7 + oy, 'eyes');
    }
    L.set(5, 8 + oy, 'blush');
    L.set(10, 8 + oy, 'blush');
  } else if (dir === 'left') {
    L.set(5, 6 + oy, 'eyes');
    L.set(5, 7 + oy, 'eyes');
    L.set(3, 7 + oy, 'skin'); // nose
  }
}

// ------------------------------------------------------------------ sitting pose
/** Rows the body drops when seated (standing frame 0 uses oy = 1). */
const SIT_OY = 4;

/** Seated legs in trousers (or bare legs): knees towards the viewer, thighs forward in profile, hidden from behind. */
function sitLegs({ L, dir }: Ctx, mat: 'bottom' | 'skin') {
  if (dir === 'down') {
    L.rect(5, 22, 7, 22, mat);
    L.rect(8, 22, 10, 22, mat);
    L.v(7, 22, 22, mat, 2);
    L.v(10, 22, 22, mat, 2);
    L.h(5, 7, 23, 'shoes');
    L.h(8, 10, 23, 'shoes');
  } else if (dir === 'left') {
    L.rect(3, 20, 6, 21, mat); // thighs on the seat, pointing forward
    L.h(3, 6, 21, mat, 2);
    L.rect(3, 22, 4, 22, mat); // shins down
    L.h(2, 4, 23, 'shoes');
  }
}

/** Seated skirt or dress: draped over the knees / lap. */
function sitSkirt({ L, dir }: Ctx, mat: 'bottom' | 'overlay', pleats: boolean) {
  if (dir === 'down') {
    L.rect(4, 20, 11, 22, mat);
    L.v(4, 20, 21, mat, 0);
    L.v(11, 20, 22, mat, 2);
    L.h(4, 11, 22, mat, 2);
    if (pleats) for (const x of [6, 9]) L.v(x, 20, 21, mat, 2);
    L.h(5, 6, 23, 'shoes');
    L.h(9, 10, 23, 'shoes');
  } else if (dir === 'up') {
    L.rect(4, 21, 11, 22, mat);
    L.h(4, 11, 22, mat, 2);
  } else {
    L.rect(3, 19, 9, 21, mat); // lap
    L.h(3, 9, 21, mat, 2);
    L.rect(3, 22, 5, 22, mat); // drop over the knees
    L.h(2, 4, 23, 'shoes');
  }
}

export type Pose = 'stand' | 'sit';

/** Paint one frame as material indices (no outline yet). `sit` ignores the walk frame. */
export function paintFrame(spec: RenderSpec, dir: PaintDir, f: Frame, pose: Pose = 'stand'): Uint8Array {
  const L = new Layer();
  const sit = pose === 'sit';
  const ctx: Ctx = { L, dir, f: sit ? 0 : f, oy: sit ? SIT_OY : f === 0 ? 1 : 0 };
  const o = spec.outfit;
  const pinafore = o.overlay?.style === 'pinafore';
  const skirt = sit ? sitSkirt : longSkirt;

  // back to front
  if (pinafore || o.bottom.style === 'longSkirt') {
    if (!sit) skirtShoes(ctx);
    if (o.bottom.style === 'longSkirt') skirt(ctx, 'bottom', false);
  } else if (sit) {
    sitLegs(ctx, o.bottom.style === 'trousers' ? 'bottom' : 'skin');
  } else {
    legsAndShoes(ctx, o.bottom.style === 'trousers' ? 'bottom' : 'skin');
  }
  top(ctx, o);
  if (pinafore) {
    skirt(ctx, 'overlay', true);
    pinaforeBodice(ctx);
  }
  arms(ctx, o.top.style === 'tunic' ? 'long' : o.top.sleeves);
  if (o.neckwear?.style === 'tie') tie(ctx);
  const covered = o.headwear?.style === 'headscarf';
  head(ctx, spec.presentation, covered);
  if (covered) headscarf(ctx);
  face(ctx);
  return L.px;
}

/** Outline every empty pixel that touches the silhouette, then add the soft ground shadow. */
function finishFrame(px: Uint8Array, groundShadow = true): Uint8Array {
  const out = px.slice();
  const solid = (x: number, y: number) => x >= 0 && x < FRAME_W && y >= 0 && y < FRAME_H && px[y * FRAME_W + x] !== CODE_EMPTY;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (px[y * FRAME_W + x] !== CODE_EMPTY) continue;
      if (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1)) out[y * FRAME_W + x] = CODE_OUTLINE;
    }
  }
  if (groundShadow) for (let x = 4; x < 12; x++) if (out[23 * FRAME_W + x] === CODE_EMPTY) out[23 * FRAME_W + x] = CODE_SHADOW;
  return out;
}

/** Full sheet of material codes (SHEET_W x SHEET_H). Exposed for tests and tooling. */
export function composeMaterialSheet(spec: RenderSpec): Uint8Array {
  const sheet = new Uint8Array(SHEET_W * SHEET_H);
  SHEET_DIRECTIONS.forEach((dir, row) => {
    for (let f = 0 as Frame; f < 3; f = (f + 1) as Frame) {
      const frame = finishFrame(paintFrame(spec, dir === 'right' ? 'left' : dir, f));
      for (let y = 0; y < FRAME_H; y++) {
        for (let x = 0; x < FRAME_W; x++) {
          const sx = dir === 'right' ? FRAME_W - 1 - x : x;
          sheet[(row * FRAME_H + y) * SHEET_W + f * FRAME_W + x] = frame[y * FRAME_W + sx];
        }
      }
    }
  });
  return sheet;
}

/** Sitting sheet: one frame per direction (down, left, right, up), SIT_W x FRAME_H. */
export const SIT_W = FRAME_W * SHEET_DIRECTIONS.length;

export function composeSitMaterialSheet(spec: RenderSpec): Uint8Array {
  const sheet = new Uint8Array(SIT_W * FRAME_H);
  SHEET_DIRECTIONS.forEach((dir, col) => {
    const frame = finishFrame(paintFrame(spec, dir === 'right' ? 'left' : dir, 0, 'sit'), false);
    for (let y = 0; y < FRAME_H; y++)
      for (let x = 0; x < FRAME_W; x++) {
        const sx = dir === 'right' ? FRAME_W - 1 - x : x;
        sheet[y * SIT_W + col * FRAME_W + x] = frame[y * FRAME_W + sx];
      }
  });
  return sheet;
}

/** Material + shade -> RGBA for one spec. */
export function resolvePalette(spec: RenderSpec): Map<number, RGBA> {
  const rgba = (hex: string): RGBA => [...hexToRgb(hex), 255];
  const map = new Map<number, RGBA>();
  const put = (m: Material, light: string, base: string, dark: string) => {
    map.set(code(m, 0), rgba(light));
    map.set(code(m, 1), rgba(base));
    map.set(code(m, 2), rgba(dark));
  };
  const putRamp = (m: Material, hex: string) => {
    const r = ramp(hex);
    put(m, r.light, r.base, r.dark);
  };
  const { body, outfit } = spec;
  put('skin', mix(body.skin, '#ffffff', 0.15), body.skin, body.skinShade);
  put('hair', mix(body.hair, '#ffffff', 0.12), body.hair, mix(body.hair, '#000000', 0.25));
  put('eyes', body.eyes, body.eyes, body.eyes);
  put('blush', body.skinShade, body.skinShade, body.skinShade);
  putRamp('top', outfit.top.color);
  putRamp('bottom', outfit.bottom.color);
  putRamp('shoes', outfit.shoes.color);
  if (outfit.overlay) putRamp('overlay', outfit.overlay.color);
  if (outfit.headwear) putRamp('headwear', outfit.headwear.color);
  if (outfit.neckwear) putRamp('neckwear', outfit.neckwear.color);
  map.set(CODE_OUTLINE, OUTLINE_RGBA);
  map.set(CODE_SHADOW, SHADOW_RGBA);
  return map;
}

/** RGBA pixels (SHEET_W x SHEET_H x 4) for a character. Pure: identical input, identical pixels. */
export function renderSheetRGBA(spec: RenderSpec): Uint8ClampedArray<ArrayBuffer> {
  return colorize(composeMaterialSheet(spec), spec);
}

/** RGBA pixels (SIT_W x FRAME_H x 4) of the sitting frames. */
export function renderSitSheetRGBA(spec: RenderSpec): Uint8ClampedArray<ArrayBuffer> {
  return colorize(composeSitMaterialSheet(spec), spec);
}

function colorize(codes: Uint8Array, spec: RenderSpec): Uint8ClampedArray<ArrayBuffer> {
  const palette = resolvePalette(spec);
  const out = new Uint8ClampedArray(codes.length * 4);
  for (let i = 0; i < codes.length; i++) {
    const c = palette.get(codes[i]);
    if (c) out.set(c, i * 4);
  }
  return out;
}

/** Copy one frame (direction row, frame column) out of a sheet. */
export function frameRGBA(sheet: Uint8ClampedArray, dir: SheetDirection, frame: number): Uint8ClampedArray<ArrayBuffer> {
  const row = SHEET_DIRECTIONS.indexOf(dir);
  const out = new Uint8ClampedArray(FRAME_W * FRAME_H * 4);
  for (let y = 0; y < FRAME_H; y++) {
    const start = ((row * FRAME_H + y) * SHEET_W + frame * FRAME_W) * 4;
    out.set(sheet.subarray(start, start + FRAME_W * 4), y * FRAME_W * 4);
  }
  return out;
}
