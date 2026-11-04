// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogueBox } from '../../src/app/components/DialogueBox';
import { LessonPanel, answerToTex } from '../../src/domains/school/LessonPanel';
import { resetAllProgress } from '../../src/domains/school/progress';
import { TaskPanel } from '../../src/domains/office/TaskPanel';
import { schoolWorld } from '../../src/worlds/school/definition';

afterEach(cleanup);

describe('DialogueBox', () => {
  const dialogue = schoolWorld.actors[0].interaction!.dialogue!;

  it('badges prototype content and advances line by line', () => {
    const onChoice = vi.fn();
    const onClose = vi.fn();
    render(<DialogueBox dialogue={dialogue} onChoice={onChoice} onClose={onClose} />);
    expect(screen.getByTestId('source-badge').textContent).toBe('Prototype script — not AI-generated');
    expect(screen.getByTestId('dialogue-text').textContent).toBe(dialogue.lines[0].text);
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByTestId('dialogue-text').textContent).toBe(dialogue.lines[1].text);
    fireEvent.click(screen.getByTestId('dialogue-next'));
    expect(screen.getAllByTestId('dialogue-choice')).toHaveLength(2);
  });

  it('number keys pick a choice; held-key repeats are ignored', () => {
    const onChoice = vi.fn();
    render(<DialogueBox dialogue={dialogue} onChoice={onChoice} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'e', repeat: true });
    expect(screen.getByTestId('dialogue-text').textContent).toBe(dialogue.lines[0].text);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: '1' });
    expect(onChoice).toHaveBeenCalledWith(dialogue.lines[2].choices![0]);
  });

  it('Escape closes', () => {
    const onClose = vi.fn();
    render(<DialogueBox dialogue={dialogue} onChoice={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('LessonPanel (mock)', () => {
  const action = { kind: 'school.openLesson', payload: { lessonId: 's3-factorisation' } };
  beforeEach(() => resetAllProgress());

  it('labels the lesson as a prototype that is not graded and renders KaTeX', () => {
    const { container } = render(<LessonPanel action={action} onClose={vi.fn()} />);
    expect(screen.getByTestId('source-badge').textContent).toContain('not AI-generated');
    expect(screen.getByTestId('mock-badge').textContent).toContain('not graded');
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('records an answer without grading it, and resumes after reopening', () => {
    const first = render(<LessonPanel action={{ ...action, payload: { ...action.payload, startAt: 'exercise' } }} onClose={vi.fn()} />);
    const input = screen.getByTestId('answer-input');
    fireEvent.change(input, { target: { value: 'x = -4 or x = 3' } });
    act(() => {
      fireEvent.click(screen.getByTestId('answer-submit'));
    });
    const recorded = screen.getByTestId('answer-recorded');
    expect(recorded.textContent).toContain('Not graded');
    expect(recorded.textContent).not.toMatch(/correct|incorrect|wrong/i);
    first.unmount();

    render(<LessonPanel action={action} onClose={vi.fn()} />);
    expect(screen.getByTestId('exercise')).toBeTruthy();
    expect(screen.getByTestId('answer-recorded')).toBeTruthy();
  });

  it('handles an unknown lesson id without crashing', () => {
    render(<LessonPanel action={{ kind: 'school.openLesson', payload: { lessonId: 'nope' } }} onClose={vi.fn()} />);
    expect(screen.getByText(/Lesson not found/)).toBeTruthy();
  });

  it.each([null, [], { phase: 'exercise', boardStep: -1, exerciseIndex: 0, answers: {} }])(
    'recovers from malformed saved progress: %j', (saved) => {
      sessionStorage.setItem('agentschool.phase0.lessonProgress', JSON.stringify(
        saved === null || Array.isArray(saved) ? saved : { 's3-factorisation': saved },
      ));
      render(<LessonPanel action={action} onClose={vi.fn()} />);
      expect(screen.getByTestId('blackboard')).toBeTruthy();
      expect(screen.getAllByTestId('board-step')).toHaveLength(1);
    },
  );

  it('clamps saved positions and discards malformed answers when a lesson changes', () => {
    sessionStorage.setItem('agentschool.phase0.lessonProgress', JSON.stringify({
      's3-factorisation': { phase: 'exercise', boardStep: 999, exerciseIndex: 999, answers: { stale: null } },
    }));
    render(<LessonPanel action={action} onClose={vi.fn()} />);
    expect(screen.getByText('Question 3 of 3')).toBeTruthy();
    expect(screen.queryByTestId('answer-recorded')).toBeNull();
    fireEvent.click(screen.getByTestId('tab-board'));
    expect(screen.getAllByTestId('board-step')).toHaveLength(5);
  });

  it('converts typed answers to TeX for preview only', () => {
    expect(answerToTex('x = 2 or x = 3')).toBe('x = 2 \\text{ or } x = 3');
    expect(answerToTex('x = sqrt(5)')).toBe('x = \\sqrt{5}');
  });
});

describe('TaskPanel (mock)', () => {
  it('is labelled as a mock and ticks steps', () => {
    render(<TaskPanel action={{ kind: 'office.openTask', payload: { taskId: 'weekly-supplier-report' } }} onClose={vi.fn()} />);
    expect(screen.getByTestId('mock-badge').textContent).toContain('no AI employee');
    fireEvent.click(screen.getAllByTestId('task-step')[0]);
    expect(screen.getByText(/1\/3 steps ticked/)).toBeTruthy();
  });
});
