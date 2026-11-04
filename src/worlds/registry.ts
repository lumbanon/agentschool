import type { WorldDefinition } from '../engine/core/types';
import { schoolWorld } from './school/definition';
import { officeWorld } from './office/definition';

export const WORLDS: Record<string, WorldDefinition> = {
  [schoolWorld.id]: schoolWorld,
  [officeWorld.id]: officeWorld,
};

export const DEFAULT_WORLD_ID = schoolWorld.id;
