/** Public surface of the domain-independent world engine. */
export * from './core/types';
export { WorldController, type ActiveInteraction } from './core/controller';
export { WorldEventBus } from './core/eventBus';
export { validateWorld, parseMapObjects, type TiledMap } from './core/tiled';
export { pixelSignature } from './core/pixels';
export { createWorldGame, type WorldGameHandle, type WorldGameOptions } from './phaser/createWorldGame';
export { propTextureKey, sitTextureKey, type Ambience, type SceneSnapshot } from './phaser/WorldScene';
