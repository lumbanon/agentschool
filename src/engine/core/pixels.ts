/**
 * Stable 32-bit FNV-1a signature of raw RGBA pixels. Lets tests prove two
 * renderers (e.g. a UI preview and the game texture) hold identical pixels.
 */
export function pixelSignature(data: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
