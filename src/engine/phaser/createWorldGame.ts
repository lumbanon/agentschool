import Phaser from 'phaser';
import type { WorldController } from '../core/controller';
import { pixelSignature } from '../core/pixels';
import { WorldScene, type Ambience, type SceneSnapshot } from './WorldScene';

export interface WorldGameOptions {
  /** Runtime sprite sheets (16x24 frames, 3 cols x 4 rows) by texture key; they override sprite URLs. */
  spriteSheets?: Record<string, HTMLCanvasElement>;
  /** Text shown above the player character. */
  playerLabel?: string | null;
  /** Textures for `prop` map objects, by prop id. */
  propTextures?: Record<string, HTMLCanvasElement>;
  /** Room-wide tint. */
  ambience?: Ambience | null;
}

export interface WorldGameHandle {
  game: Phaser.Game;
  snapshot(): SceneSnapshot | null;
  /** Replace a character sheet live (position, room and animations are kept). */
  setSpriteSheet(key: string, sheet: HTMLCanvasElement): void;
  setPlayerLabel(text: string | null): void;
  /** Supply or update a prop texture (e.g. redraw a clock face each minute). */
  setPropTexture(propId: string, texture: HTMLCanvasElement): void;
  setAmbience(ambience: Ambience | null): void;
  /** Stop/resume keyboard handling, e.g. while a form is shown over the world. */
  setInputEnabled(enabled: boolean): void;
  /** Pixel signature of a loaded texture (tests: compare with what the UI rendered). */
  textureSignature(key: string): string | null;
  destroy(): void;
}

/**
 * Boot a Phaser game for any world. The caller owns the controller and
 * subscribes to its event bus; this function only wires the renderer.
 */
export function createWorldGame(parent: HTMLElement, controller: WorldController, options: WorldGameOptions = {}): WorldGameHandle {
  const scene = new WorldScene(controller, {
    spriteSheets: new Map(Object.entries(options.spriteSheets ?? {})),
    playerLabel: options.playerLabel ?? null,
    propTextures: new Map(Object.entries(options.propTextures ?? {})),
    ambience: options.ambience ?? null,
  });
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
    setSpriteSheet: (key, sheet) => {
      if (!destroyed) scene.setSpriteSheet(key, sheet);
    },
    setPlayerLabel: (text) => {
      if (!destroyed) scene.setPlayerLabel(text);
    },
    setPropTexture: (propId, texture) => {
      if (!destroyed) scene.setPropTexture(propId, texture);
    },
    setAmbience: (ambience) => {
      if (!destroyed) scene.setAmbience(ambience);
    },
    setInputEnabled: (enabled) => {
      if (!destroyed) scene.setInputEnabled(enabled);
    },
    textureSignature: (key) => {
      if (destroyed || !game.textures.exists(key)) return null;
      const src = game.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const canvas = document.createElement('canvas');
      canvas.width = src.width;
      canvas.height = src.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(src, 0, 0);
      return pixelSignature(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      game.destroy(true);
    },
  };
}
