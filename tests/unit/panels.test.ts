import katex from 'katex';
import { describe, expect, it } from 'vitest';
import type { ActionDescriptor, DialogueScript, WorldDefinition } from '../../src/engine/core/types';
import { DOMAIN_PANELS } from '../../src/domains';
import { LESSONS } from '../../src/domains/school/lessons';
import { WORLDS } from '../../src/worlds/registry';
import { SCHOOL_ACTIONS } from '../../src/domains/school/actions';
import { BACKEND_LESSONS } from '../../src/domains/school/LessonPanel';
import { ENVIRONMENT_ACTIONS } from '../../src/environment/actions';

/** Actions handled as effects (no panel) by the environment layer (see useEnvironment). */
const EFFECT_KINDS: string[] = Object.values(ENVIRONMENT_ACTIONS);

function actionsOf(def: WorldDefinition): ActionDescriptor[] {
  const out: ActionDescriptor[] = [];
  const fromDialogue = (d?: DialogueScript) => d?.lines.forEach((l) => l.choices?.forEach((c) => c.action && out.push(c.action)));
  for (const a of def.actors) {
    if (a.interaction?.action) out.push(a.interaction.action);
    fromDialogue(a.interaction?.dialogue);
  }
  for (const i of def.interactables) {
    if (i.interaction.action) out.push(i.interaction.action);
    fromDialogue(i.interaction.dialogue);
  }
  return out;
}

describe('domain panel registry', () => {
  for (const def of Object.values(WORLDS)) {
    it(`${def.id}: every action a world can request has a React panel`, () => {
      const kinds = actionsOf(def).map((a) => a.kind);
      expect(kinds.length).toBeGreaterThan(0);
      for (const kind of kinds) expect({ kind, registered: kind in DOMAIN_PANELS || EFFECT_KINDS.includes(kind) }).toEqual({ kind, registered: true });
    });
  }

  it('every lesson the school world opens has a labelled offline version (directly or as a backend fallback)', () => {
    for (const a of actionsOf(WORLDS.school).filter((x) => x.kind === SCHOOL_ACTIONS.openLesson)) {
      const id = String(a.payload?.lessonId);
      const lesson = LESSONS[BACKEND_LESSONS[id] ?? id];
      expect(lesson).toBeDefined();
      expect(lesson.source).toBe('prototype_script');
      expect(lesson.board.length).toBeGreaterThan(0);
      expect(lesson.exercises.length).toBeGreaterThan(0);
    }
  });

  it('all lesson maths is valid TeX (no swallowed escapes such as \\t in \\times)', () => {
    const texOf = (s: string) => [...s.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]);
    for (const lesson of Object.values(LESSONS)) {
      const all = [
        ...lesson.board.flatMap((b) => [...texOf(b.text), ...(b.math ?? [])]),
        ...lesson.exercises.flatMap((e) => texOf(e.prompt)),
      ];
      expect(all.length).toBeGreaterThan(5);
      for (const tex of all) {
        // eslint-disable-next-line no-control-regex
        expect({ tex, control: /[\u0000-\u001f]/.test(tex) }).toEqual({ tex, control: false });
        // A TeX command name appearing without its backslash means the escape was lost.
        expect({ tex, bare: /(?<!\\)\b(qquad|quad|times|neq|text|checkmark|frac|sqrt)\b/.test(tex) }).toEqual({ tex, bare: false });
        expect(() => katex.renderToString(tex, { throwOnError: true, strict: 'error' })).not.toThrow();
      }
    }
  });

  it('action kinds are namespaced by domain', () => {
    for (const kind of Object.keys(DOMAIN_PANELS)) expect(kind).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
  });
});
