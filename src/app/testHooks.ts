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
  /** Texture key of the player sprite in this world. */
  playerTextureKey: string;
  /** Pixel signature of a texture as Phaser holds it (compare with the creator preview). */
  textureSignature: (key: string) => string | null;
}

declare global {
  interface Window {
    __agentWorld?: AgentWorldTestHook;
  }
}
