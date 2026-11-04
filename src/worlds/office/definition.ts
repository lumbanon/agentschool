import type { WorldDefinition } from '../../engine/core/types';
import { OFFICE_ACTIONS } from '../../domains/office/actions';

/**
 * Office World — compatibility test only. Proves the engine runs a different
 * domain with zero changes to movement / collision / interaction code.
 * Not BizPilot: no backend, no real AI employees.
 */
export const officeWorld: WorldDefinition = {
  id: 'office',
  displayName: 'Office (compatibility test)',
  tileset: { key: 'agentworld-tiles', url: 'assets/tiles.png', tiledName: 'agentworld' },
  indicator: { key: 'indicator', url: 'assets/ui/indicator.png' },
  rooms: [{ id: 'office', displayName: 'Open Office', mapUrl: 'maps/office/office.json' }],
  start: { roomId: 'office', spawn: 'start' },
  player: { displayName: 'You (manager)', sprite: { key: 'char-manager', url: 'assets/characters/manager.png' } },
  actors: [
    {
      id: 'employee_farid',
      displayName: 'Farid',
      roleLabel: 'Operations (mock employee)',
      sprite: { key: 'char-employee', url: 'assets/characters/employee.png' },
      roomId: 'office',
      behavior: { kind: 'wander', radiusTiles: 1, speed: 28, pauseMs: [900, 2200] },
      interaction: {
        prompt: 'Talk to Farid',
        dialogue: {
          speaker: 'Farid',
          source: 'prototype_script',
          lines: [
            { text: "Hi {playerName}. I've got the weekly supplier report half done." },
            {
              text: 'Want to look at my task?',
              choices: [
                { label: 'Open task', action: { kind: OFFICE_ACTIONS.openTask, payload: { taskId: 'weekly-supplier-report' } } },
                { label: 'Carry on', closes: true },
              ],
            },
          ],
        },
      },
    },
  ],
  interactables: [
    {
      id: 'office_computer',
      roomId: 'office',
      interaction: {
        prompt: 'Use the computer',
        action: { kind: OFFICE_ACTIONS.openTask, payload: { taskId: 'weekly-supplier-report' } },
      },
    },
    {
      // Same clock prop and environment values as the school: reuse check.
      id: 'office_clock',
      roomId: 'office',
      interaction: {
        prompt: 'Check the clock',
        dialogue: { speaker: 'Office clock', source: 'prototype_script', lines: [{ text: 'Current Malaysia time: {malaysiaTime} (MYT, UTC+8).' }] },
      },
    },
    {
      id: 'office_bookshelf',
      roomId: 'office',
      interaction: {
        prompt: 'Browse the shelf',
        dialogue: {
          speaker: 'Office shelf',
          source: 'prototype_script',
          lines: [{ text: 'Binders labelled "Supplier contracts", "Q3 invoices" and, oddly, "Potluck sign-up sheets (2019–present)".' }],
        },
      },
    },
  ],
};
