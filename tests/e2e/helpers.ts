import { expect, type Page } from '@playwright/test';

/** Mirrors SceneSnapshot from src/engine/phaser/WorldScene.ts (kept local so tests never import Phaser). */
export interface Snap {
  roomId: string;
  mode: string;
  x: number;
  y: number;
  facing: string;
  moving: boolean;
  targetId: string | null;
}

interface Hook {
  worldId: string;
  mode(): string;
  roomId(): string;
  snapshot(): Snap | null;
}
type HookWindow = Window & { __agentWorld?: Hook };

export async function snap(page: Page): Promise<Snap> {
  const s = await page.evaluate(() => (window as HookWindow).__agentWorld?.snapshot() ?? null);
  if (!s) throw new Error('world not ready');
  return s;
}

export async function waitForRoom(page: Page, roomId: string, worldId?: string) {
  await page.waitForFunction(
    ([room, world]) => {
      const w = (window as HookWindow).__agentWorld;
      return !!w && (!world || w.worldId === world) && w.roomId() === room && w.mode() === 'exploring' && !!w.snapshot();
    },
    [roomId, worldId] as const,
    { timeout: 20_000 },
  );
}

const KEY = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' } as const;
const SPEED = 80; // px/s, matches PLAYER_SPEED in WorldScene

/**
 * Walk along one axis to a coordinate using real key presses.
 * Short holds near the goal give ~1px precision; throws if the player is stuck.
 */
export async function walkAxis(page: Page, axis: 'x' | 'y', target: number, tolerance = 1.5) {
  let stuck = 0;
  for (let i = 0; i < 80; i++) {
    const s = await snap(page);
    const d = target - s[axis];
    if (Math.abs(d) <= tolerance) return;
    const key = axis === 'x' ? (d > 0 ? KEY.right : KEY.left) : d > 0 ? KEY.down : KEY.up;
    const ms = Math.max(20, Math.min(400, (Math.abs(d) / SPEED) * 1000 * 0.7));
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(40);
    const after = await snap(page);
    if (Math.abs(after[axis] - s[axis]) < 0.1) {
      if (++stuck >= 4) throw new Error(`stuck walking ${axis} to ${target} at (${after.x}, ${after.y})`);
    } else stuck = 0;
  }
  throw new Error(`did not reach ${axis}=${target}`);
}

export async function walkTo(page: Page, path: [axis: 'x' | 'y', value: number][]) {
  for (const [axis, value] of path) await walkAxis(page, axis, value);
}

/** Hold a direction for a fixed time (e.g. to walk into a wall or through a door). */
export async function hold(page: Page, dir: keyof typeof KEY, ms: number) {
  await page.keyboard.down(KEY[dir]);
  await page.waitForTimeout(ms);
  await page.keyboard.up(KEY[dir]);
  await page.waitForTimeout(50);
}

export async function expectTarget(page: Page, id: string) {
  await expect.poll(async () => (await snap(page)).targetId, { timeout: 5_000 }).toBe(id);
}

/** From the hallway start, walk through the classroom door. */
export async function enterClassroom(page: Page) {
  await walkTo(page, [
    ['x', 184],
    ['y', 48],
  ]);
  await hold(page, 'up', 600);
  await waitForRoom(page, 'classroom');
}

/** From the classroom entrance, stand below Cikgu Aisyah facing her. */
export async function approachTeacher(page: Page) {
  await walkTo(page, [
    ['y', 72],
    ['x', 152],
  ]);
  await hold(page, 'up', 250);
  await expectTarget(page, 'teacher_aisyah');
}
