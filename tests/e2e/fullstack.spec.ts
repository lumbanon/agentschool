import { expect, test } from '@playwright/test';
import { seedCharacter } from './fixtures';
import { approachTeacher, enterClassroom, waitForRoom } from './helpers';

/*
 * Full stack: classroom -> Vite proxy -> FastAPI -> PostgreSQL -> SymPy.
 * Opt-in, because it needs the backend running with the pilot lesson approved:
 *
 *   cd backend
 *   docker compose up -d
 *   set AGENTSCHOOL_DATABASE_URL to a database with the pilot lesson imported and approved
 *   agentschool serve          (port 8010; the Vite proxy follows AGENTSCHOOL_API_URL)
 *   AGENTSCHOOL_FULLSTACK=1 npx playwright test fullstack
 *
 * See backend/README.md ("Full-stack check").
 */
test.skip(!process.env.AGENTSCHOOL_FULLSTACK, 'set AGENTSCHOOL_FULLSTACK=1 with the backend running (see file header)');

test('the teacher opens the approved lesson and the real verifier checks answers', async ({ page }) => {
  await seedCharacter(page);
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');
  await enterClassroom(page);
  await approachTeacher(page);
  await page.keyboard.press('e');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: /Start the lesson/ }).click();

  const panel = page.getByTestId('lesson-panel');
  await expect(panel.getByTestId('approved-badge')).toBeVisible();
  await panel.getByTestId('tab-exercise').click();
  await expect(panel.getByTestId('exercise-prompt')).toContainText('Solve');

  const check = async (answer: string) => {
    await panel.getByTestId('answer-input').fill(answer);
    await panel.getByTestId('answer-submit').click();
    await expect(panel.getByTestId('answer-submit')).toHaveText('Check answer');
    return panel.getByTestId('verdict').getAttribute('data-status');
  };
  expect(await check('x = 4 or x = -3')).toBe('incorrect');
  await expect(panel.getByTestId('mistake-feedback')).toContainText('signs');
  expect(await check('x equals four')).toBe('invalid_input');
  expect(await check('x = 3, x = −4')).toBe('correct'); // order and Unicode minus don't matter
  await expect(panel.getByTestId('worked-solution')).toBeVisible();
  await expect(panel.getByTestId('verdict')).toContainText('sympy/');
});
