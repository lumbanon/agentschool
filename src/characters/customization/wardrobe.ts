import type {
  BodyLook,
  BottomStyle,
  CharacterDraft,
  GarmentSlot,
  HeadwearStyle,
  HexColor,
  Outfit,
  OutfitSelection,
  Presentation,
  SleeveLength,
  TopStyle,
} from '../types';
import { DEFAULT_BODY, isHexColor, nearestSkinTone, SKIN_TONES } from './palette';

/**
 * A domain's clothing catalog (school uniforms today; office clothing later).
 * The character system only knows this contract, never a specific domain.
 */
export interface OutfitPreset {
  id: string;
  categoryId: string;
  presentation: Presentation;
  label: string;
  description: string;
  /** Default garments and colours. */
  outfit: Outfit;
  /** Colours offered per slot before custom colours are enabled (first = default). */
  suggestions: Partial<Record<GarmentSlot, HexColor[]>>;
  /** If set, the player may choose among these sleeve lengths. */
  sleeveOptions?: SleeveLength[];
  /** An optional garment; `defaultOn` = worn until the player unticks it. */
  optionalHeadwear?: { style: HeadwearStyle; color: HexColor; label: string; defaultOn?: boolean };
  /** Domain wording for slots, e.g. top -> "Baju Kurung". */
  slotLabels?: Partial<Record<GarmentSlot, string>>;
}

export interface WardrobeCategory {
  id: string;
  label: string;
  description?: string;
}

export interface WardrobeCatalog {
  /** Key in CharacterProfile.wardrobe. */
  id: string;
  title: string;
  /** Domain wording for the creator, e.g. { category: 'Uniform category' }. */
  labels?: { category?: string; restorePreset?: string };
  categories: WardrobeCategory[];
  presets: OutfitPreset[];
  /** Preset used for a brand-new character or "Reset to Default". */
  defaultPresetId: Record<Presentation, string>;
}

const clone = <T>(v: T): T => structuredClone(v);

export function findPreset(catalog: WardrobeCatalog, id: string): OutfitPreset | undefined {
  return catalog.presets.find((p) => p.id === id);
}

export function presetsFor(catalog: WardrobeCatalog, presentation: Presentation, categoryId?: string): OutfitPreset[] {
  return catalog.presets.filter((p) => p.presentation === presentation && (!categoryId || p.categoryId === categoryId));
}

export function defaultPreset(catalog: WardrobeCatalog, presentation: Presentation): OutfitPreset {
  const p = findPreset(catalog, catalog.defaultPresetId[presentation]) ?? presetsFor(catalog, presentation)[0];
  if (!p) throw new Error(`wardrobe ${catalog.id} has no preset for ${presentation}`);
  return p;
}

/**
 * The preset's outfit, optionally keeping the player's choice to wear the
 * optional headwear (its colour comes from the new preset, e.g. "matching").
 */
const defaultWear = (preset: OutfitPreset) => preset.optionalHeadwear?.defaultOn ?? false;

export function outfitFromPreset(preset: OutfitPreset, wearHeadwear = defaultWear(preset)): Outfit {
  const outfit = clone(preset.outfit);
  if (preset.optionalHeadwear) {
    outfit.headwear = wearHeadwear ? { style: preset.optionalHeadwear.style, color: preset.optionalHeadwear.color } : null;
  }
  return outfit;
}

export function selectionFromPreset(preset: OutfitPreset, wearHeadwear = defaultWear(preset), customColors = false): OutfitSelection {
  return { presetId: preset.id, outfit: outfitFromPreset(preset, wearHeadwear), customColors };
}

export function newDraft(catalog: WardrobeCatalog, presentation: Presentation = 'male', name = ''): CharacterDraft {
  return { identity: { name, presentation }, body: { ...DEFAULT_BODY }, selection: selectionFromPreset(defaultPreset(catalog, presentation)) };
}

// ------------------------------------------------------------------ draft operations (pure; never touch the name)

const wearing = (d: CharacterDraft) => d.selection.outfit.headwear !== null;

export function changePresentation(catalog: WardrobeCatalog, d: CharacterDraft, presentation: Presentation): CharacterDraft {
  if (presentation === d.identity.presentation) return d;
  const current = findPreset(catalog, d.selection.presetId);
  const preset = presetsFor(catalog, presentation, current?.categoryId)[0] ?? defaultPreset(catalog, presentation);
  return { ...d, identity: { ...d.identity, presentation }, selection: selectionFromPreset(preset, defaultWear(preset), d.selection.customColors) };
}

export function changeCategory(catalog: WardrobeCatalog, d: CharacterDraft, categoryId: string): CharacterDraft {
  const preset = presetsFor(catalog, d.identity.presentation, categoryId)[0];
  if (!preset) return d;
  return changePreset(catalog, d, preset.id);
}

/** Switch preset: garments and colours come from the preset; name and headwear choice are kept. */
export function changePreset(catalog: WardrobeCatalog, d: CharacterDraft, presetId: string): CharacterDraft {
  const preset = findPreset(catalog, presetId);
  if (!preset || preset.presentation !== d.identity.presentation) return d;
  return { ...d, selection: selectionFromPreset(preset, wearing(d), d.selection.customColors) };
}

/** "Restore Selected Uniform Preset": undo colour / sleeve edits, keep the headwear choice. */
export function restorePreset(catalog: WardrobeCatalog, d: CharacterDraft): CharacterDraft {
  const preset = findPreset(catalog, d.selection.presetId) ?? defaultPreset(catalog, d.identity.presentation);
  return { ...d, selection: selectionFromPreset(preset, wearing(d), d.selection.customColors) };
}

/** "Reset to Default": default preset (and its default options) for the presentation. Name and skin tone are kept. */
export function resetToDefault(catalog: WardrobeCatalog, d: CharacterDraft): CharacterDraft {
  return { ...d, selection: selectionFromPreset(defaultPreset(catalog, d.identity.presentation)) };
}

export function setSkinTone(d: CharacterDraft, toneId: string): CharacterDraft {
  const tone = SKIN_TONES.find((t) => t.id === toneId);
  if (!tone) return d;
  return { ...d, body: { ...d.body, skin: tone.base, skinShade: tone.shade } };
}

export function setSlotColor(d: CharacterDraft, slot: GarmentSlot, color: HexColor): CharacterDraft {
  const outfit = clone(d.selection.outfit);
  const garment = outfit[slot];
  if (!garment) return d;
  garment.color = color;
  return { ...d, selection: { ...d.selection, outfit } };
}

export function setSleeves(d: CharacterDraft, sleeves: SleeveLength): CharacterDraft {
  const outfit = clone(d.selection.outfit);
  outfit.top.sleeves = sleeves;
  return { ...d, selection: { ...d.selection, outfit } };
}

export function setHeadwear(catalog: WardrobeCatalog, d: CharacterDraft, wear: boolean): CharacterDraft {
  const preset = findPreset(catalog, d.selection.presetId);
  if (!preset?.optionalHeadwear) return d;
  const outfit = clone(d.selection.outfit);
  outfit.headwear = wear ? { style: preset.optionalHeadwear.style, color: preset.optionalHeadwear.color } : null;
  return { ...d, selection: { ...d.selection, outfit } };
}

export function setCustomColors(d: CharacterDraft, enabled: boolean): CharacterDraft {
  return { ...d, selection: { ...d.selection, customColors: enabled } };
}

/** Slots that exist in this outfit, in display order. */
export function customizableSlots(outfit: Outfit): GarmentSlot[] {
  const slots: GarmentSlot[] = ['top'];
  if (outfit.bottom.style !== 'none') slots.push('bottom');
  if (outfit.overlay) slots.push('overlay');
  if (outfit.headwear) slots.push('headwear');
  if (outfit.neckwear) slots.push('neckwear');
  slots.push('shoes');
  return slots;
}

const TOP_LABEL: Record<TopStyle, string> = { shirt: 'Shirt', blouse: 'Blouse', tunic: 'Tunic' };
const BOTTOM_LABEL: Record<BottomStyle, string> = { trousers: 'Trousers', longSkirt: 'Skirt', none: 'Bottom' };

export function slotLabel(slot: GarmentSlot, outfit: Outfit, preset?: OutfitPreset): string {
  const custom = preset?.slotLabels?.[slot];
  if (custom) return custom;
  switch (slot) {
    case 'top':
      return TOP_LABEL[outfit.top.style];
    case 'bottom':
      return BOTTOM_LABEL[outfit.bottom.style];
    case 'overlay':
      return 'Pinafore';
    case 'headwear':
      return 'Headscarf';
    case 'neckwear':
      return 'Tie';
    case 'shoes':
      return 'Shoes';
  }
}

// ------------------------------------------------------------------ validation of stored data

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v);
const color = (v: unknown, fallback: HexColor): HexColor => (isHexColor(v) ? v : fallback);

/**
 * Field-by-field repair of an outfit read from storage. Anything malformed is
 * replaced by the corresponding field of `fallback` (normally the preset), so
 * one bad value never discards the rest of the player's choices.
 */
export function normalizeOutfit(raw: unknown, fallback: Outfit): Outfit {
  const o = isObj(raw) ? raw : {};
  const t = isObj(o.top) ? o.top : {};
  const b = isObj(o.bottom) ? o.bottom : {};
  const s = isObj(o.shoes) ? o.shoes : {};
  const optional = <S extends string>(v: unknown, styles: readonly S[], fb: { style: S; color: HexColor } | null) => {
    if (v === null) return null;
    if (isObj(v) && oneOf(v.style, styles)) return { style: v.style, color: color(v.color, fb?.color ?? '#f4f4f4') };
    return fb ? { ...fb } : null;
  };
  return {
    top: {
      style: oneOf(t.style, ['shirt', 'blouse', 'tunic'] as const) ? t.style : fallback.top.style,
      sleeves: oneOf(t.sleeves, ['short', 'long'] as const) ? t.sleeves : fallback.top.sleeves,
      color: color(t.color, fallback.top.color),
    },
    bottom: {
      style: oneOf(b.style, ['trousers', 'longSkirt', 'none'] as const) ? b.style : fallback.bottom.style,
      color: color(b.color, fallback.bottom.color),
    },
    overlay: optional(o.overlay, ['pinafore'] as const, fallback.overlay),
    headwear: optional(o.headwear, ['headscarf'] as const, fallback.headwear),
    neckwear: optional(o.neckwear, ['tie'] as const, fallback.neckwear),
    shoes: { color: color(s.color, fallback.shoes.color) },
  };
}

/**
 * Validate a stored selection against the catalog. Unknown or mismatched presets
 * fall back to the default preset; garment shapes always come from the preset
 * (so a stale save cannot produce, say, trousers under a pinafore), while colours
 * and the player's optional choices are kept when valid.
 */
export function normalizeSelection(catalog: WardrobeCatalog, presentation: Presentation, raw: unknown): OutfitSelection {
  const r = isObj(raw) ? raw : {};
  const found = typeof r.presetId === 'string' ? findPreset(catalog, r.presetId) : undefined;
  const preset = found && found.presentation === presentation ? found : defaultPreset(catalog, presentation);
  if (preset !== found) return selectionFromPreset(preset);
  const stored = normalizeOutfit(r.outfit, preset.outfit);
  const base = outfitFromPreset(preset, isObj(r.outfit) && isObj(r.outfit.headwear));
  const outfit: Outfit = {
    top: {
      ...base.top,
      color: stored.top.color,
      sleeves: preset.sleeveOptions?.includes(stored.top.sleeves) ? stored.top.sleeves : base.top.sleeves,
    },
    bottom: { ...base.bottom, color: stored.bottom.color },
    overlay: base.overlay && { ...base.overlay, color: stored.overlay?.color ?? base.overlay.color },
    headwear: base.headwear && { ...base.headwear, color: stored.headwear?.color ?? base.headwear.color },
    neckwear: base.neckwear && { ...base.neckwear, color: stored.neckwear?.color ?? base.neckwear.color },
    shoes: { color: stored.shoes.color },
  };
  return { presetId: preset.id, outfit, customColors: r.customColors === true };
}

/** Skin always resolves to one of the offered tones (nearest match), with that tone's own shadow. */
export function normalizeBody(raw: unknown): BodyLook {
  const b = isObj(raw) ? raw : {};
  const tone = isHexColor(b.skin) ? nearestSkinTone(b.skin) : nearestSkinTone(DEFAULT_BODY.skin);
  return { skin: tone.base, skinShade: tone.shade, hair: color(b.hair, DEFAULT_BODY.hair), eyes: color(b.eyes, DEFAULT_BODY.eyes) };
}
