import Phaser from 'phaser';
import type { WorldController } from '../core/controller';
import { WorldScene, type SceneSnapshot } from './WorldScene';

export interface WorldGameHandle {
  game: Phaser.Game;
  snapshot(): SceneSnapshot | null;
  destroy(): void;
}

/**
 * Boot a Phaser game for any world. The caller owns the controller and
 * subscribes to its event bus; this function only wires the renderer.
 */
export function createWorldGame(parent: HTMLElement, controller: WorldController): WorldGameHandle {
  const scene = new WorldScene(controller);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#1d1a24',
    banner: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: Math.max(1, parent.clientWidth),
      height: Math.max(1, parent.clientHeight),
    },
    physics: { default: 'arcade', arcade: { debug: false } },
    // Never call preventDefault on keys: overlay text fields must receive every keystroke.
    input: { keyboard: { capture: [] } },
    scene: [scene],
  });
  let destroyed = false;
  return {
    game,
    snapshot: () => (destroyed ? null : scene.snapshot()),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      game.destroy(true);
    },
  };
}
