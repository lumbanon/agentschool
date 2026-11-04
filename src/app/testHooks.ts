import type { SceneSnapshot, WorldMode } from '../engine';

/**
 * Read-only hook used by Playwright (and handy in the console). It exposes
 * state only — tests drive the game through real keyboard input.
 */
export interface AgentWorldTestHook {
  worldId: string;
  mode: () => WorldMode;
  roomId: () => string;
  snapshot: () => SceneSnapshot | null;
}

declare global {
  interface Window {
    __agentWorld?: AgentWorldTestHook;
  }
}
