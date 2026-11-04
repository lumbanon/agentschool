import type { InteractableDefinition } from '../../engine/core/types';

/**
 * Hallway lockers and shelves (prototype script, not AI-generated).
 * One interactable — and one map zone — per physical object, so each has its own
 * consistent dialogue. Zone ids are created in scripts/generate-maps.mjs:
 * lockers left to right are hallway_locker_1 … hallway_locker_6.
 */

const inspect = (id: string, prompt: string, speaker: string, lines: string[]): InteractableDefinition => ({
  id,
  roomId: 'hallway',
  interaction: { prompt, dialogue: { speaker, source: 'prototype_script', lines: lines.map((text) => ({ text })) } },
});

export const HALLWAY_LOCKERS: InteractableDefinition[] = [
  inspect('hallway_locker_1', 'Look at locker 1', 'Locker 1', [
    'Someone left their Additional Mathematics homework inside. Hopefully they remembered to hand it in.',
  ]),
  inspect('hallway_locker_2', 'Look at locker 2', 'Locker 2', ['Locked. A shiny sticker on the door says "Future SPM Top Scorer".']),
  inspect('hallway_locker_3', 'Look at locker 3', 'Locker 3', [
    'Something rattles inside when you tap the door. Probably just a forgotten pencil case… probably.',
  ]),
  inspect('hallway_locker_4', 'Look at locker 4', 'Locker 4', [
    'Spotless. Labelled folders, colour-coded by subject, and a timetable laminated twice. Whoever owns this has their life together.',
  ]),
  inspect('hallway_locker_5', 'Look at locker 5', 'Locker 5', ['A note taped inside the door: "Reminder: bring your calculator. Yes, AGAIN."']),
  inspect('hallway_locker_6', 'Look at locker 6', 'Locker 6 — Kelab Robotik', [
    'A half-built line-following robot peeks out, next to a sign: "Please do not feed the robot."',
  ]),
];

export const HALLWAY_SHELVES: InteractableDefinition[] = [
  inspect('hallway_shelf_returns', 'Browse the returns shelf', 'Library returns shelf', [
    'Today\'s returns: a stack of Sejarah textbooks, two atlases and one comic with suspiciously crispy pages.',
    'A sign: "Please return library books by Friday. Overdue: 10 sen a day." Someone owes a lot of sen.',
  ]),
  inspect('hallway_shelf_fiction', 'Browse the fiction shelf', 'Fiction corner', [
    'Malay novels, English classics and a row of hikayat. A handwritten card recommends "Hikayat Hang Tuah: better than you think!"',
  ]),
];
