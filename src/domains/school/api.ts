/**
 * Client for the AgentSchool backend (backend/, FastAPI). Lessons come from the
 * curriculum database and answers are checked there by SymPy. Only lessons a
 * named human reviewer has approved are ever returned.
 */

export type Localized = { en?: string; ms?: string };

export interface ApiBoardStep {
  text: Localized;
  math: string[];
}

export interface ApiExercise {
  id: string;
  revision: number;
  prompt: Localized;
  answer_format_hint: Localized | null;
  marks: number;
  difficulty: string;
  answer_type: string;
  options: { id: string; text: Localized }[] | null;
  hints: Localized[];
}

export interface ApiLesson {
  id: string;
  revision: number;
  subject: string;
  form: number;
  title: Localized;
  summary: Localized | null;
  estimated_minutes: number | null;
  chapter: { id: string; number: number; title: Localized };
  learning_standards: { id: string; code: string; description: Localized }[];
  objectives: Localized[];
  board: ApiBoardStep[];
  exercises: ApiExercise[];
  exercises_withheld: number;
  source: { kind: string; author: string | null; citation: string | null; generated_with: string | null };
  review: { status: string; reviewed_by: string | null; reviewed_at: string | null };
}

export interface ApiAttemptResult {
  attempt_id: number;
  exercise_id: string;
  status: 'correct' | 'incorrect' | 'invalid_input' | 'not_verifiable';
  correct: boolean | null;
  message: string;
  interpreted: string | null;
  mistake_feedback: Localized | null;
  worked_solution: ApiBoardStep[] | null;
  verifier: string;
  checked_by: string;
}

export type LessonLoad =
  | { kind: 'ok'; lesson: ApiLesson }
  | { kind: 'not_available' } // 404: missing or not approved yet
  | { kind: 'offline'; reason: string }; // backend not reachable

// Typed loosely so this module also compiles in the test tsconfig (no Vite client types there).
const BASE = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE ?? '/api';
const TIMEOUT_MS = 6000;

async function request(path: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLesson(id: string): Promise<LessonLoad> {
  try {
    const r = await request(`/v1/lessons/${encodeURIComponent(id)}`);
    if (r.status === 404) return { kind: 'not_available' };
    if (!r.ok) return { kind: 'offline', reason: `backend answered ${r.status}` };
    return { kind: 'ok', lesson: (await r.json()) as ApiLesson };
  } catch (err) {
    return { kind: 'offline', reason: err instanceof Error ? err.message : 'network error' };
  }
}

export async function submitAttempt(exerciseId: string, answer: string, clientId: string): Promise<ApiAttemptResult> {
  const r = await request(`/v1/exercises/${encodeURIComponent(exerciseId)}/attempts`, {
    method: 'POST',
    body: JSON.stringify({ answer, client_id: clientId }),
  });
  if (!r.ok) throw new Error(r.status === 422 ? 'That answer could not be sent (too long or empty).' : `The checker is unavailable (${r.status}).`);
  return (await r.json()) as ApiAttemptResult;
}

/** Anonymous per-browser id so attempts can be grouped (no accounts in Phase 1). */
export function clientId(): string {
  const KEY = 'agentschool.clientId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `c${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

export const t = (text: Localized | null | undefined): string => text?.en ?? text?.ms ?? '';
