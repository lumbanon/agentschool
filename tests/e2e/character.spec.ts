import { expect, test, type Page } from '@playwright/test';
import { CHARACTER_KEY, SEED_PROFILE, seedCharacter } from './fixtures';
import { approachTeacher, enterClassroom, hold, snap, waitForRoom } from './helpers';

type HookWindow = Window & { __agentWorld?: { playerTextureKey: string; textureSignature(key: string): string | null } };

const previewSignature = (page: Page) => page.getByTestId('character-preview').getAttribute('data-sheet-signature');
const gameSignature = (page: Page) =>
  page.evaluate(() => {
    const w = (window as HookWindow).__agentWorld;
    return w ? w.textureSignature(w.playerTextureKey) : null;
  });
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), CHARACTER_KEY);

/** Does the big preview canvas currently contain this exact RGB colour? */
const previewHasColor = (page: Page, rgb: [number, number, number]) =>
  page.evaluate(([r, g, b]) => {
    const c = document.querySelector<HTMLCanvasElement>('.preview-big');
    const d = c?.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
    if (!d) return false;
    for (let i = 0; i < d.length; i += 4) if (d[i] === r && d[i + 1] === g && d[i + 2] === b && d[i + 3] === 255) return true;
    return false;
  }, rgb);

test('a new player creates a character before entering the school', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('character-creator')).toBeVisible();
  await expect(page.getByTestId('game-canvas')).toHaveCount(0);

  // Name validation
  const enter = page.getByTestId('enter-world');
  await expect(enter).toBeDisabled();
  await page.getByTestId('name-input').fill('   ');
  await expect(page.getByTestId('name-error')).toHaveText('Please enter a name.');
  await page.getByTestId('name-input').fill('Alex 😀');
  await expect(page.getByTestId('name-error')).toContainText('letters, numbers');
  await page.getByTestId('name-input').fill('A'.repeat(25));
  await expect(page.getByTestId('name-error')).toContainText('at most 24');
  await expect(enter).toBeDisabled();
  await page.getByTestId('name-input').fill('  Aisyah  ');
  await expect(page.getByTestId('preview-name')).toHaveText('Aisyah');

  // Female, regular, baju kurung (default), optional headscarf, custom skirt colour
  await page.getByTestId('presentation-female').click();
  await expect(page.getByTestId('preset-female.regular.bajuKurung')).toHaveAttribute('aria-pressed', 'true');
  // Headscarf is ticked by default; unticking removes it, ticking restores it.
  await expect(page.getByTestId('headwear-toggle')).toBeChecked();
  const withScarf = await previewSignature(page);
  await page.getByTestId('headwear-toggle').uncheck();
  await expect.poll(() => previewSignature(page)).not.toBe(withScarf);
  await page.getByTestId('headwear-toggle').check();
  await expect.poll(() => previewSignature(page)).toBe(withScarf);
  // Skin tone, beside the name
  await page.getByTestId('skin-brown').click();
  await expect(page.getByTestId('skin-brown')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('custom-colors-toggle').check();
  // real keystrokes (the PR review bug: "#7a2" used to be expanded to "#77aa22" mid-typing)
  await page.getByTestId('hex-bottom').fill('');
  await page.getByTestId('hex-bottom').pressSequentially('#7a2836', { delay: 50 }); // human typing speed
  await expect(page.getByTestId('hex-bottom')).toHaveValue('#7a2836');
  await expect(page.getByTestId('color-bottom')).toHaveAttribute('data-value', '#7a2836');
  await page.getByTestId('toggle-walk').click(); // idle frame, front view: skirt visible
  await expect.poll(() => previewHasColor(page, [122, 40, 54])).toBe(true);
  await expect.poll(() => previewHasColor(page, [0xc6, 0x8a, 0x54])).toBe(true); // brown skin base
  await expect(page.getByTestId('preview-outfit')).toHaveText('Regular Secondary Student · Style A — Baju Kurung');

  // Rotate through all four directions
  for (const facing of ['Left', 'Back', 'Right', 'Front']) {
    await page.getByTestId('rotate-right').click();
    await expect(page.getByTestId('preview-facing')).toHaveText(facing);
  }
  const preview = await previewSignature(page);

  await enter.click();
  await waitForRoom(page, 'hallway', 'school');
  // The Phaser sprite holds exactly the pixels the preview showed.
  expect(await gameSignature(page)).toBe(preview);
  expect((await snap(page)).label).toEqual({ text: 'Aisyah', visible: true });
  await expect(page.getByTestId('character-chip')).toHaveText('Aisyah');

  // Movement, door, room change and NPC dialogue with the custom sprite
  await enterClassroom(page);
  expect(await gameSignature(page)).toBe(preview);
  await approachTeacher(page);
  await page.keyboard.press('e');
  await expect(page.getByTestId('dialogue-text')).toHaveText(/^Selamat pagi, Aisyah! Welcome to class\./);
  await page.keyboard.press('Escape');

  // Persistence through refresh: no creator, same character
  const saved = await stored(page);
  expect(saved).toMatchObject({
    schemaVersion: 2,
    identity: { name: 'Aisyah', presentation: 'female' },
    body: { skin: '#c68a54', skinShade: '#a06a3c' },
    creationComplete: true,
    wardrobe: { school: { presetId: 'female.regular.bajuKurung', customColors: true, outfit: { bottom: { color: '#7a2836' }, headwear: { style: 'headscarf' } } } },
  });
  await page.reload();
  await waitForRoom(page, 'hallway', 'school');
  await expect(page.getByTestId('character-creator')).toHaveCount(0);
  expect(await gameSignature(page)).toBe(preview);
  expect(errors).toEqual([]);
});

test('Save Character keeps the creator open; the saved draft survives a refresh', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('name-input').fill('Wei Ling');
  await page.getByTestId('presentation-female').click();
  await page.getByTestId('preset-female.regular.pinafore').click();
  await page.getByTestId('save-character').click();
  await expect(page.getByTestId('creator-status')).toHaveText('Character saved.');
  await expect(page.getByTestId('character-creator')).toBeVisible();
  await page.reload();
  await waitForRoom(page, 'hallway', 'school');
  expect((await stored(page)).wardrobe.school.presetId).toBe('female.regular.pinafore');
});

test('edit character from the game updates the sprite live, keeping room and position', async ({ page }) => {
  await seedCharacter(page);
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');
  await hold(page, 'right', 300);
  const before = await snap(page);
  const oldSig = await gameSignature(page);

  await page.getByTestId('edit-character').click();
  await expect(page.getByTestId('character-creator')).toHaveAttribute('data-mode', 'edit');
  await expect(page.getByTestId('name-input')).toHaveValue('Alex');
  // Typing in the editor must not move the player behind it.
  await page.getByTestId('name-input').fill('Alex Tan wasd');
  await page.getByTestId('name-input').fill('Alex Tan');
  await page.getByTestId('category-prefect').click();
  await page.getByTestId('preset-male.prefect.blue').click();
  await expect(page.getByTestId('color-top')).toHaveAttribute('data-value', '#3d7cc9');
  const preview = await previewSignature(page);
  await page.getByTestId('enter-world').click();
  await expect(page.getByTestId('character-creator')).toHaveCount(0);

  await expect.poll(() => gameSignature(page)).toBe(preview);
  expect(preview).not.toBe(oldSig);
  const after = await snap(page);
  expect({ room: after.roomId, x: after.x, y: after.y }).toEqual({ room: before.roomId, x: before.x, y: before.y });
  expect(after.label.text).toBe('Alex Tan');

  // Cancel discards changes
  await page.getByTestId('edit-character').click();
  await page.getByTestId('reset-default').click();
  await expect(page.getByTestId('preset-male.regular.standard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('name-input')).toHaveValue('Alex Tan');
  await page.getByTestId('creator-cancel').click();
  expect(await gameSignature(page)).toBe(preview);
  expect((await stored(page)).wardrobe.school.presetId).toBe('male.prefect.blue');

  // Movement still works after editing
  await hold(page, 'left', 300);
  expect((await snap(page)).x).toBeLessThan(after.x - 5);
});

test('reset character asks for confirmation, then returns to a fresh creator', async ({ page }) => {
  await seedCharacter(page);
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');
  await page.getByTestId('reset-character').click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(await stored(page)).not.toBeNull();

  await page.getByTestId('reset-character').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('character-creator')).toBeVisible();
  await expect(page.getByTestId('name-input')).toHaveValue('');
  await expect(page.getByTestId('preset-male.regular.standard')).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toBeNull();
});

for (const [label, value] of [
  ['not JSON', '{oops'],
  ['a future schema version', JSON.stringify({ ...SEED_PROFILE, schemaVersion: 99 })],
  ['an invalid name', JSON.stringify({ ...SEED_PROFILE, identity: { name: '', presentation: 'male' } })],
] as const) {
  test(`recovers from stored data that is ${label}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [CHARACTER_KEY, value] as const);
    await page.goto('/');
    await expect(page.getByTestId('character-creator')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('office world reuses the composer: same person, office outfit', async ({ page }) => {
  await seedCharacter(page);
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');
  const schoolSig = await gameSignature(page);
  await page.getByTestId('world-office').click();
  await waitForRoom(page, 'office', 'office');
  const officeSig = await gameSignature(page);
  expect(officeSig).not.toBeNull();
  expect(officeSig).not.toBe(schoolSig);
  expect((await snap(page)).label.text).toBe('Alex');
  expect((await snap(page)).playerTexture).toBe('char-manager');
});
