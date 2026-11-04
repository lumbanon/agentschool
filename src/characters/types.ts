/**
 * Character model, independent of any world or domain.
 *
 *   identity    — who the character is (name, presentation)
 *   body        — skin / hair / eye colours (shared across every outfit)
 *   outfit      — garments and their colours (what a domain dresses them in)
 *   selection   — which domain preset an outfit came from + whether custom colours are on
 *   profile     — the persisted, versioned bundle of all of the above
 *
 * Garment kinds are generic clothing shapes. A domain gives them names
 * (e.g. a school calls a long-sleeve `tunic` worn over a `longSkirt` "Baju Kurung").
 */

/** Selects the base body / hair template. Says nothing about beliefs or which garments are allowed. */
export type Presentation = 'male' | 'female';

/** '#rrggbb', lower-case. */
export type HexColor = string;

export type TopStyle = 'shirt' | 'blouse' | 'tunic';
export type SleeveLength = 'short' | 'long';
export type BottomStyle = 'trousers' | 'longSkirt' | 'none';
export type OverlayStyle = 'pinafore';
export type HeadwearStyle = 'headscarf';
export type NeckwearStyle = 'tie';

export interface Outfit {
  top: { style: TopStyle; sleeves: SleeveLength; color: HexColor };
  bottom: { style: BottomStyle; color: HexColor };
  /** Worn over the top, e.g. a pinafore dress. */
  overlay: { style: OverlayStyle; color: HexColor } | null;
  headwear: { style: HeadwearStyle; color: HexColor } | null;
  neckwear: { style: NeckwearStyle; color: HexColor } | null;
  shoes: { color: HexColor };
}

export type GarmentSlot = 'top' | 'bottom' | 'overlay' | 'headwear' | 'neckwear' | 'shoes';

export interface BodyLook {
  /** Skin base colour (one of the creator's skin tones). */
  skin: HexColor;
  /** Matching skin shadow, also used for the cheek blush. */
  skinShade: HexColor;
  hair: HexColor;
  eyes: HexColor;
}

export interface CharacterIdentity {
  name: string;
  presentation: Presentation;
}

/** Everything the sprite composer needs. */
export interface RenderSpec {
  presentation: Presentation;
  body: BodyLook;
  outfit: Outfit;
}

export interface OutfitSelection {
  /** Preset id inside the domain's wardrobe catalog. */
  presetId: string;
  outfit: Outfit;
  /** The player unlocked the full palette / colour picker for this outfit. */
  customColors: boolean;
}

export const CHARACTER_SCHEMA_VERSION = 2;

/** Persisted character (schema v2: v1 + body.skinShade). Designed to map 1:1 onto a future database row + JSON column. */
export interface CharacterProfile {
  schemaVersion: typeof CHARACTER_SCHEMA_VERSION;
  identity: CharacterIdentity;
  body: BodyLook;
  /** Outfit per wardrobe / domain id (e.g. "school"). Lets one character own several wardrobes. */
  wardrobe: Record<string, OutfitSelection>;
  creationComplete: boolean;
  updatedAt: string;
}

/** Working copy edited by the creator UI for one wardrobe. */
export interface CharacterDraft {
  identity: CharacterIdentity;
  body: BodyLook;
  selection: OutfitSelection;
}
