import type { Direction, Vec2 } from './types';

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export const NO_INPUT: InputState = { up: false, down: false, left: false, right: false };

/**
 * Velocity for top-down movement. Diagonals are normalised so moving diagonally
 * is not faster. Opposing keys cancel.
 */
export function computeVelocity(input: InputState, speed: number): Vec2 {
  const x = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const y = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (x === 0 && y === 0) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  return { x: (x / len) * speed, y: (y / len) * speed };
}

/**
 * Which way the character should face. While moving diagonally we keep the
 * current facing if it is one of the two active axes (prevents sprite flicker).
 */
export function resolveFacing(input: InputState, current: Direction): Direction {
  const active: Direction[] = [];
  if (input.up && !input.down) active.push('up');
  if (input.down && !input.up) active.push('down');
  if (input.left && !input.right) active.push('left');
  if (input.right && !input.left) active.push('right');
  if (active.length === 0) return current;
  if (active.includes(current)) return current;
  return active[0];
}

export function directionVector(dir: Direction): Vec2 {
  switch (dir) {
    case 'up':
      return { x: 0, y: -1 };
    case 'down':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
  }
}

/** Direction from `from` towards `to` (dominant axis). Used to turn NPCs toward the player. */
export function facingToward(from: Vec2, to: Vec2): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
