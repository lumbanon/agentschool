import { COLORS as C } from '../../characters/customization/palette';
import type { Outfit, OutfitSelection } from '../../characters/types';

/**
 * Office World reuse check: one default office outfit rendered by the same
 * character composer. Not a clothing catalog (that comes later).
 * If the player chose to wear a headscarf at school, the same choice carries over.
 */
export function defaultOfficeOutfit(schoolSelection?: OutfitSelection): Outfit {
  return {
    top: { style: 'shirt', sleeves: 'long', color: '#9fc3e6' },
    bottom: { style: 'trousers', color: C.charcoal },
    overlay: null,
    headwear: schoolSelection?.outfit.headwear ? { ...schoolSelection.outfit.headwear } : null,
    neckwear: { style: 'tie', color: C.red },
    shoes: { color: C.black },
  };
}
