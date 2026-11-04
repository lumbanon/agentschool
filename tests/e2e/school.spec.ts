import { expect, test } from '@playwright/test';
import { seedCharacter } from './fixtures';
import { approachTeacher, enterClassroom, expectTarget, hold, snap, waitForRoom, walkTo } from './helpers';

/*
 * Map coordinates (px, feet positions). Tiles are 16px; tile (c, r) centre = (c*16+8, r*16+8).
 *   hallway   start (72,88) · classroom door tile (11,1) · noticeboard tile (3,1)
 *   classroom arrive (120,152) · teacher (152,56) · blackboard tiles (4..8, 1)
 */

test.beforeEach(async ({ page }) => {
  // Returning player: a saved character skips the creator (see character.spec.ts for first-time players).
  await seedCharacter(page);
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await waitForRoom(page, 'hallway', 'school');
});

test('shows the school world with clear mock labelling', async ({ page }) => {
  await expect(page.getByTestId('room-name')).toHaveText('Hallway');
  await expect(page.getByTestId('mock-notice')).toContainText('mock content');
  await expect(page.getByTestId('world-school')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('canvas')).toBeVisible();
});

test('player walks with the keyboard and collides with walls', async ({ page }) => {
  const start = await snap(page);
  await hold(page, 'right', 400);
  const moved = await snap(page);
  expect(moved.x).toBeGreaterThan(start.x + 10);
  expect(moved.facing).toBe('right');

  // The hallway's back wall ends at y=32; the feet body is 6px tall, so feet stop at ~35.
  await hold(page, 'up', 1500);
  const blocked = await snap(page);
  expect(blocked.y).toBeGreaterThanOrEqual(32);
  expect(blocked.y).toBeLessThan(40);
  expect(blocked.roomId).toBe('hallway');

  // Outer wall on the left (tile column 0 collides).
  await hold(page, 'left', 2500);
  expect((await snap(page)).x).toBeGreaterThanOrEqual(16);
});

test('noticeboard shows prototype dialogue and closes', async ({ page }) => {
  await walkTo(page, [
    ['y', 40],
    ['x', 56],
  ]);
  await hold(page, 'up', 300);
  await expectTarget(page, 'hallway_noticeboard');
  await expect(page.getByTestId('interaction-prompt')).toContainText('Read the noticeboard');
  await page.keyboard.press('e');
  await expect(page.getByTestId('dialogue')).toBeVisible();
  await expect(page.getByTestId('source-badge')).toHaveText('Prototype script — not AI-generated');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('dialogue-text')).toContainText('Classroom 4 Sains');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('dialogue')).toBeHidden();
  await expect.poll(async () => (await snap(page)).mode).toBe('exploring');
});

test('full flow: door, teacher, mock lesson with KaTeX, answer, close, resume', async ({ page }) => {
  await enterClassroom(page);
  await expect(page.getByTestId('room-name')).toHaveText('Classroom 4 Sains');
  const arrived = await snap(page);
  expect(arrived.facing).toBe('up');
  expect(Math.abs(arrived.x - 120)).toBeLessThan(2);

  await approachTeacher(page);
  await expect(page.getByTestId('interaction-prompt')).toContainText('Talk to Cikgu Aisyah');

  // Movement pauses during the interaction.
  await page.keyboard.press('e');
  await expect(page.getByTestId('dialogue-speaker')).toHaveText('Cikgu Aisyah');
  await expect(page.getByTestId('source-badge')).toHaveText('Prototype script — not AI-generated');
  const frozen = await snap(page);
  await hold(page, 'left', 300);
  expect((await snap(page)).x).toBe(frozen.x);
  expect((await snap(page)).mode).toBe('interacting');

  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: /Start the lesson/ }).click();

  // Lesson panel with blackboard maths rendered by KaTeX.
  const panel = page.getByTestId('lesson-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Solving quadratic equations by factorisation');
  await expect(panel.getByTestId('mock-badge')).toContainText('not graded');
  await expect(panel.locator('.katex').first()).toBeVisible();
  for (let i = 0; i < 4; i++) await panel.getByTestId('board-next').click();
  await expect(panel.getByTestId('board-step')).toHaveCount(5);
  await panel.getByTestId('start-exercises').click();

  // Typing WASD / E / Space into the answer field must not move the player or re-trigger interactions.
  await expect(panel.getByTestId('exercise-prompt')).toContainText('Solve');
  const input = panel.getByTestId('answer-input');
  const beforeTyping = await snap(page);
  await input.pressSequentially('x = -4 or x = 3 wasd e');
  await expect(input).toHaveValue('x = -4 or x = 3 wasd e');
  expect((await snap(page)).x).toBe(beforeTyping.x);
  await input.fill('x = -4 or x = 3');
  await panel.getByTestId('answer-submit').click();
  await expect(panel.getByTestId('answer-recorded')).toContainText('Not graded');
  await expect(panel.getByTestId('tab-exercise')).toContainText('1/3');

  // Close: control returns to the world and the player can move again.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await snap(page)).mode).toBe('exploring');
  const before = await snap(page);
  await hold(page, 'left', 300);
  expect((await snap(page)).x).toBeLessThan(before.x - 5);

  // Resume: talking again reopens the lesson where we left it, with the answer still recorded.
  await walkTo(page, [['x', 152]]);
  await hold(page, 'up', 250);
  await expectTarget(page, 'teacher_aisyah');
  await page.keyboard.press('e');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.keyboard.press('1');
  await expect(panel.getByTestId('exercise')).toBeVisible();
  await expect(panel.getByTestId('answer-recorded')).toContainText('Answer recorded');
  await panel.getByTestId('panel-close').click();
  await expect.poll(async () => (await snap(page)).mode).toBe('exploring');
});

test('"Maybe later" closes the teacher dialogue without opening a lesson', async ({ page }) => {
  await enterClassroom(page);
  await approachTeacher(page);
  await page.keyboard.press('e');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: /Maybe later/ }).click();
  await expect(page.getByTestId('dialogue')).toBeHidden();
  await expect(page.getByTestId('lesson-panel')).toHaveCount(0);
  await expect.poll(async () => (await snap(page)).mode).toBe('exploring');
});

test('blackboard opens the lesson on the board; classroom door returns to the hallway', async ({ page }) => {
  await enterClassroom(page);
  await walkTo(page, [
    ['y', 72],
    ['x', 88],
    ['y', 40],
  ]);
  await hold(page, 'up', 300);
  await expectTarget(page, 'classroom_blackboard');
  await page.keyboard.press('e');
  await expect(page.getByTestId('blackboard')).toBeVisible();
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).mode).toBe('exploring');

  // Back out through the bottom door (step down past the teacher's desk first: it collides).
  await walkTo(page, [
    ['y', 72],
    ['x', 120],
    ['y', 152],
  ]);
  await hold(page, 'down', 800);
  await waitForRoom(page, 'hallway');
  const s = await snap(page);
  expect(s.facing).toBe('down');
  expect(Math.abs(s.x - 184)).toBeLessThan(2);
});
