import type { WorldDefinition } from '../../engine/core/types';
import { SCHOOL_ACTIONS } from '../../domains/school/actions';
import { ENVIRONMENT_ACTIONS } from '../../environment/actions';
import { HALLWAY_LOCKERS, HALLWAY_SHELVES } from './hallwayItems';

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
            { text: 'Selamat pagi, {playerName}! Welcome to class. Ready for some Additional Mathematics?' },
            { text: "Today's topic is solving quadratic equations by factorisation." },
            {
              text: 'Shall we start the lesson?',
              choices: [
                { label: 'Start the lesson', action: { kind: SCHOOL_ACTIONS.openLesson, payload: { lessonId: 'addmath-f4-c02-l01' } } },
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
        action: { kind: SCHOOL_ACTIONS.openLesson, payload: { lessonId: 'addmath-f4-c02-l01', startAt: 'board' } },
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
    // ---------------------------------------------------------------- environment & flavour (prototype script)
    {
      id: 'classroom_clock',
      roomId: 'classroom',
      interaction: {
        prompt: 'Check the clock',
        dialogue: { speaker: 'Wall clock', source: 'prototype_script', lines: [{ text: 'Current Malaysia time: {malaysiaTime} (MYT, UTC+8). It is {timeOfDay}.' }] },
      },
    },
    {
      id: 'classroom_window',
      roomId: 'classroom',
      interaction: {
        prompt: 'Look out of the window',
        dialogue: {
          speaker: 'Window',
          source: 'prototype_script',
          lines: [{ text: '{windowView}' }, { text: 'The school field stretches out below. It is {malaysiaTime}, Malaysia time.' }],
        },
      },
    },
    {
      id: 'classroom_lightswitch',
      roomId: 'classroom',
      interaction: { prompt: 'Flip the light switch', action: { kind: ENVIRONMENT_ACTIONS.toggleLights } },
    },
    {
      id: 'classroom_bookshelf',
      roomId: 'classroom',
      interaction: {
        prompt: 'Browse the bookshelf',
        dialogue: {
          speaker: 'Bookshelf',
          source: 'prototype_script',
          lines: [
            { text: 'Textbooks for Additional Mathematics, Physics, Chemistry and Biology, plus a very well-used Kamus Dewan.' },
            { text: 'A sticky note on the bottom shelf: "Past-year SPM papers here. Please return them!"' },
            { text: 'A rolled-up periodic table poster sits on top, waiting for someone tall enough to put it up.' },
          ],
        },
      },
    },
    {
      id: 'classroom_teacher_desk',
      roomId: 'classroom',
      interaction: {
        prompt: "Look at the teacher's desk",
        dialogue: {
          speaker: "Cikgu Aisyah's desk",
          source: 'prototype_script',
          lines: [
            { text: 'A tall stack of exercise books waiting to be marked, a red pen and a mug of teh tarik.' },
            { text: 'A note taped to the corner says: "Always show your working!"' },
          ],
        },
      },
    },
    {
      id: 'hallway_clock',
      roomId: 'hallway',
      interaction: {
        prompt: 'Check the clock',
        dialogue: { speaker: 'Hallway clock', source: 'prototype_script', lines: [{ text: 'Current Malaysia time: {malaysiaTime} (MYT, UTC+8).' }] },
      },
    },
    ...HALLWAY_LOCKERS,
    ...HALLWAY_SHELVES,
  ],
};
