import { directionVector } from './movement';
import type { Direction, Rect, Vec2 } from './types';

export interface InteractionCandidate {
  id: string;
  kind: 'actor' | 'interactable' | 'seat';
  /**
   * Unique per physical thing (e.g. one map zone). Several zones may share an
   * interactable `id` (two windows with the same view), but the indicator must
   * point at the one actually in front of the player, so selection tracks `key`.
   * Defaults to `${kind}:${id}`.
   */
  key?: string;
  prompt: string;
  /** Actors are points; interactables and seats are rectangles. */
  shape: { point: Vec2 } | { rect: Rect };
}

export interface ProbeOptions {
  /** How far in front of the player's feet we probe (px). */
  reach: number;
  /** Max distance from the probe point to a candidate (px). */
  radius: number;
  /**
   * Hysteresis: the current target wins ties unless another candidate is this
   * much closer (px). Only a preference: it never extends the range, so the
   * target still drops the moment it is out of reach.
   */
  stickiness?: number;
  /** Key of the current target, for `stickiness`. */
  current?: string | null;
}

/**
 * Engine default. Something straight ahead is reachable up to reach + radius =
 * 14 px from the feet (less than one 16 px tile); sideways up to ~10 px. Objects
 * behind the player are never selected. Bodies and walls stop the player 3–6 px
 * from what they collide with, so "touching" is always well inside the range.
 */
export const DEFAULT_PROBE: Readonly<Required<Omit<ProbeOptions, 'current'>>> = { reach: 6, radius: 8, stickiness: 3 };

export const candidateKey = (c: InteractionCandidate) => c.key ?? `${c.kind}:${c.id}`;

export function probePoint(feet: Vec2, facing: Direction, reach: number): Vec2 {
  const d = directionVector(facing);
  return { x: feet.x + d.x * reach, y: feet.y + d.y * reach };
}

export function distanceToRect(p: Vec2, r: Rect): number {
  const cx = Math.max(r.x, Math.min(p.x, r.x + r.width));
  const cy = Math.max(r.y, Math.min(p.y, r.y + r.height));
  return Math.hypot(p.x - cx, p.y - cy);
}

export function distanceToShape(p: Vec2, shape: InteractionCandidate['shape']): number {
  return 'point' in shape ? Math.hypot(p.x - shape.point.x, p.y - shape.point.y) : distanceToRect(p, shape.rect);
}

/**
 * Pick the single best interaction target: the candidate closest to a point
 * just in front of the player, within `radius`. The player must roughly face it,
 * which avoids triggering things behind you. Ties go to the earlier candidate,
 * so the result is deterministic.
 */
export function findInteractionTarget(
  feet: Vec2,
  facing: Direction,
  candidates: readonly InteractionCandidate[],
  { reach, radius, stickiness = 0, current = null }: ProbeOptions,
): InteractionCandidate | null {
  const probe = probePoint(feet, facing, reach);
  let best: InteractionCandidate | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const dist = distanceToShape(probe, c.shape);
    if (dist > radius) continue;
    const score = current !== null && candidateKey(c) === current ? dist - stickiness : dist;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
}

/** Where the "!" indicator goes for a candidate: centred over its top edge (world px). */
export function indicatorAnchor(shape: InteractionCandidate['shape'], pointTopOffset: number): Vec2 {
  if ('point' in shape) return { x: shape.point.x, y: shape.point.y - pointTopOffset };
  return { x: shape.rect.x + shape.rect.width / 2, y: shape.rect.y + 2 };
}
