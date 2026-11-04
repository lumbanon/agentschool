import { COLORS as C } from '../../../characters/customization/palette';
import type { OutfitPreset, WardrobeCatalog } from '../../../characters/customization/wardrobe';
import type { Outfit } from '../../../characters/types';

/**
 * Malaysian secondary-school uniforms (Phase 0). Secondary only — no primary
 * uniforms in this version. These are defaults and presets; with custom colours
 * on, every component accepts any colour.
 *
 * The headscarf is optional: it is worn by default with the female outfits and
 * the player unticks it to remove it (developer decision). It is a clothing
 * choice only, nothing else is inferred from it.
 */

const none = { overlay: null, headwear: null, neckwear: null } as const;
const headscarf = (color: string) => ({ style: 'headscarf' as const, color, label: 'Headscarf (optional, untick to remove)', defaultOn: true });

const outfit = (o: Omit<Outfit, 'overlay' | 'headwear' | 'neckwear'> & Partial<Outfit>): Outfit => ({ ...none, ...o });

export const SCHOOL_PRESETS: OutfitPreset[] = [
  // ---------------------------------------------------------------- male
  {
    id: 'male.regular.standard',
    categoryId: 'regular',
    presentation: 'male',
    label: 'Standard uniform',
    description: 'White shirt, olive-green long trousers.',
    outfit: outfit({
      top: { style: 'shirt', sleeves: 'short', color: C.white },
      bottom: { style: 'trousers', color: C.oliveGreen },
      shoes: { color: C.black },
    }),
    sleeveOptions: ['short', 'long'],
    suggestions: { top: [C.white], bottom: [C.oliveGreen], shoes: [C.black, C.white] },
  },
  {
    id: 'male.prefect.white',
    categoryId: 'prefect',
    presentation: 'male',
    label: 'Preset A — White Prefect Uniform',
    description: 'White long-sleeve shirt, white or dark-blue trousers.',
    outfit: outfit({
      top: { style: 'shirt', sleeves: 'long', color: C.white },
      bottom: { style: 'trousers', color: C.darkBlue },
      shoes: { color: C.black },
    }),
    suggestions: { top: [C.white], bottom: [C.darkBlue, C.white], shoes: [C.black] },
  },
  {
    id: 'male.prefect.blue',
    categoryId: 'prefect',
    presentation: 'male',
    label: 'Preset B — Blue Prefect Uniform',
    description: 'Blue long-sleeve shirt, black or dark-blue trousers.',
    outfit: outfit({
      top: { style: 'shirt', sleeves: 'long', color: C.blue },
      bottom: { style: 'trousers', color: C.black },
      shoes: { color: C.black },
    }),
    suggestions: { top: [C.blue], bottom: [C.black, C.darkBlue], shoes: [C.black] },
  },
  // ---------------------------------------------------------------- female
  {
    id: 'female.regular.bajuKurung',
    categoryId: 'regular',
    presentation: 'female',
    label: 'Style A — Baju Kurung',
    description: 'White long-sleeve baju kurung, long turquoise skirt.',
    outfit: outfit({
      top: { style: 'tunic', sleeves: 'long', color: C.white },
      bottom: { style: 'longSkirt', color: C.turquoise },
      shoes: { color: C.black },
    }),
    optionalHeadwear: headscarf(C.white),
    suggestions: { top: [C.white], bottom: [C.turquoise, C.lightBlue], headwear: [C.white], shoes: [C.black, C.white] },
    slotLabels: { top: 'Baju Kurung', bottom: 'Skirt (kain)' },
  },
  {
    id: 'female.regular.pinafore',
    categoryId: 'regular',
    presentation: 'female',
    label: 'Style B — Pinafore',
    description: 'White short-sleeve shirt under a turquoise pinafore.',
    outfit: outfit({
      top: { style: 'shirt', sleeves: 'short', color: C.white },
      bottom: { style: 'none', color: C.turquoise },
      overlay: { style: 'pinafore', color: C.turquoise },
      shoes: { color: C.black },
    }),
    optionalHeadwear: headscarf(C.white),
    suggestions: { top: [C.white], overlay: [C.turquoise, C.lightBlue], headwear: [C.white], shoes: [C.black, C.white] },
  },
  {
    id: 'female.prefect.bajuKurung',
    categoryId: 'prefect',
    presentation: 'female',
    label: 'Style A — Prefect Baju Kurung',
    description: 'Blue long-sleeve baju kurung, black or dark-blue skirt.',
    outfit: outfit({
      top: { style: 'tunic', sleeves: 'long', color: C.blue },
      bottom: { style: 'longSkirt', color: C.darkBlue },
      shoes: { color: C.black },
    }),
    optionalHeadwear: headscarf(C.blue),
    suggestions: { top: [C.blue], bottom: [C.darkBlue, C.black], headwear: [C.blue, C.white], shoes: [C.black] },
    slotLabels: { top: 'Baju Kurung', bottom: 'Skirt (kain)' },
  },
  {
    id: 'female.prefect.blouse',
    categoryId: 'prefect',
    presentation: 'female',
    label: 'Style B — Prefect Blouse',
    description: 'White long-sleeve blouse, turquoise skirt.',
    outfit: outfit({
      top: { style: 'blouse', sleeves: 'long', color: C.white },
      bottom: { style: 'longSkirt', color: C.turquoise },
      shoes: { color: C.black },
    }),
    optionalHeadwear: headscarf(C.white),
    suggestions: { top: [C.white], bottom: [C.turquoise], headwear: [C.white], shoes: [C.black] },
  },
];

export const SCHOOL_WARDROBE: WardrobeCatalog = {
  id: 'school',
  title: 'Secondary school uniform',
  labels: { category: 'Uniform category', restorePreset: 'Restore selected uniform preset' },
  categories: [
    { id: 'regular', label: 'Regular Secondary Student' },
    { id: 'prefect', label: 'School Prefect' },
  ],
  presets: SCHOOL_PRESETS,
  defaultPresetId: { male: 'male.regular.standard', female: 'female.regular.bajuKurung' },
};
