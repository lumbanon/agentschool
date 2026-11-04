import { directionVector } from './movement';
import type { Direction, Rect, Vec2 } from './types';

export interface InteractionCandidate {
  id: string;
  kind: 'actor' | 'interactable';
  prompt: string;
  /** Actors are points; interactables are rectangles. */
  shape: { point: Vec2 } | { rect: Rect };
}

export interface ProbeOptions {
  /** How far in front of the player's feet we probe (px). */
  reach: number;
  /** Max distance from the probe point to a candidate (px). */
  radius: number;
}

export function probePoint(feet: Vec2, facing: Direction, reach: number): Vec2 {
  const d = directionVector(facing);
  return { x: feet.x + d.x * reach, y: feet.y + d.y * reach };
}

export function distanceToRect(p: Vec2, r: Rect): number {
  const cx = Math.max(r.x, Math.min(p.x, r.x + r.width));
  const cy = Math.max(r.y, Math.min(p.y, r.y + r.height));
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Pick the single best interaction target: the candidate closest to a point
 * just in front of the player, within `radius`. The player must roughly face it,
 * which avoids triggering things behind you.
 */
export function findInteractionTarget(
  feet: Vec2,
  facing: Direction,
  candidates: readonly InteractionCandidate[],
  { reach, radius }: ProbeOptions,
): InteractionCandidate | null {
  const probe = probePoint(feet, facing, reach);
  let best: InteractionCandidate | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dist = 'point' in c.shape ? Math.hypot(probe.x - c.shape.point.x, probe.y - c.shape.point.y) : distanceToRect(probe, c.shape.rect);
    if (dist <= radius && dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
}
