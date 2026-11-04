import { describe, expect, it } from 'vitest';
import { findInteractionTarget, type InteractionCandidate } from '../../src/engine/core/interaction';

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
