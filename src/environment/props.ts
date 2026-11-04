import type { ClockTime, TimeOfDay } from './time';

/**
 * Pixel-art painters for runtime props (engine `prop` map objects). Each returns
 * raw RGBA at 1:1 game pixels, sized to the prop's rectangle, so they are pure
 * and testable without a canvas. Colours match scripts/generate_assets.py.
 */

export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function image(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  const px = (x: number, y: number, c: string) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    data.set([...hex(c), 255], (y * width + x) * 4);
  };
  return { img: { width, height, data } as PixelImage, px };
}

const lerp = (a: RGB, b: RGB, t: number): string =>
  `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;

// ------------------------------------------------------------------ clock face (10 x 9, over tile_clock)

export const CLOCK_FACE = { width: 10, height: 9, cx: 4.5, cy: 4 } as const;
const FACE = '#f7f5ef';
const RIM = '#4e3a28';
const HAND = '#2a2230';
const PIVOT = '#c9443c';
const MARK = '#9a948a';

/** Analog clock face showing the given time (hour and minute hands). */
export function paintClockFace(t: ClockTime): PixelImage {
  const { width, height, cx, cy } = CLOCK_FACE;
  const { img, px } = image(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d <= 16) px(x, y, FACE);
      else if (d <= 22) px(x, y, RIM);
    }
  // 12 / 3 / 6 / 9 marks
  px(4, 1, MARK);
  px(5, 1, MARK);
  px(8, 4, MARK);
  px(4, 7, MARK);
  px(5, 7, MARK);
  px(1, 4, MARK);
  const hand = (turns: number, length: number) => {
    const a = turns * Math.PI * 2;
    for (let r = 0; r <= length; r += 0.25) px(Math.floor(cx + r * Math.sin(a)), Math.floor(cy - r * Math.cos(a) + 0.5), HAND);
  };
  hand(t.minutes / 60, 3.4);
  hand(((t.hours % 12) + t.minutes / 60) / 12, 2.2);
  px(4, 4, PIVOT);
  return img;
}

/** Angle (0 = 12 o'clock, clockwise, in turns) of each hand — exposed for tests. */
export function handTurns(t: ClockTime): { hour: number; minute: number } {
  return { hour: ((t.hours % 12) + t.minutes / 60) / 12, minute: t.minutes / 60 };
}

// ------------------------------------------------------------------ window view (10 x 7, the glass of tile_wall_window)

export const WINDOW_VIEW = { width: 10, height: 7 } as const;
const FRAME = '#6b4f36';

interface SkyStyle {
  top: string;
  horizon: string;
  ground: string;
  paint: (px: (x: number, y: number, c: string) => void) => void;
}

export const SKY: Record<TimeOfDay, SkyStyle> = {
  morning: {
    top: '#7cc6f2',
    horizon: '#dff3ff',
    ground: '#5f9e4f',
    paint: (px) => {
      px(1, 1, '#fff3b0');
      px(2, 1, '#ffe680');
      px(1, 2, '#ffe680');
      px(2, 2, '#ffd84d');
    },
  },
  afternoon: {
    top: '#3f93e0',
    horizon: '#a8dcf8',
    ground: '#4f8f42',
    paint: (px) => {
      for (const [x, y] of [[1, 1], [2, 1], [2, 0], [7, 2], [8, 2], [8, 1]] as const) px(x, y, '#ffffff');
    },
  },
  evening: {
    top: '#7a4a8f',
    horizon: '#ffb36b',
    ground: '#3d5a3a',
    paint: (px) => {
      px(7, 4, '#ff7a3d');
      px(8, 4, '#ff7a3d');
      px(8, 3, '#ffa04d');
    },
  },
  night: {
    top: '#0b1030',
    horizon: '#1f2a5a',
    ground: '#13202a',
    paint: (px) => {
      px(7, 1, '#f4f1d0');
      px(8, 1, '#f4f1d0');
      px(8, 2, '#f4f1d0');
      for (const [x, y] of [[1, 0], [2, 2], [5, 1], [9, 0]] as const) px(x, y, '#e9ecff');
      px(1, 5, '#ffd86b'); // a lit window across the field
    },
  },
};

/** The view through a window at this time of day, with the window's cross bars redrawn on top. */
export function paintWindowView(period: TimeOfDay): PixelImage {
  const { width, height } = WINDOW_VIEW;
  const { img, px } = image(width, height);
  const sky = SKY[period];
  const groundRow = height - 2;
  for (let y = 0; y < height; y++) {
    const c = y >= groundRow ? sky.ground : lerp(hex(sky.top), hex(sky.horizon), y / (groundRow - 1));
    for (let x = 0; x < width; x++) px(x, y, c);
  }
  sky.paint(px);
  // mullion (tile x 7-8) and transom (tile row 6) of the original window frame
  for (let y = 0; y < height; y++) {
    px(4, y, FRAME);
    px(5, y, FRAME);
  }
  for (let x = 0; x < width; x++) px(x, 3, FRAME);
  return img;
}

// ------------------------------------------------------------------ light switch (4 x 6 plate on a wall)

export const LIGHT_SWITCH = { width: 4, height: 6 } as const;

export function paintLightSwitch(on: boolean): PixelImage {
  const { width, height } = LIGHT_SWITCH;
  const { img, px } = image(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) px(x, y, x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#8a8173' : '#f0ebe0');
  const lever = on ? [1, 2] : [3, 4];
  for (const y of lever) {
    px(1, y, '#4a4458');
    px(2, y, '#4a4458');
  }
  if (on) px(2, 4, '#7bd389'); // small green "on" pip
  return img;
}

/** Browser helper: PixelImage -> canvas (for the engine's setPropTexture). */
export function toCanvas(p: PixelImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  canvas.getContext('2d')?.putImageData(new ImageData(p.data, p.width, p.height), 0, 0);
  return canvas;
}
