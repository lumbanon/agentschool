import { normalizeSelection } from '../characters/customization/wardrobe';
import type { WardrobeNormalizer } from '../characters/persistence';
import type { CharacterProfile, RenderSpec } from '../characters/types';
import { defaultOfficeOutfit } from './office/outfits';
import { SCHOOL_WARDROBE } from './school/uniforms/presets';

/** Wardrobes the character creator can edit, by wardrobe id. */
export const WARDROBES = { school: SCHOOL_WARDROBE } as const;

/** Domain-aware validation of stored wardrobe entries. */
export const WARDROBE_NORMALIZERS: Record<string, WardrobeNormalizer> = {
  school: (raw, presentation) => normalizeSelection(SCHOOL_WARDROBE, presentation, raw),
};

/** How the saved character looks in a given world (null = keep the world's default sprite). */
export function characterSpecForWorld(worldId: string, profile: CharacterProfile | null): RenderSpec | null {
  if (!profile?.creationComplete) return null;
  const { presentation } = profile.identity;
  const school = profile.wardrobe.school ?? normalizeSelection(SCHOOL_WARDROBE, presentation, null);
  const outfit = worldId === 'office' ? defaultOfficeOutfit(school) : school.outfit;
  return { presentation, body: profile.body, outfit };
}
