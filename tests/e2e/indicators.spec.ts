import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_PROBE, distanceToRect } from '../../src/engine/core/interaction';
import { parseMapObjects, type TiledMap } from '../../src/engine/core/tiled';
import { seedCharacter } from './fixtures';
import { enterClassroom, hold, snap, waitForRoom, walkTo, type Snap } from './helpers';

/*
 * Regression tests for the interaction indicator ("!" bubble).
 * Root causes fixed: (1) the indicator was anchored to the FIRST zone with the
 * target's id, so with six lockers sharing one id it hovered over locker 1 while
 * the player stood at locker 6; (2) the probe reached 24 px (1.5 tiles).
 */

const MAPS: Record<string, string> = { hallway: 'maps/school/hallway.json', classroom: 'maps/school/classroom.json', office: 'maps/office/office.json' };
const zonesOf = (room: string) => parseMapObjects(JSON.parse(readFileSync(join('public', MAPS[room]), 'utf8')) as TiledMap).interactableZones;
const MAX_REACH = DEFAULT_PROBE.reach + DEFAULT_PROBE.radius; // 14 px

/** The indicator invariant, checked on every sample. */
function checkIndicator(s: Snap) {
  if (!s.indicator.visible) return;
  expect(s.targetKey, 'indicator visible without a target').not.toBeNull();
  expect(s.mode).toBe('exploring');
  const m = s.targetKey!.match(/^zone:(\d+)$/);
  if (!m) return; // seats / NPCs are checked in their own tests
  const zone = zonesOf(s.roomId)[Number(m[1])];
  expect(distanceToRect(s.feet, zone), `target ${zone.interactableId} too far from feet (${s.x},${s.y})`).toBeLessThanOrEqual(MAX_REACH);
  expect(s.indicator.x).toBeGreaterThanOrEqual(zone.x);
  expect(s.indicator.x).toBeLessThanOrEqual(zone.x + zone.width);
}

/** Hold a key and check the invariant every ~frame while moving. */
async function sweep(page: Page, key: string, ms: number) {
  const seen = new Set<string>();
  await page.keyboard.down(key);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await snap(page);
    checkIndicator(s);
    if (s.indicator.visible && s.targetId) seen.add(s.targetId);
  }
  await page.keyboard.up(key);
  return seen;
}

const LOCKER_X = [104, 136, 168, 200, 232, 264]; // tile centres of lockers 1..6
const dialogue = (page: Page) => page.getByTestId('dialogue-text');

/** Press E until a dialogue opens (E is ignored for 250 ms after a dialogue closes, by design). */
async function openDialogue(page: Page) {
  await expect(async () => {
    if (!(await page.getByTestId('dialogue').isVisible())) await page.keyboard.press('e');
    await expect(page.getByTestId('dialogue')).toBeVisible({ timeout: 400 });
  }).toPass({ timeout: 5_000 });
}

test.beforeEach(async ({ page }) => {
  await seedCharacter(page);
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');
});

test('no indicator from across the room; appears only when within one tile; hides at once when leaving', async ({ page }) => {
  let s = await snap(page);
  expect(s.indicator.visible).toBe(false);
  await walkTo(page, [['x', 104]]);
  await hold(page, 'up', 30); // face the lockers from the middle of the hallway
  s = await snap(page);
  expect({ y: s.y, indicator: s.indicator.visible, target: s.targetId }).toEqual({ y: s.y, indicator: false, target: null });

  // approach: 1.5 tiles away is still out of range (this was in range before the fix)
  await walkTo(page, [['y', 56]]);
  await hold(page, 'up', 20);
  s = await snap(page);
  expect(s.y).toBeGreaterThan(48);
  expect(s.indicator.visible).toBe(false);

  await walkTo(page, [['y', 40]]);
  await hold(page, 'up', 150);
  s = await snap(page);
  expect({ target: s.targetId, visible: s.indicator.visible, x: s.indicator.x }).toEqual({ target: 'hallway_locker_1', visible: true, x: 104 });
  // interaction position = feet body centre = the sprite position (origin is set to the feet)
  expect(Math.abs(s.feet.x - s.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(s.feet.y - s.y)).toBeLessThanOrEqual(0.5);

  // walk away: gone as soon as we're out of reach
  const seen = await sweep(page, 'ArrowDown', 500);
  expect(seen.size).toBeLessThanOrEqual(1);
  s = await snap(page);
  expect(s.y).toBeGreaterThan(55);
  expect({ visible: s.indicator.visible, target: s.targetId }).toEqual({ visible: false, target: null });
});

test('indicator sits on the locker in front of you, and E opens that same locker (all six are different)', async ({ page }) => {
  const texts: string[] = [];
  for (const [i, x] of LOCKER_X.entries()) {
    await walkTo(page, [
      ['y', 40],
      ['x', x],
    ]);
    await hold(page, 'up', 150);
    const s = await snap(page);
    expect({ target: s.targetId, ix: s.indicator.x, visible: s.indicator.visible }).toEqual({ target: `hallway_locker_${i + 1}`, ix: x, visible: true });
    await expect(page.getByTestId('interaction-prompt')).toContainText(`locker ${i + 1}`);
    await openDialogue(page);
    await expect(page.getByTestId('dialogue-speaker')).toContainText(`Locker ${i + 1}`);
    texts.push((await dialogue(page).textContent()) ?? '');
    // while the dialogue is open there is no indicator
    expect((await snap(page)).indicator.visible).toBe(false);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await snap(page)).mode).toBe('exploring');
    // and it comes back for the same locker after closing (still in range)
    await expect.poll(async () => (await snap(page)).targetId).toBe(`hallway_locker_${i + 1}`);
  }
  expect(new Set(texts).size).toBe(6);

  // same locker again -> same message
  await walkTo(page, [['x', LOCKER_X[2]]]);
  await hold(page, 'up', 100);
  await openDialogue(page);
  await expect(dialogue(page)).toHaveText(texts[2]);
});

test('between two lockers: one indicator, matching what E opens', async ({ page }) => {
  await walkTo(page, [
    ['y', 40],
    ['x', 120],
  ]);
  await hold(page, 'up', 150);
  const s = await snap(page);
  expect(s.indicator.visible).toBe(true);
  expect(['hallway_locker_1', 'hallway_locker_2']).toContain(s.targetId);
  expect(s.indicator.x).toBe(s.targetId === 'hallway_locker_1' ? 104 : 136);
  await openDialogue(page);
  await expect(page.getByTestId('dialogue-speaker')).toHaveText(s.targetId === 'hallway_locker_1' ? 'Locker 1' : 'Locker 2');
});

test('walking along the lockers and past the door: the indicator is always valid and never stale', async ({ page }) => {
  await walkTo(page, [
    ['y', 40],
    ['x', 96],
  ]);
  await hold(page, 'up', 150);
  const seenRight = await sweep(page, 'ArrowRight', 2400);
  // every locker passed was only ever targeted while beside it (checked per sample)
  expect(seenRight.size).toBeGreaterThanOrEqual(3);
  await sweep(page, 'ArrowDown', 400);
  await sweep(page, 'ArrowLeft', 1500);
  const s = await snap(page);
  checkIndicator(s);
});

test('room transitions and world switching clear the indicator', async ({ page }) => {
  // stand at locker 3 (next to the door) with the indicator showing
  await walkTo(page, [
    ['y', 40],
    ['x', 168],
  ]);
  await hold(page, 'up', 150);
  expect((await snap(page)).targetId).toBe('hallway_locker_3');
  // walk through the door
  await walkTo(page, [['x', 184]]);
  await hold(page, 'up', 600);
  await waitForRoom(page, 'classroom');
  let s = await snap(page);
  expect({ room: s.roomId, target: s.targetId, key: s.targetKey, visible: s.indicator.visible }).toEqual({ room: 'classroom', target: null, key: null, visible: false });
  // back in the hallway, then switch world while targeting something
  await walkTo(page, [['y', 152]]);
  await hold(page, 'down', 800);
  await waitForRoom(page, 'hallway');
  await walkTo(page, [['x', 168]]);
  await hold(page, 'up', 150);
  expect((await snap(page)).indicator.visible).toBe(true);
  await page.getByTestId('world-office').click();
  await waitForRoom(page, 'office', 'office');
  s = await snap(page);
  expect({ target: s.targetId, visible: s.indicator.visible }).toEqual({ target: null, visible: false });
  await page.getByTestId('world-school').click();
  await waitForRoom(page, 'hallway', 'school');
  expect((await snap(page)).indicator.visible).toBe(false);
});

test('classroom: plants show nothing; sitting hides the indicator; shelves differ', async ({ page }) => {
  await enterClassroom(page);
  // the plant, pressed right up against it from every reachable side
  await walkTo(page, [
    ['y', 152],
    ['x', 40],
  ]);
  for (const dir of ['left', 'down'] as const) {
    await hold(page, dir, 250);
    const s = await snap(page);
    expect({ dir, target: s.targetId, visible: s.indicator.visible }).toEqual({ dir, target: null, visible: false });
  }
  // two windows share one interactable id: the indicator must sit on the one in front of you
  // (before the fix it always sat on the first window, x=168)
  await walkTo(page, [
    ['y', 72],
    ['x', 232],
    ['y', 40],
  ]);
  await hold(page, 'up', 150);
  let w = await snap(page);
  expect({ target: w.targetId, x: w.indicator.x }).toEqual({ target: 'classroom_window', x: 232 });
  await walkTo(page, [['x', 168]]);
  await hold(page, 'up', 60);
  w = await snap(page);
  expect({ target: w.targetId, x: w.indicator.x }).toEqual({ target: 'classroom_window', x: 168 });
  // sitting: no indicator while seated, back again when standing up in range
  await walkTo(page, [['y', 72]]);
  await walkTo(page, [
    ['x', 120],
    ['y', 104],
  ]);
  await hold(page, 'left', 60);
  await expect.poll(async () => (await snap(page)).targetId).toBe('seat_6_6');
  expect((await snap(page)).indicator.visible).toBe(true);
  await page.keyboard.press('e');
  await expect.poll(async () => (await snap(page)).mode).toBe('seated');
  expect((await snap(page)).indicator.visible).toBe(false);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).targetId).toBe('seat_6_6');
  expect((await snap(page)).indicator.visible).toBe(true);
});

test('each bookshelf has its own content', async ({ page }) => {
  const texts: string[] = [];
  // hallway: returns shelf (tile 20,1) and fiction shelf (tile 1,7)
  await walkTo(page, [
    ['y', 40],
    ['x', 328],
  ]);
  await hold(page, 'up', 150);
  expect((await snap(page)).targetId).toBe('hallway_shelf_returns');
  await openDialogue(page);
  texts.push((await dialogue(page).textContent()) ?? '');
  await page.keyboard.press('Escape');
  await walkTo(page, [
    ['x', 296], // step away from the corner plant (tile 20,4) before going down
    ['y', 120],
    ['x', 40],
  ]);
  await hold(page, 'left', 150);
  expect((await snap(page)).targetId).toBe('hallway_shelf_fiction');
  await openDialogue(page);
  texts.push((await dialogue(page).textContent()) ?? '');
  await page.keyboard.press('Escape');
  // classroom shelf
  await walkTo(page, [
    ['y', 88],
    ['x', 184],
    ['y', 48],
  ]);
  await hold(page, 'up', 600);
  await waitForRoom(page, 'classroom');
  await walkTo(page, [
    ['y', 72],
    ['x', 40],
    ['y', 40],
  ]);
  await hold(page, 'up', 150);
  expect((await snap(page)).targetId).toBe('classroom_bookshelf');
  await openDialogue(page);
  texts.push((await dialogue(page).textContent()) ?? '');
  expect(new Set(texts).size).toBe(3);
});

test('office world: same indicator rules, its own shelf and clock', async ({ page }) => {
  await page.getByTestId('world-office').click();
  await waitForRoom(page, 'office', 'office');
  await walkTo(page, [
    ['y', 72],
    ['x', 120],
    ['y', 40],
    ['x', 200],
  ]);
  await hold(page, 'up', 150);
  const s = await snap(page);
  expect({ target: s.targetId, visible: s.indicator.visible, x: s.indicator.x }).toEqual({ target: 'office_bookshelf', visible: true, x: 200 });
  await openDialogue(page);
  await expect(dialogue(page)).toContainText('Potluck');
  await page.keyboard.press('Escape');
  await sweep(page, 'ArrowLeft', 1200);
});
