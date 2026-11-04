import { useEffect, useState, type FormEvent } from 'react';
import { MockBadge, SourceBadge } from '../../app/components/SourceBadge';
import { PanelShell } from '../../app/components/PanelShell';
import type { DomainPanelProps } from '../../app/panels';
import type { OpenLessonPayload } from './actions';
import { LESSONS } from './lessons';
import { loadProgress, saveProgress, type LessonProgress } from './progress';
import { RichText, Tex } from './Tex';

/** Light-touch conversion of a typed answer into TeX for the live preview (display only). */
export function answerToTex(text: string): string {
  return text
    .replace(/\\/g, '')
    .replace(/\b(or|atau)\b/gi, '\\text{ or }')
    .replace(/sqrt\(([^)]*)\)/g, '\\sqrt{$1}');
}

export function LessonPanel({ action, onClose }: DomainPanelProps) {
  const payload = (action.payload ?? {}) as Partial<OpenLessonPayload>;
  const lesson = payload.lessonId ? LESSONS[payload.lessonId] : undefined;

  const [progress, setProgress] = useState<LessonProgress>(() => {
    const saved = loadProgress(payload.lessonId ?? '');
    return {
      ...saved,
      phase: payload.startAt ?? saved.phase,
      boardStep: Math.min(saved.boardStep, (lesson?.board.length ?? 1) - 1),
      exerciseIndex: Math.min(saved.exerciseIndex, (lesson?.exercises.length ?? 1) - 1),
    };
  });
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (lesson) saveProgress(lesson.id, progress);
  }, [lesson, progress]);

  if (!lesson) {
    return (
      <PanelShell title="Lesson not found" onClose={onClose} testId="lesson-panel">
        <p>No mock lesson with id “{payload.lessonId ?? '(none)'}”.</p>
      </PanelShell>
    );
  }

  const update = (patch: Partial<LessonProgress>) => setProgress((p) => ({ ...p, ...patch }));
  const exercise = lesson.exercises[Math.min(progress.exerciseIndex, lesson.exercises.length - 1)];
  const recorded = progress.answers[exercise.id];
  const answeredCount = lesson.exercises.filter((e) => progress.answers[e.id]).length;

  const record = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    update({ answers: { ...progress.answers, [exercise.id]: { text, recordedAt: new Date().toISOString() } } });
    setDraft('');
  };

  return (
    <PanelShell
      title={lesson.title}
      subtitle={lesson.subject}
      onClose={onClose}
      testId="lesson-panel"
      badges={
        <>
          <SourceBadge source={lesson.source} />
          <MockBadge>Mock lesson — answers recorded, not graded</MockBadge>
        </>
      }
    >
      <div className="lesson-tabs" role="tablist">
        <button role="tab" aria-selected={progress.phase === 'board'} onClick={() => update({ phase: 'board' })} data-testid="tab-board">
          Blackboard
        </button>
        <button role="tab" aria-selected={progress.phase === 'exercise'} onClick={() => update({ phase: 'exercise' })} data-testid="tab-exercise">
          Exercises ({answeredCount}/{lesson.exercises.length})
        </button>
      </div>

      {progress.phase === 'board' ? (
        <div className="blackboard" data-testid="blackboard">
          <ol className="board-steps">
            {lesson.board.slice(0, progress.boardStep + 1).map((step, i) => (
              <li key={i} className={i === progress.boardStep ? 'board-step current' : 'board-step'} data-testid="board-step">
                <p>
                  <RichText text={step.text} />
                </p>
                {step.math?.map((m) => <Tex key={m} tex={m} block />)}
              </li>
            ))}
          </ol>
          <div className="board-nav">
            <button disabled={progress.boardStep === 0} onClick={() => update({ boardStep: progress.boardStep - 1 })}>
              ← Back
            </button>
            <span>
              Step {progress.boardStep + 1} of {lesson.board.length}
            </span>
            {progress.boardStep < lesson.board.length - 1 ? (
              <button className="primary" onClick={() => update({ boardStep: progress.boardStep + 1 })} data-testid="board-next">
                Next step →
              </button>
            ) : (
              <button className="primary" onClick={() => update({ phase: 'exercise' })} data-testid="start-exercises">
                Try the exercises →
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="exercise" data-testid="exercise">
          <p className="exercise-count">
            Question {progress.exerciseIndex + 1} of {lesson.exercises.length}
          </p>
          <p className="exercise-prompt" data-testid="exercise-prompt">
            <RichText text={exercise.prompt} />
          </p>
          <form onSubmit={record} className="answer-form">
            <label htmlFor="answer-input">Your answer</label>
            <input
              id="answer-input"
              data-testid="answer-input"
              autoComplete="off"
              placeholder={exercise.answerHint}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="primary" disabled={!draft.trim()} data-testid="answer-submit">
              Record answer
            </button>
          </form>
          {draft.trim() && (
            <div className="answer-preview" aria-label="Preview">
              Preview: <Tex tex={answerToTex(draft)} />
            </div>
          )}
          {recorded && (
            <div className="answer-recorded" role="status" data-testid="answer-recorded">
              <strong>Answer recorded:</strong> <Tex tex={answerToTex(recorded.text)} />
              <p className="not-graded">
                Not graded. Phase 0 has no grader. The verified maths checker comes with the learning engine.
              </p>
            </div>
          )}
          <div className="board-nav">
            <button disabled={progress.exerciseIndex === 0} onClick={() => update({ exerciseIndex: progress.exerciseIndex - 1 })}>
              ← Previous
            </button>
            <span>
              {answeredCount}/{lesson.exercises.length} recorded
            </span>
            {progress.exerciseIndex < lesson.exercises.length - 1 ? (
              <button onClick={() => update({ exerciseIndex: progress.exerciseIndex + 1 })} data-testid="exercise-next">
                Next question →
              </button>
            ) : (
              <button className="primary" onClick={onClose} data-testid="lesson-finish">
                Finish & return to class
              </button>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  );
}
