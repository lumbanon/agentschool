import { describe, expect, it } from 'vitest';
import { computeVelocity, facingToward, resolveFacing, NO_INPUT } from '../../src/engine/core/movement';

describe('computeVelocity', () => {
  it('is zero with no input', () => {
    expect(computeVelocity(NO_INPUT, 100)).toEqual({ x: 0, y: 0 });
  });
  it('moves along one axis at full speed', () => {
    expect(computeVelocity({ ...NO_INPUT, right: true }, 100)).toEqual({ x: 100, y: 0 });
    expect(computeVelocity({ ...NO_INPUT, up: true }, 100)).toEqual({ x: 0, y: -100 });
  });
  it('normalises diagonals so they are not faster', () => {
    const v = computeVelocity({ ...NO_INPUT, down: true, left: true }, 100);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(100, 6);
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBeGreaterThan(0);
  });
  it('cancels opposing keys', () => {
    expect(computeVelocity({ up: true, down: true, left: true, right: true }, 100)).toEqual({ x: 0, y: 0 });
  });
});

describe('resolveFacing', () => {
  it('keeps facing when idle', () => {
    expect(resolveFacing(NO_INPUT, 'left')).toBe('left');
  });
  it('turns to the pressed direction', () => {
    expect(resolveFacing({ ...NO_INPUT, up: true }, 'down')).toBe('up');
  });
  it('keeps current facing during a diagonal that includes it (no flicker)', () => {
    expect(resolveFacing({ ...NO_INPUT, up: true, right: true }, 'right')).toBe('right');
  });
});

describe('facingToward', () => {
  it('uses the dominant axis', () => {
    expect(facingToward({ x: 0, y: 0 }, { x: 10, y: 2 })).toBe('right');
    expect(facingToward({ x: 0, y: 0 }, { x: 1, y: -10 })).toBe('up');
  });
});
