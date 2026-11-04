import type { BodyLook, HexColor } from '../types';

export interface NamedColor {
  id: string;
  label: string;
  hex: HexColor;
}

/** General-purpose clothing palette. Domains pick suggestions from it; players may use any colour. */
export const PALETTE = [
  { id: 'white', label: 'White', hex: '#f4f4f4' },
  { id: 'black', label: 'Black', hex: '#1e1e24' },
  { id: 'navy', label: 'Navy blue', hex: '#1d2a4d' },
  { id: 'darkBlue', label: 'Dark blue', hex: '#24407a' },
  { id: 'blue', label: 'Blue', hex: '#3d7cc9' },
  { id: 'lightBlue', label: 'Light blue', hex: '#8ec5e8' },
  { id: 'turquoise', label: 'Turquoise', hex: '#36b8bf' },
  { id: 'oliveGreen', label: 'Olive green', hex: '#5b6b34' },
  { id: 'green', label: 'Green', hex: '#3f8f5a' },
  { id: 'grey', label: 'Grey', hex: '#8a8f98' },
  { id: 'charcoal', label: 'Charcoal', hex: '#3a3f47' },
  { id: 'maroon', label: 'Maroon', hex: '#7a2836' },
  { id: 'red', label: 'Red', hex: '#c9443c' },
  { id: 'pink', label: 'Pink', hex: '#e59ab5' },
  { id: 'purple', label: 'Purple', hex: '#7b5aa6' },
  { id: 'yellow', label: 'Yellow', hex: '#e8c547' },
  { id: 'beige', label: 'Beige', hex: '#c8b48a' },
  { id: 'brown', label: 'Brown', hex: '#6b4a2e' },
] as const satisfies readonly NamedColor[];

export type PaletteId = (typeof PALETTE)[number]['id'];
export const COLORS = Object.fromEntries(PALETTE.map((c) => [c.id, c.hex])) as Record<PaletteId, HexColor>;

export function colorLabel(hex: HexColor): string {
  return PALETTE.find((c) => c.hex === hex.toLowerCase())?.label ?? hex.toLowerCase();
}

export interface SkinTone {
  id: string;
  label: string;
  /** Face, hands and other visible skin. */
  base: HexColor;
  /** Shading under the chin and the cheek blush. */
  shade: HexColor;
}

/** Ordered light to dark. */
export const SKIN_TONES = [
  { id: 'white', label: 'White', base: '#ffe0cc', shade: '#f2b8a0' },
  { id: 'light', label: 'Light', base: '#f8c9a0', shade: '#e8a07e' },
  { id: 'tan', label: 'Yellow / tan', base: '#efc27a', shade: '#d99a5e' },
  { id: 'brown', label: 'Brown', base: '#c68a54', shade: '#a06a3c' },
  { id: 'darkBrown', label: 'Dark brown', base: '#8a5530', shade: '#6a3e22' },
  { id: 'black', label: 'Black', base: '#4a2c1c', shade: '#341e12' },
] as const satisfies readonly SkinTone[];

export type SkinToneId = (typeof SKIN_TONES)[number]['id'];

/** The tone whose base is closest to `hex` (used to read older saves and repair bad data). */
export function nearestSkinTone(hex: unknown): SkinTone {
  if (!isHexColor(hex)) return SKIN_TONES[2];
  const [r, g, b] = hexToRgb(hex);
  let best: SkinTone = SKIN_TONES[0];
  let bestD = Infinity;
  for (const t of SKIN_TONES) {
    const [x, y, z] = hexToRgb(t.base);
    const d = (r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

export function skinToneOf(body: BodyLook): SkinTone | undefined {
  return SKIN_TONES.find((t) => t.base === body.skin);
}

/** Default body keeps the original Phase 0 look (closest tone: yellow / tan). */
export const DEFAULT_BODY: BodyLook = { skin: SKIN_TONES[2].base, skinShade: SKIN_TONES[2].shade, hair: '#1f1a22', eyes: '#1f1a22' };

// ------------------------------------------------------------------ hex helpers

export type RGBA = [number, number, number, number];

/** Accepts "#rgb", "#rrggbb", with or without "#". Returns canonical "#rrggbb" or null. */
export function normalizeHex(input: string): HexColor | null {
  const m = input.trim().toLowerCase().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h}`;
}

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value);
}

export function hexToRgb(hex: HexColor): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): HexColor {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export function mix(a: HexColor, b: HexColor, t: number): HexColor {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as [number, number, number]);
}

/**
 * Three-step ramp used for every recolourable region: highlight, base, shadow.
 * Shadows lean towards the game's cool purple outline so recoloured clothing
 * sits in the same lighting as the hand-drawn world.
 */
export interface Ramp {
  light: HexColor;
  base: HexColor;
  dark: HexColor;
}

const SHADOW_TINT = '#2a2240';

export function ramp(base: HexColor): Ramp {
  return { light: mix(base, '#ffffff', 0.25), base, dark: mix(base, SHADOW_TINT, 0.22) };
}
