import type { WorldDefinition } from '../../engine/core/types';
import { SCHOOL_ACTIONS } from '../../domains/school/actions';

/**
 * School World (primary). Pure data: maps, placements and interaction wiring.
 * Dialogue here is a PROTOTYPE SCRIPT — it is labelled as such in the UI and is
 * not model-generated.
 */
export const schoolWorld: WorldDefinition = {
  id: 'school',
  displayName: 'AgentSchool — SMK Prototype',
  tileset: { key: 'agentworld-tiles', url: 'assets/tiles.png', tiledName: 'agentworld' },
  indicator: { key: 'indicator', url: 'assets/ui/indicator.png' },
  rooms: [
    { id: 'hallway', displayName: 'Hallway', mapUrl: 'maps/school/hallway.json' },
    { id: 'classroom', displayName: 'Classroom 4 Sains', mapUrl: 'maps/school/classroom.json' },
  ],
  start: { roomId: 'hallway', spawn: 'start' },
  player: { displayName: 'You (student)', sprite: { key: 'char-student', url: 'assets/characters/student.png' } },
  actors: [
    {
      id: 'teacher_aisyah',
      displayName: 'Cikgu Aisyah',
      roleLabel: 'Add Maths Teacher',
      sprite: { key: 'char-teacher', url: 'assets/characters/teacher.png' },
      roomId: 'classroom',
      behavior: { kind: 'idle', facing: 'down' },
      interaction: {
        prompt: 'Talk to Cikgu Aisyah',
        dialogue: {
          speaker: 'Cikgu Aisyah',
          source: 'prototype_script',
          lines: [
            { text: 'Selamat pagi! Ready for some Additional Mathematics?' },
            { text: "Today's topic is solving quadratic equations by factorisation." },
            {
              text: 'Shall we start the lesson?',
              choices: [
                { label: 'Start the lesson', action: { kind: SCHOOL_ACTIONS.openLesson, payload: { lessonId: 's3-factorisation' } } },
                { label: 'Maybe later', closes: true },
              ],
            },
          ],
        },
      },
    },
  ],
  interactables: [
    {
      id: 'classroom_blackboard',
      roomId: 'classroom',
      interaction: {
        prompt: 'Read the blackboard',
        action: { kind: SCHOOL_ACTIONS.openLesson, payload: { lessonId: 's3-factorisation', startAt: 'board' } },
      },
    },
    {
      id: 'hallway_noticeboard',
      roomId: 'hallway',
      interaction: {
        prompt: 'Read the noticeboard',
        dialogue: {
          speaker: 'Noticeboard',
          source: 'prototype_script',
          lines: [
            { text: 'FORM 4 ADD MATHS — Chapter: Quadratic Functions & Equations.' },
            { text: 'Cikgu Aisyah is in Classroom 4 Sains (door ahead).' },
          ],
        },
      },
    },
  ],
};
