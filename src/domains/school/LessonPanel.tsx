import { useEffect, useState, type FormEvent } from 'react';
import { MockBadge, SourceBadge } from '../../app/components/SourceBadge';
import { PanelShell } from '../../app/components/PanelShell';
import type { DomainPanelProps } from '../../app/panels';
import type { OpenLessonPayload } from './actions';
import { answerToTex } from './answerTex';
import { fetchLesson, type LessonLoad } from './api';
import { LESSONS } from './lessons';
import { loadProgress, saveProgress, type LessonProgress } from './progress';
import { RemoteLessonPanel } from './RemoteLessonPanel';
import { RichText, Tex } from './Tex';

export { answerToTex };

/**
 * Lessons served by the backend, with the offline mock used when the backend
 * is unreachable or the lesson is not approved yet. Ids not listed here are
 * Phase 0 mock lessons only.
 */
export const BACKEND_LESSONS: Readonly<Record<string, string>> = {
  'addmath-f4-c02-l01': 's3-factorisation',
};

const FALLBACK_NOTICE: Record<Exclude<LessonLoad['kind'], 'ok'>, string> = {
  not_available: 'This lesson is waiting for teacher review, so the offline practice version is shown. Answers are not checked.',
  offline: 'The lesson server is not reachable, so the offline practice version is shown. Answers are not checked.',
};

export function LessonPanel(props: DomainPanelProps) {
  const payload = (props.action.payload ?? {}) as Partial<OpenLessonPayload>;
  if (!payload.lessonId || !(payload.lessonId in BACKEND_LESSONS)) return <MockLessonPanel {...props} />;
  return <BackendLesson {...props} lessonId={payload.lessonId} startAt={payload.startAt} />;
}

function BackendLesson({ action, onClose, lessonId, startAt }: DomainPanelProps & { lessonId: string; startAt?: 'board' | 'exercise' }) {
  const [load, setLoad] = useState<LessonLoad | null>(null);
  useEffect(() => {
    let live = true;
    void fetchLesson(lessonId).then((r) => live && setLoad(r));
    return () => {
      live = false;
    };
  }, [lessonId]);
  if (!load) {
    return (
      <PanelShell title="Loading lesson…" onClose={onClose} testId="lesson-loading">
        <p className="muted">Fetching the lesson from the curriculum server…</p>
      </PanelShell>
    );
  }
  if (load.kind === 'ok') return <RemoteLessonPanel lesson={load.lesson} startAt={startAt} onClose={onClose} />;
  const mockAction = { ...action, payload: { ...action.payload, lessonId: BACKEND_LESSONS[lessonId] } };
  return <MockLessonPanel action={mockAction} onClose={onClose} notice={FALLBACK_NOTICE[load.kind]} />;
}

export function MockLessonPanel({ action, onClose, notice }: DomainPanelProps & { notice?: string }) {
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
      {notice && (
        <p className="lesson-notice" role="note" data-testid="lesson-fallback-notice">
          {notice}
        </p>
      )}
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
