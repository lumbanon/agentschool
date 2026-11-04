import type { Page } from '@playwright/test';

export const CHARACTER_KEY = 'agentschool.character';

/** A complete schema-v1 character (male, regular uniform) so world tests skip the creator. */
export const SEED_PROFILE = {
  schemaVersion: 1,
  identity: { name: 'Alex', presentation: 'male' },
  body: { skin: '#f1c27d', hair: '#1f1a22', eyes: '#1f1a22' },
  wardrobe: {
    school: {
      presetId: 'male.regular.standard',
      outfit: {
        top: { style: 'shirt', sleeves: 'short', color: '#f4f4f4' },
        bottom: { style: 'trousers', color: '#5b6b34' },
        overlay: null,
        headwear: null,
        neckwear: null,
        shoes: { color: '#1e1e24' },
      },
      customColors: false,
    },
  },
  creationComplete: true,
  updatedAt: '2026-11-04T00:00:00.000Z',
};

/** Store the seed character before the first page load (only if no character is saved yet). */
export async function seedCharacter(page: Page, profile: object = SEED_PROFILE) {
  await page.addInitScript(
    ([key, value]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    [CHARACTER_KEY, JSON.stringify(profile)] as const,
  );
}
