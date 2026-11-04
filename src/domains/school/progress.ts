/**
 * Local, in-browser lesson progress (Phase 0 mock — no backend).
 * Lets a student close the lesson, walk around, and resume where they were.
 * Stored in sessionStorage when available; falls back to memory.
 */
export interface RecordedAnswer {
  text: string;
  recordedAt: string;
}

export interface LessonProgress {
  phase: 'board' | 'exercise';
  boardStep: number;
  exerciseIndex: number;
  answers: Record<string, RecordedAnswer>;
}

const KEY = 'agentschool.phase0.lessonProgress';
const memory = new Map<string, LessonProgress>();

export const freshProgress = (): LessonProgress => ({ phase: 'board', boardStep: 0, exerciseIndex: 0, answers: {} });

function readAll(): Record<string, LessonProgress> {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, LessonProgress> : {};
  } catch {
    return Object.fromEntries(memory);
  }
}

export function loadProgress(lessonId: string): LessonProgress {
  const saved = readAll()[lessonId] ?? memory.get(lessonId);
  if (!saved || (saved.phase !== 'board' && saved.phase !== 'exercise') ||
    !Number.isSafeInteger(saved.boardStep) || saved.boardStep < 0 ||
    !Number.isSafeInteger(saved.exerciseIndex) || saved.exerciseIndex < 0 ||
    !saved.answers || typeof saved.answers !== 'object' || Array.isArray(saved.answers)) return freshProgress();
  const answers = Object.fromEntries(Object.entries(saved.answers).filter(([, answer]) =>
    answer && typeof answer.text === 'string' && typeof answer.recordedAt === 'string'));
  return { ...saved, answers };
}

export function saveProgress(lessonId: string, progress: LessonProgress): void {
  memory.set(lessonId, progress);
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...readAll(), [lessonId]: progress }));
  } catch {
    /* storage unavailable: memory copy is enough for this session */
  }
}

export function resetAllProgress(): void {
  memory.clear();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
