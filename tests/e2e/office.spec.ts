import { expect, test } from '@playwright/test';
import { expectTarget, hold, snap, waitForRoom, walkTo } from './helpers';

test('environment selector switches to the office and back on the same engine', async ({ page }) => {
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');

  await page.getByTestId('world-office').click();
  await waitForRoom(page, 'office', 'office');
  await expect(page).toHaveURL(/world=office/);
  await expect(page.getByTestId('room-name')).toHaveText('Open Office');
  await expect(page.locator('canvas')).toHaveCount(1);

  // Same movement + collision + interaction code: walk to the desk and use the computer.
  await walkTo(page, [
    ['y', 72],
    ['x', 56],
  ]);
  await hold(page, 'up', 300);
  await expectTarget(page, 'office_computer');
  await page.keyboard.press('e');
  const panel = page.getByTestId('task-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('mock-badge')).toContainText('no AI employee');
  await panel.getByTestId('task-step').first().check();
  await expect(panel).toContainText('1/3 steps ticked');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).mode).toBe('exploring');

  await page.getByTestId('world-school').click();
  await waitForRoom(page, 'hallway', 'school');
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('office world loads directly from the URL', async ({ page }) => {
  await page.goto('/?world=office');
  await waitForRoom(page, 'office', 'office');
  await expect(page.getByTestId('world-office')).toHaveAttribute('aria-pressed', 'true');
});
