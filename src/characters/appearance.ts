import { FRAME_H, renderSheetRGBA, renderSitSheetRGBA, SHEET_H, SHEET_W, SIT_W } from './customization/spriteComposer';
import type { CharacterDraft, CharacterProfile, RenderSpec } from './types';
import { CHARACTER_SCHEMA_VERSION } from './types';

export function specFromDraft(d: CharacterDraft): RenderSpec {
  return { presentation: d.identity.presentation, body: d.body, outfit: d.selection.outfit };
}

/** Merge a draft for one wardrobe into a (possibly existing) profile. */
export function profileFromDraft(d: CharacterDraft, wardrobeId: string, existing: CharacterProfile | null): CharacterProfile {
  return {
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    identity: { ...d.identity },
    body: { ...d.body },
    wardrobe: { ...(existing?.wardrobe ?? {}), [wardrobeId]: structuredClone(d.selection) },
    creationComplete: true,
    updatedAt: new Date().toISOString(),
  };
}

/** Rendered sheet as a canvas (browser only) — the same pixels the preview shows. */
export function sheetCanvas(spec: RenderSpec): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(renderSheetRGBA(spec), SHEET_W, SHEET_H), 0, 0);
  return canvas;
}

/** Sitting frames (down, left, right, up) as a canvas, for the engine's `<key>:sit` texture. */
export function sitSheetCanvas(spec: RenderSpec): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIT_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(renderSitSheetRGBA(spec), SIT_W, FRAME_H), 0, 0);
  return canvas;
}
