import { useEffect, useState, type FormEvent } from 'react';
import { PanelShell } from '../../app/components/PanelShell';
import { answerToTex } from './answerTex';
import { clientId, submitAttempt, t, type ApiAttemptResult, type ApiLesson } from './api';
import { loadProgress, saveProgress, type LessonProgress } from './progress';
import { RichText, Tex } from './Tex';

interface Props {
  lesson: ApiLesson;
  startAt?: 'board' | 'exercise';
  onClose: () => void;
}

const STATUS_TEXT: Record<ApiAttemptResult['status'], string> = {
  correct: 'Correct',
  incorrect: 'Not quite',
  invalid_input: 'Could not read that',
  not_verifiable: 'Recorded (not checked automatically)',
};

/** An approved lesson from the curriculum database. Answers are checked by the backend's SymPy verifier. */
export function RemoteLessonPanel({ lesson, startAt, onClose }: Props) {
  const key = `api:${lesson.id}@${lesson.revision}`;
  const [progress, setProgress] = useState<LessonProgress>(() => {
    const saved = loadProgress(key);
    return {
      ...saved,
      phase: startAt ?? saved.phase,
      boardStep: Math.min(saved.boardStep, lesson.board.length - 1),
      exerciseIndex: Math.min(saved.exerciseIndex, Math.max(lesson.exercises.length - 1, 0)),
    };
  });
  const [draft, setDraft] = useState('');
  const [results, setResults] = useState<Record<string, ApiAttemptResult>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => saveProgress(key, progress), [key, progress]);

  const update = (patch: Partial<LessonProgress>) => setProgress((p) => ({ ...p, ...patch }));
  const exercise = lesson.exercises[progress.exerciseIndex];
  const result = exercise ? results[exercise.id] : undefined;
  const solved = lesson.exercises.filter((e) => results[e.id]?.correct).length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!exercise || !text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await submitAttempt(exercise.id, text, clientId());
      setResults((prev) => ({ ...prev, [exercise.id]: r }));
      update({ answers: { ...progress.answers, [exercise.id]: { text, recordedAt: new Date().toISOString() } } });
      if (r.correct) setDraft('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'The checker is unavailable.');
    } finally {
      setSending(false);
    }
  };

  const reviewer = lesson.review.reviewed_by ?? 'a teacher';
  return (
    <PanelShell
      title={t(lesson.title)}
      subtitle={`Additional Mathematics · Form ${lesson.form} · Chapter ${lesson.chapter.number}: ${t(lesson.chapter.title)}`}
      onClose={onClose}
      testId="lesson-panel"
      badges={
        <>
          <span className="badge badge-approved" data-testid="approved-badge" title={`Approved ${lesson.review.reviewed_at ?? ''}`}>
            Approved lesson · reviewed by {reviewer}
          </span>
          {lesson.source.generated_with && (
            <span className="badge badge-mock" data-testid="ai-drafted-badge">
              Drafted with AI assistance ({lesson.source.generated_with}), human-reviewed
            </span>
          )}
          <span className="badge badge-checked" data-testid="checker-badge">
            Answers checked by SymPy (maths engine, not AI)
          </span>
        </>
      }
    >
      <div className="lesson-tabs" role="tablist">
        <button role="tab" aria-selected={progress.phase === 'board'} onClick={() => update({ phase: 'board' })} data-testid="tab-board">
          Blackboard
        </button>
        <button role="tab" aria-selected={progress.phase === 'exercise'} onClick={() => update({ phase: 'exercise' })} data-testid="tab-exercise">
          Exercises ({solved}/{lesson.exercises.length} correct)
        </button>
      </div>

      {progress.phase === 'board' ? (
        <div className="blackboard" data-testid="blackboard">
          <ol className="board-steps">
            {lesson.board.slice(0, progress.boardStep + 1).map((step, i) => (
              <li key={i} className={i === progress.boardStep ? 'board-step current' : 'board-step'} data-testid="board-step">
                <p>
                  <RichText text={t(step.text)} />
                </p>
                {step.math.map((m) => (
                  <Tex key={m} tex={m} block />
                ))}
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
      ) : !exercise ? (
        <p className="muted" data-testid="no-exercises">
          No exercises have been approved for this lesson yet.
        </p>
      ) : (
        <div className="exercise" data-testid="exercise">
          <p className="exercise-count">
            Question {progress.exerciseIndex + 1} of {lesson.exercises.length} · {exercise.marks} mark{exercise.marks === 1 ? '' : 's'}
          </p>
          <p className="exercise-prompt" data-testid="exercise-prompt">
            <RichText text={t(exercise.prompt)} />
          </p>
          <form onSubmit={submit} className="answer-form">
            <label htmlFor="answer-input">Your answer</label>
            {exercise.options ? (
              <div className="segmented" role="radiogroup" aria-label="Options">
                {exercise.options.map((o) => (
                  <button type="button" key={o.id} aria-pressed={draft === o.id} onClick={() => setDraft(o.id)} data-testid={`option-${o.id}`}>
                    {o.id}. <RichText text={t(o.text)} />
                  </button>
                ))}
              </div>
            ) : (
              <input
                id="answer-input"
                data-testid="answer-input"
                autoComplete="off"
                placeholder={t(exercise.answer_format_hint) || 'Type your answer'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={300}
              />
            )}
            <button type="submit" className="primary" disabled={!draft.trim() || sending} data-testid="answer-submit">
              {sending ? 'Checking…' : 'Check answer'}
            </button>
          </form>
          {draft.trim() && !exercise.options && (
            <div className="answer-preview" aria-label="Preview">
              Preview: <Tex tex={answerToTex(draft)} />
            </div>
          )}
          {sendError && (
            <p className="field-error" role="alert" data-testid="attempt-error">
              {sendError}
            </p>
          )}
          {result && (
            <div className={`verdict verdict-${result.status}`} role="status" data-testid="verdict" data-status={result.status}>
              <strong>{STATUS_TEXT[result.status]}.</strong> {result.status !== 'correct' && result.message}
              {result.interpreted && (
                <p className="verdict-read">
                  Read as: <Tex tex={result.interpreted} />
                </p>
              )}
              {result.mistake_feedback && <p data-testid="mistake-feedback"><RichText text={t(result.mistake_feedback)} /></p>}
              {result.worked_solution && (
                <ol className="worked" data-testid="worked-solution">
                  {result.worked_solution.map((s, i) => (
                    <li key={i}>
                      <RichText text={t(s.text)} />
                      {s.math.map((m) => (
                        <Tex key={m} tex={m} block />
                      ))}
                    </li>
                  ))}
                </ol>
              )}
              <p className="muted small">Checked by {result.checked_by.split(' (')[0]} · {result.verifier}</p>
            </div>
          )}
          {exercise.hints.length > 0 && result && !result.correct && (
            <details className="hint">
              <summary>Hint</summary>
              <RichText text={t(exercise.hints[0])} />
            </details>
          )}
          <div className="board-nav">
            <button
              disabled={progress.exerciseIndex === 0}
              onClick={() => {
                setDraft('');
                update({ exerciseIndex: progress.exerciseIndex - 1 });
              }}
            >
              ← Previous
            </button>
            <span>
              {solved}/{lesson.exercises.length} correct
            </span>
            {progress.exerciseIndex < lesson.exercises.length - 1 ? (
              <button
                onClick={() => {
                  setDraft('');
                  update({ exerciseIndex: progress.exerciseIndex + 1 });
                }}
                data-testid="exercise-next"
              >
                Next question →
              </button>
            ) : (
              <button className="primary" onClick={onClose} data-testid="lesson-finish">
                Finish & return to class
              </button>
            )}
          </div>
          {lesson.exercises_withheld > 0 && (
            <p className="muted small" data-testid="withheld-note">
              {lesson.exercises_withheld} more exercise{lesson.exercises_withheld === 1 ? ' is' : 's are'} waiting for teacher review.
            </p>
          )}
        </div>
      )}
    </PanelShell>
  );
}
