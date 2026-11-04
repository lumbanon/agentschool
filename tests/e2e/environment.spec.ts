import { expect, test, type Page } from '@playwright/test';
import { seedCharacter } from './fixtures';
import { enterClassroom, expectTarget, hold, snap, waitForRoom, walkTo } from './helpers';

/*
 * Classroom coordinates (px, feet): entrance (120,152) · clock tile (12,1) · light switch (9,1)
 * window (10,1) · bookshelf (2,1) · teacher's desk (6-7,3) · plant (1,9) · teacher NPC (152,56)
 * seat_6_6: desk (6,5) + chair (6,6), sit point (104,104), reached from the aisle at (120,104).
 */

const at = (iso: string) => new Date(iso);
const NIGHT = at('2026-11-04T13:05:00Z'); // 9:05 PM MYT
const EVENING = at('2026-11-04T11:42:00Z'); // 7:42 PM MYT -> night (after 7:30 PM)
const AFTERNOON = at('2026-11-04T06:30:00Z'); // 2:30 PM MYT

async function startInClassroom(page: Page, time: Date) {
  await seedCharacter(page);
  await page.clock.setFixedTime(time);
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');
  await enterClassroom(page);
}

/** From the entrance to just under the wall at x (row 2), avoiding the teacher and her desk. */
async function toWall(page: Page, x: number) {
  await walkTo(page, [
    ['y', 72],
    ['x', x],
    ['y', 40],
  ]);
  await hold(page, 'up', 250);
}

const dialogue = (page: Page) => page.getByTestId('dialogue-text');

/** Press E until a dialogue opens (E is ignored for 250 ms after a dialogue closes, by design). */
async function openDialogue(page: Page) {
  await expect(async () => {
    if (!(await page.getByTestId('dialogue').isVisible())) await page.keyboard.press('e');
    await expect(page.getByTestId('dialogue')).toBeVisible({ timeout: 400 });
  }).toPass({ timeout: 5_000 });
}

test.describe('wall clock (Malaysia time)', () => {
  test.use({ timezoneId: 'America/New_York' }); // the browser's own zone must not matter

  test('shows the current Malaysia time, labelled MYT, and updates live', async ({ page }) => {
    await startInClassroom(page, EVENING);
    await toWall(page, 200);
    await expectTarget(page, 'classroom_clock');
    await expect(page.getByTestId('interaction-prompt')).toContainText('Check the clock');
    await page.keyboard.press('e');
    await expect(dialogue(page)).toHaveText('Current Malaysia time: 7:42 PM (MYT, UTC+8). It is night.');
    await expect(page.getByTestId('source-badge')).toHaveText('Prototype script — not AI-generated');
    // the time moves on while the dialogue is open
    await page.clock.setFixedTime(at('2026-11-04T11:43:00Z'));
    await expect(dialogue(page)).toContainText('7:43 PM');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await snap(page)).mode).toBe('exploring');
    expect((await snap(page)).props).toContain('clock');
  });
});

test('window view and room lighting follow Malaysia time of day', async ({ page }) => {
  await startInClassroom(page, AFTERNOON);
  expect((await snap(page)).props.filter((p) => p === 'window')).toHaveLength(2);
  expect((await snap(page)).ambienceAlpha).toBe(0); // afternoon: no tint

  await toWall(page, 168);
  await expectTarget(page, 'classroom_window');
  await page.keyboard.press('e');
  await expect(dialogue(page)).toHaveText(/Full daylight/);
  await page.keyboard.press('Escape');

  await page.clock.setFixedTime(NIGHT);
  await expect.poll(async () => (await snap(page)).ambienceAlpha).toBeGreaterThan(0.1);
  await openDialogue(page);
  await expect(dialogue(page)).toHaveText(/dark outside/);
  await page.keyboard.press('Space');
  await expect(dialogue(page)).toContainText('9:05 PM, Malaysia time');
});

test('light switch toggles the classroom lights with a confirmation', async ({ page }) => {
  await startInClassroom(page, NIGHT);
  const lit = (await snap(page)).ambienceAlpha;
  await toWall(page, 168); // the teacher stands below the switch, so come along the top row
  await walkTo(page, [['x', 152]]);
  await hold(page, 'up', 150);
  await expectTarget(page, 'classroom_lightswitch');
  await page.keyboard.press('e');
  await expect(page.getByTestId('toast')).toHaveText('Click! The lights are off.');
  await expect.poll(async () => (await snap(page)).ambienceAlpha).toBeGreaterThan(lit);
  expect((await snap(page)).mode).toBe('exploring'); // no panel, control returns at once
  await page.waitForTimeout(300); // interaction cooldown
  await page.keyboard.press('e');
  await expect(page.getByTestId('toast')).toHaveText('Click! The lights are on.');
  await expect.poll(async () => (await snap(page)).ambienceAlpha).toBe(lit);

  // lights are per room: the hallway is unaffected by the classroom switch
  await page.keyboard.press('e'); // off again
  await walkTo(page, [
    ['x', 168],
    ['y', 72],
    ['x', 120],
    ['y', 152],
  ]);
  await hold(page, 'down', 800);
  await waitForRoom(page, 'hallway');
  expect((await snap(page)).ambienceAlpha).toBe(lit);
});

test('sit at a desk, stay put, then stand with E or Esc', async ({ page }) => {
  await startInClassroom(page, AFTERNOON);
  await walkTo(page, [
    ['y', 72],
    ['x', 120],
    ['y', 104],
  ]);
  await hold(page, 'left', 120);
  await expectTarget(page, 'seat_6_6');
  await expect(page.getByTestId('interaction-prompt')).toContainText('Sit at the desk');
  const standing = await snap(page);

  await page.keyboard.press('e');
  await expect.poll(async () => (await snap(page)).mode).toBe('seated');
  let s = await snap(page);
  expect({ seat: s.seatId, x: s.x, y: s.y, facing: s.facing, texture: s.playerTexture }).toEqual({
    seat: 'seat_6_6',
    x: 104,
    y: 104,
    facing: 'up',
    texture: 'char-student:sit',
  });
  await expect(page.getByTestId('interaction-prompt')).toHaveText(/Stand up/);
  await expect(page.getByTestId('edit-character')).toBeDisabled();

  // movement is disabled while seated
  await hold(page, 'down', 400);
  await hold(page, 'right', 400);
  s = await snap(page);
  expect({ x: s.x, y: s.y, mode: s.mode }).toEqual({ x: 104, y: 104, mode: 'seated' });

  // E stands up where the player came from, and movement works again
  await page.keyboard.press('e');
  await expect.poll(async () => (await snap(page)).mode).toBe('exploring');
  s = await snap(page);
  expect({ x: s.x, y: s.y, texture: s.playerTexture, seat: s.seatId }).toEqual({ x: standing.x, y: standing.y, texture: 'char-student', seat: null });
  // walking works again (back to the aisle centre, then down it)
  await walkTo(page, [['x', 120]]);
  await hold(page, 'down', 300);
  expect((await snap(page)).y).toBeGreaterThan(standing.y + 5);

  // Esc also stands up
  await walkTo(page, [['y', 104]]);
  await hold(page, 'left', 120);
  await expectTarget(page, 'seat_6_6');
  await page.keyboard.press('e');
  await expect.poll(async () => (await snap(page)).mode).toBe('seated');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).mode).toBe('exploring');
});

test('flavour items: bookshelf and teacher desk open short dialogues; the plant is decorative', async ({ page }) => {
  await startInClassroom(page, AFTERNOON);
  // plant (left of the entrance row): pressed right up against it, nothing to interact with
  await walkTo(page, [['x', 40]]);
  await hold(page, 'left', 300);
  const byPlant = await snap(page);
  expect({ target: byPlant.targetId, indicator: byPlant.indicator.visible }).toEqual({ target: null, indicator: false });
  await expect(page.getByTestId('interaction-prompt')).toHaveCount(0);
  await page.keyboard.press('e');
  await expect(page.getByTestId('dialogue')).toHaveCount(0);

  // teacher's desk
  await walkTo(page, [
    ['y', 72],
    ['x', 112],
  ]);
  await hold(page, 'up', 150);
  await expectTarget(page, 'classroom_teacher_desk');
  await page.keyboard.press('e');
  await expect(dialogue(page)).toContainText('exercise books');
  await page.keyboard.press('Escape');

  // bookshelf
  await walkTo(page, [
    ['x', 40],
    ['y', 40],
  ]);
  await hold(page, 'up', 250);
  await expectTarget(page, 'classroom_bookshelf');
  await page.keyboard.press('e');
  await expect(dialogue(page)).toContainText('Kamus Dewan');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).mode).toBe('exploring');
});

test('hallway: lockers and the hallway clock', async ({ page }) => {
  await seedCharacter(page);
  await page.clock.setFixedTime(NIGHT);
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');
  await walkTo(page, [
    ['x', 104],
    ['y', 40],
  ]);
  await hold(page, 'up', 250);
  await expectTarget(page, 'hallway_locker_1');
  await page.keyboard.press('e');
  await expect(dialogue(page)).toContainText('Additional Mathematics homework');
  await page.keyboard.press('Escape');
  await walkTo(page, [['x', 296]]);
  await hold(page, 'up', 200);
  await expectTarget(page, 'hallway_clock');
  await page.keyboard.press('e');
  await expect(dialogue(page)).toHaveText('Current Malaysia time: 9:05 PM (MYT, UTC+8).');
});

test('office world reuses the clock, window views and night lighting', async ({ page }) => {
  await page.clock.setFixedTime(NIGHT);
  await page.goto('/?world=office');
  await waitForRoom(page, 'office', 'office');
  const s = await snap(page);
  expect(s.props.sort()).toEqual(['clock', 'window', 'window', 'window']);
  expect(s.ambienceAlpha).toBeGreaterThan(0.1);
  await walkTo(page, [
    ['y', 72],
    ['x', 120],
    ['y', 40],
    ['x', 136],
  ]);
  await hold(page, 'up', 200);
  await expectTarget(page, 'office_clock');
  await page.keyboard.press('e');
  await expect(dialogue(page)).toHaveText('Current Malaysia time: 9:05 PM (MYT, UTC+8).');
});
