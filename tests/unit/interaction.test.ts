import { describe, expect, it } from 'vitest';
import { candidateKey, DEFAULT_PROBE, findInteractionTarget, indicatorAnchor, type InteractionCandidate } from '../../src/engine/core/interaction';

const npc: InteractionCandidate = { id: 'npc', kind: 'actor', prompt: 'Talk', shape: { point: { x: 100, y: 80 } } };
const board: InteractionCandidate = { id: 'board', kind: 'interactable', prompt: 'Read', shape: { rect: { x: 64, y: 16, width: 80, height: 16 } } };
const opts = { reach: 10, radius: 14 };

describe('findInteractionTarget', () => {
  it('finds an NPC directly in front', () => {
    expect(findInteractionTarget({ x: 100, y: 96 }, 'up', [npc], opts)?.id).toBe('npc');
  });
  it('ignores an NPC behind the player', () => {
    expect(findInteractionTarget({ x: 100, y: 96 }, 'down', [npc], opts)).toBeNull();
  });
  it('ignores targets out of reach', () => {
    expect(findInteractionTarget({ x: 100, y: 140 }, 'up', [npc], opts)).toBeNull();
  });
  it('finds a rectangular interactable (blackboard) when facing it', () => {
    expect(findInteractionTarget({ x: 90, y: 44 }, 'up', [board], opts)?.id).toBe('board');
  });
  it('prefers the closest candidate', () => {
    const far: InteractionCandidate = { ...npc, id: 'far', shape: { point: { x: 100, y: 74 } } };
    const near: InteractionCandidate = { ...npc, id: 'near', shape: { point: { x: 100, y: 85 } } };
    expect(findInteractionTarget({ x: 100, y: 96 }, 'up', [far, near], opts)?.id).toBe('near');
  });
});

describe('DEFAULT_PROBE: indicators only when E would really work (regression)', () => {
  const T = 16;
  // A wall object like a locker: tile (6,1) -> rect x 96..112, y 16..32. A wall stops the feet at y = 35.
  const locker = (n: number, tileX: number): InteractionCandidate => ({
    id: `locker_${n}`,
    key: `zone:${n}`,
    kind: 'interactable',
    prompt: 'Look',
    shape: { rect: { x: tileX * T, y: T, width: T, height: T } },
  });
  const one = [locker(1, 6)];
  const at = (x: number, y: number, list = one, current: string | null = null) =>
    findInteractionTarget({ x, y }, 'up', list, { ...DEFAULT_PROBE, current })?.key ?? null;

  it('reach is under one tile straight ahead', () => {
    expect(DEFAULT_PROBE.reach + DEFAULT_PROBE.radius).toBeLessThan(T);
  });

  it('touching (pressed against the wall) and half a tile away are in range', () => {
    expect(at(104, 35)).toBe('zone:1');
    expect(at(104, 40)).toBe('zone:1');
    expect(at(104, 46)).toBe('zone:1'); // 14 px from the locker's front edge: the limit
  });

  it('one tile or more away is out of range (was in range before the fix: 24 px reach)', () => {
    expect(at(104, 47)).toBeNull();
    expect(at(104, 55)).toBeNull();
    expect(at(104, 88)).toBeNull();
  });

  it('objects behind or beside-and-behind the player are never selected', () => {
    expect(findInteractionTarget({ x: 104, y: 35 }, 'down', one, DEFAULT_PROBE)).toBeNull();
    expect(findInteractionTarget({ x: 130, y: 36 }, 'right', one, DEFAULT_PROBE)).toBeNull();
  });

  it('only a little sideways tolerance: the neighbouring column is out', () => {
    expect(at(120, 35)).toBe('zone:1'); // standing on the wall gap right next to it
    expect(at(125, 35)).toBeNull(); // more than half a tile to the side
  });

  it('between two lockers (a tile apart): exactly one target, switching cleanly at the midpoint', () => {
    const two = [locker(1, 6), locker(2, 8)]; // gap tile 7 (112..128) in between
    expect(at(119, 35, two)).toBe('zone:1');
    expect(at(120, 35, two)).toBe('zone:1'); // exact tie: deterministic, earlier candidate
    expect(at(121, 35, two, 'zone:1')).toBe('zone:2'); // locker 1 is now out of reach, so no stale target
  });

  it('touching objects (blackboard next to the light switch): hysteresis stops 1 px flicker', () => {
    const board: InteractionCandidate = { id: 'board', key: 'zone:board', kind: 'interactable', prompt: 'Read', shape: { rect: { x: 64, y: 16, width: 80, height: 16 } } };
    const sw: InteractionCandidate = { id: 'switch', key: 'zone:switch', kind: 'interactable', prompt: 'Flip', shape: { rect: { x: 144, y: 16, width: 16, height: 16 } } };
    const pair = [board, sw];
    expect(at(143, 35, pair)).toBe('zone:board');
    expect(at(145, 35, pair, 'zone:board')).toBe('zone:board'); // just over the seam: keeps the current one
    expect(at(148, 35, pair, 'zone:board')).toBe('zone:switch'); // clearly in front of the switch
    expect(at(143, 35, pair, 'zone:switch')).toBe('zone:switch'); // and back the other way
    expect(at(139, 35, pair, 'zone:switch')).toBe('zone:board');
  });

  it('hysteresis never keeps a target that is out of range', () => {
    expect(at(104, 55, one, 'zone:1')).toBeNull();
  });

  it('zones that share an interactable id are still told apart by key', () => {
    const a: InteractionCandidate = { id: 'window', key: 'zone:0', kind: 'interactable', prompt: 'Look', shape: { rect: { x: 160, y: 16, width: 16, height: 16 } } };
    const b: InteractionCandidate = { ...a, key: 'zone:1', shape: { rect: { x: 224, y: 16, width: 16, height: 16 } } };
    expect(findInteractionTarget({ x: 232, y: 35 }, 'up', [a, b], DEFAULT_PROBE)?.key).toBe('zone:1');
    expect(candidateKey({ ...a, key: undefined })).toBe('interactable:window');
  });

  it('indicator sits over the targeted rect (not any other zone with the same id)', () => {
    expect(indicatorAnchor({ rect: { x: 224, y: 16, width: 16, height: 16 } }, 22)).toEqual({ x: 232, y: 18 });
    expect(indicatorAnchor({ point: { x: 152, y: 56 } }, 22)).toEqual({ x: 152, y: 34 });
  });
});
