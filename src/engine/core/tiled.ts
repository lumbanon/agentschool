import type { DoorZone, InteractableZone, MapObjects, Rect, Vec2, WorldDefinition, SeatZone, PropZone } from './types';
import { pointInRect } from './interaction';

/** Subset of the Tiled JSON format we rely on. */
export interface TiledProperty {
  name: string;
  type: string;
  value: unknown;
}
export interface TiledObject {
  id: number;
  name: string;
  type?: string;
  class?: string; // Tiled >= 1.9 may write `class` for some exports
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  properties?: TiledProperty[];
}
export interface TiledLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup' | string;
  objects?: TiledObject[];
  data?: number[];
  width?: number;
  height?: number;
}
export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: { name: string; firstgid: number }[];
}

export const REQUIRED_TILE_LAYERS = ['ground', 'walls', 'furniture'] as const;
export const OBJECT_LAYER = 'objects';

function prop(o: TiledObject, name: string): string | undefined {
  const p = o.properties?.find((q) => q.name === name);
  return p === undefined ? undefined : String(p.value);
}

function kindOf(o: TiledObject): string | undefined {
  return o.type || o.class;
}

export function parseMapObjects(map: TiledMap): MapObjects {
  const layer = map.layers.find((l) => l.name === OBJECT_LAYER && l.type === 'objectgroup');
  const result: MapObjects = { spawns: {}, doors: [], npcPoints: {}, interactableZones: [], seats: [], props: [] };
  if (!layer?.objects) return result;
  for (const o of layer.objects) {
    const rect: Rect = { x: o.x, y: o.y, width: o.width, height: o.height };
    switch (kindOf(o)) {
      case 'spawn':
        result.spawns[o.name] = { x: o.x, y: o.y };
        break;
      case 'door': {
        const targetRoom = prop(o, 'targetRoom');
        const targetSpawn = prop(o, 'targetSpawn');
        if (targetRoom && targetSpawn) result.doors.push({ ...rect, name: o.name, targetRoom, targetSpawn } satisfies DoorZone);
        break;
      }
      case 'npc': {
        const actorId = prop(o, 'actorId');
        if (actorId) result.npcPoints[actorId] = { x: o.x, y: o.y };
        break;
      }
      case 'interactable': {
        const interactableId = prop(o, 'interactableId');
        if (interactableId) result.interactableZones.push({ ...rect, interactableId } satisfies InteractableZone);
        break;
      }
      case 'seat': {
        const facing = prop(o, 'facing');
        const sx = Number(prop(o, 'sitX'));
        const sy = Number(prop(o, 'sitY'));
        result.seats.push({
          ...rect,
          id: o.name || `seat_${o.id}`,
          sit: { x: Number.isFinite(sx) ? sx : o.x + o.width / 2, y: Number.isFinite(sy) ? sy : o.y + o.height / 2 },
          facing: facing === 'up' || facing === 'left' || facing === 'right' || facing === 'down' ? facing : 'up',
          prompt: prop(o, 'prompt') ?? 'Sit down',
        } satisfies SeatZone);
        break;
      }
      case 'prop': {
        const propId = prop(o, 'propId');
        if (propId) result.props.push({ ...rect, propId } satisfies PropZone);
        break;
      }
    }
  }
  return result;
}

/**
 * Static validation of a world definition against its maps. Catches broken
 * doors, missing spawns, unplaced actors and bounce-loops before the game runs.
 * Returns a list of human-readable problems (empty = valid).
 */
export function validateWorld(def: WorldDefinition, maps: Record<string, TiledMap>): string[] {
  const errors: string[] = [];
  const roomIds = new Set(def.rooms.map((r) => r.id));
  const objects: Record<string, MapObjects> = {};

  const ids = [...def.actors.map((a) => a.id), ...def.interactables.map((i) => i.id)];
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) errors.push(`duplicate ids: ${[...new Set(dup)].join(', ')}`);

  for (const room of def.rooms) {
    const map = maps[room.id];
    if (!map) {
      errors.push(`room ${room.id}: map not loaded`);
      continue;
    }
    for (const name of REQUIRED_TILE_LAYERS) {
      if (!map.layers.some((l) => l.name === name && l.type === 'tilelayer')) errors.push(`room ${room.id}: missing tile layer '${name}'`);
    }
    if (!map.tilesets.some((t) => t.name === def.tileset.tiledName)) errors.push(`room ${room.id}: tileset '${def.tileset.tiledName}' not referenced`);
    objects[room.id] = parseMapObjects(map);
  }

  if (!roomIds.has(def.start.roomId)) errors.push(`start room '${def.start.roomId}' does not exist`);
  else if (objects[def.start.roomId] && !objects[def.start.roomId].spawns[def.start.spawn])
    errors.push(`start spawn '${def.start.spawn}' missing in room ${def.start.roomId}`);

  for (const [roomId, obj] of Object.entries(objects)) {
    for (const door of obj.doors) {
      if (!roomIds.has(door.targetRoom)) {
        errors.push(`room ${roomId}: door '${door.name}' targets unknown room '${door.targetRoom}'`);
        continue;
      }
      const target = objects[door.targetRoom];
      const spawn: Vec2 | undefined = target?.spawns[door.targetSpawn];
      if (!spawn) {
        errors.push(`room ${roomId}: door '${door.name}' targets missing spawn '${door.targetSpawn}' in ${door.targetRoom}`);
        continue;
      }
      if (target.doors.some((d) => pointInRect(spawn, d)))
        errors.push(`room ${door.targetRoom}: spawn '${door.targetSpawn}' lies inside a door zone (would bounce)`);
    }
  }

  for (const [roomId, obj] of Object.entries(objects)) {
    const seatIds = obj.seats.map((st) => st.id);
    const dupSeats = seatIds.filter((id, i) => seatIds.indexOf(id) !== i);
    if (dupSeats.length) errors.push(`room ${roomId}: duplicate seat ids: ${[...new Set(dupSeats)].join(', ')}`);
    for (const st of obj.seats)
      if (obj.doors.some((d) => pointInRect(st.sit, d))) errors.push(`room ${roomId}: seat '${st.id}' sits inside a door zone`);
  }

  for (const actor of def.actors) {
    if (!roomIds.has(actor.roomId)) errors.push(`actor ${actor.id}: unknown room ${actor.roomId}`);
    else if (objects[actor.roomId] && !objects[actor.roomId].npcPoints[actor.id]) errors.push(`actor ${actor.id}: no npc point in map ${actor.roomId}`);
  }
  for (const it of def.interactables) {
    if (!roomIds.has(it.roomId)) errors.push(`interactable ${it.id}: unknown room ${it.roomId}`);
    else if (objects[it.roomId] && !objects[it.roomId].interactableZones.some((z) => z.interactableId === it.id))
      errors.push(`interactable ${it.id}: no zone in map ${it.roomId}`);
    if (!it.interaction.dialogue && !it.interaction.action) errors.push(`interactable ${it.id}: needs dialogue or action`);
  }
  return errors;
}
