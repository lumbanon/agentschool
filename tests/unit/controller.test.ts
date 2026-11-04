import { describe, expect, it } from 'vitest';
import { WorldController } from '../../src/engine/core/controller';
import type { WorldEvent } from '../../src/engine/core/types';
import { schoolWorld } from '../../src/worlds/school/definition';
import { officeWorld } from '../../src/worlds/office/definition';

function setup(def = schoolWorld) {
  const c = new WorldController(def);
  const events: WorldEvent[] = [];
  c.bus.onAny((e) => events.push(e));
  return { c, events, types: () => events.map((e) => e.type) };
}

const teacher = { id: 'teacher_aisyah', kind: 'actor' as const, prompt: 'Talk to Cikgu Aisyah' };

describe('WorldController', () => {
  it('starts loading and cannot move until a room is ready', () => {
    const { c, types } = setup();
    expect(c.mode).toBe('loading');
    expect(c.canMove()).toBe(false);
    c.roomReady('hallway', 'start');
    expect(c.canMove()).toBe(true);
    expect(types()).toEqual(['mode.changed', 'world.loaded', 'room.entered']);
  });

  it('interacting pauses movement and resumes after the interaction ends', () => {
    const { c } = setup();
    c.roomReady('classroom', 'from_hallway');
    c.setTarget(teacher);
    expect(c.interact()).toBe(true);
    expect(c.mode).toBe('interacting');
    expect(c.canMove()).toBe(false);
    c.endInteraction();
    expect(c.mode).toBe('exploring');
    expect(c.canMove()).toBe(true);
  });

  it('does nothing when interacting with no target', () => {
    const { c } = setup();
    c.roomReady('hallway', 'start');
    expect(c.interact()).toBe(false);
    expect(c.mode).toBe('exploring');
  });

  it('emits the dialogue and then a domain action on choice', () => {
    const { c, events } = setup();
    c.roomReady('classroom', 'from_hallway');
    c.setTarget(teacher);
    c.interact();
    const started = events.find((e) => e.type === 'interaction.started');
    expect(started && started.type === 'interaction.started' && started.dialogue?.source).toBe('prototype_script');
    const lastLine = schoolWorld.actors[0].interaction!.dialogue!.lines.at(-1)!;
    c.chooseDialogueChoice(lastLine.choices![0]);
    const action = events.find((e) => e.type === 'action.requested');
    expect(action && action.type === 'action.requested' && action.action.kind).toBe('school.openLesson');
    // Interaction stays open while the domain panel is shown.
    expect(c.mode).toBe('interacting');
  });

  it('an interactable with only an action requests it immediately', () => {
    const { c, events } = setup();
    c.roomReady('classroom', 'from_hallway');
    c.setTarget({ id: 'classroom_blackboard', kind: 'interactable', prompt: 'Read the blackboard' });
    c.interact();
    expect(events.some((e) => e.type === 'action.requested')).toBe(true);
  });

  it('"Maybe later" closes the interaction', () => {
    const { c } = setup();
    c.roomReady('classroom', 'from_hallway');
    c.setTarget(teacher);
    c.interact();
    c.chooseDialogueChoice({ label: 'Maybe later', closes: true });
    expect(c.mode).toBe('exploring');
  });

  it('blocks door transitions while interacting and to unknown rooms', () => {
    const { c } = setup();
    c.roomReady('hallway', 'start');
    const door = { name: 'd', x: 0, y: 0, width: 16, height: 16, targetRoom: 'classroom', targetSpawn: 'from_hallway' };
    expect(c.beginTransition({ ...door, targetRoom: 'nowhere' })).toBe(false);
    c.setTarget({ id: 'hallway_noticeboard', kind: 'interactable', prompt: 'Read' });
    c.interact();
    expect(c.beginTransition(door)).toBe(false);
    c.endInteraction();
    expect(c.beginTransition(door)).toBe(true);
    expect(c.mode).toBe('transitioning');
    expect(c.canMove()).toBe(false);
    c.roomReady('classroom', 'from_hallway');
    expect(c.roomId).toBe('classroom');
    expect(c.canMove()).toBe(true);
  });

  it('runs the office world with the same controller (reusability)', () => {
    const { c, events } = setup(officeWorld);
    c.roomReady('office', 'start');
    c.setTarget({ id: 'office_computer', kind: 'interactable', prompt: 'Use the computer' });
    c.interact();
    const action = events.find((e) => e.type === 'action.requested');
    expect(action && action.type === 'action.requested' && action.action.kind).toBe('office.openTask');
  });
});
