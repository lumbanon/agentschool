import { expect, test, type Page, type Route } from '@playwright/test';
import { seedCharacter } from './fixtures';
import { approachTeacher, enterClassroom, waitForRoom } from './helpers';

/*
 * The classroom lesson from the backend, with the API mocked at the network level
 * (deterministic UI test). Real verification end to end: fullstack.spec.ts.
 */

const LESSON = {
  id: 'addmath-f4-c02-l01',
  revision: 1,
  subject: 'addmath',
  form: 4,
  chapter_id: 'addmath-f4-c02',
  title: { en: 'Solving quadratic equations by factorisation' },
  summary: null,
  estimated_minutes: 20,
  chapter: { id: 'addmath-f4-c02', form: 4, number: 2, title: { en: 'Quadratic Functions' }, content_standards: [] },
  learning_standards: [],
  objectives: [{ en: 'Factorise.' }],
  board: [
    { text: { en: 'General form' }, math: ['ax^2 + bx + c = 0'] },
    { text: { en: 'Factorise and solve.' }, math: ['(x-2)(x-3)=0'] },
  ],
  exercises: [
    {
      id: 'addmath-f4-c02-e001',
      revision: 1,
      prompt: { en: 'Solve $x^2 + x - 12 = 0$.' },
      answer_format_hint: { en: 'e.g. x = 1 or x = 2' },
      marks: 2,
      difficulty: 'easy',
      answer_type: 'solution_set',
      options: null,
      hints: [{ en: 'Find two numbers that multiply to $-12$ and add to $1$.' }],
      review: { status: 'approved', reviewed_by: 'Cikgu Example', reviewed_at: '2026-11-05T09:00:00Z' },
    },
  ],
  exercises_withheld: 4,
  source: { kind: 'original', author: 'AgentSchool', citation: null, generated_with: 'claude-code' },
  review: { status: 'approved', reviewed_by: 'Cikgu Example', reviewed_at: '2026-11-05T09:00:00Z' },
};

const verdict = (correct: boolean) => ({
  attempt_id: 1,
  exercise_id: 'addmath-f4-c02-e001',
  status: correct ? 'correct' : 'incorrect',
  correct,
  message: correct ? 'Correct.' : 'Not quite.',
  interpreted: correct ? 'x = -4 \\text{ or } x = 3' : 'x = 4 \\text{ or } x = -3',
  mistake_feedback: correct ? null : { en: 'Check the signs.' },
  worked_solution: correct ? [{ text: { en: 'Factorise.' }, math: ['(x+4)(x-3)=0'] }] : null,
  verifier: 'agentschool-verifier/1.0 sympy/1.14.0',
  checked_by: 'SymPy (deterministic mathematics check; no AI)',
});

async function openLesson(page: Page) {
  await enterClassroom(page);
  await approachTeacher(page);
  await page.keyboard.press('e');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: /Start the lesson/ }).click();
}

test.beforeEach(async ({ page }) => {
  await seedCharacter(page);
});

test('an approved lesson from the backend, with answers checked by the server', async ({ page }) => {
  const posted: unknown[] = [];
  await page.route('**/api/v1/lessons/addmath-f4-c02-l01', (r: Route) => r.fulfill({ json: LESSON }));
  await page.route('**/api/v1/exercises/addmath-f4-c02-e001/attempts', async (r: Route) => {
    const body = r.request().postDataJSON();
    posted.push(body);
    await r.fulfill({ json: verdict(body.answer === 'x = -4 or x = 3') });
  });
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');
  await openLesson(page);

  const panel = page.getByTestId('lesson-panel');
  await expect(panel.getByTestId('approved-badge')).toHaveText('Approved lesson · reviewed by Cikgu Example');
  await expect(panel.getByTestId('ai-drafted-badge')).toContainText('human-reviewed');
  await expect(panel.getByTestId('checker-badge')).toContainText('SymPy');
  await expect(panel.getByTestId('lesson-fallback-notice')).toHaveCount(0);
  await expect(panel.locator('.katex').first()).toBeVisible();

  await panel.getByTestId('board-next').click();
  await panel.getByTestId('start-exercises').click();
  await expect(panel.getByTestId('withheld-note')).toContainText('4 more exercises are waiting for teacher review');

  await panel.getByTestId('answer-input').fill('x = 4 or x = -3');
  await panel.getByTestId('answer-submit').click();
  await expect(panel.getByTestId('verdict')).toHaveAttribute('data-status', 'incorrect');
  await expect(panel.getByTestId('mistake-feedback')).toHaveText('Check the signs.');
  await expect(panel.locator('details.hint')).toBeVisible();

  await panel.getByTestId('answer-input').fill('x = -4 or x = 3');
  await panel.getByTestId('answer-submit').click();
  await expect(panel.getByTestId('verdict')).toHaveAttribute('data-status', 'correct');
  await expect(panel.getByTestId('worked-solution')).toBeVisible();
  await expect(panel.getByTestId('tab-exercise')).toContainText('1/1 correct');

  expect(posted).toHaveLength(2);
  expect((posted[0] as { client_id: string }).client_id).toMatch(/^[A-Za-z0-9_-]+$/);
});

test('a lesson still waiting for review falls back to the labelled offline version', async ({ page }) => {
  await page.route('**/api/v1/lessons/**', (r: Route) => r.fulfill({ status: 404, json: { detail: 'lesson not found or not approved' } }));
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');
  await openLesson(page);
  const panel = page.getByTestId('lesson-panel');
  await expect(panel.getByTestId('lesson-fallback-notice')).toContainText('waiting for teacher review');
  await expect(panel.getByTestId('mock-badge')).toContainText('not graded');
  await expect(panel.getByTestId('approved-badge')).toHaveCount(0);
});

test('the checker being down is reported, not shown as a wrong answer', async ({ page }) => {
  await page.route('**/api/v1/lessons/addmath-f4-c02-l01', (r: Route) => r.fulfill({ json: LESSON }));
  await page.route('**/api/v1/exercises/**', (r: Route) => r.fulfill({ status: 503, body: 'down' }));
  await page.goto('/');
  await waitForRoom(page, 'hallway', 'school');
  await openLesson(page);
  const panel = page.getByTestId('lesson-panel');
  await panel.getByTestId('tab-exercise').click();
  await panel.getByTestId('answer-input').fill('x = 3');
  await panel.getByTestId('answer-submit').click();
  await expect(panel.getByTestId('attempt-error')).toContainText('unavailable');
  await expect(panel.getByTestId('verdict')).toHaveCount(0);
});
