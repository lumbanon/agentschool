/** Public surface of the domain-independent world engine. */
export * from './core/types';
export { WorldController, type ActiveInteraction } from './core/controller';
export { WorldEventBus } from './core/eventBus';
export { validateWorld, parseMapObjects, type TiledMap } from './core/tiled';
export { createWorldGame, type WorldGameHandle } from './phaser/createWorldGame';
export type { SceneSnapshot } from './phaser/WorldScene';
