/**
 * Domain-neutral contracts for the AgentWorld engine.
 *
 * RULE: nothing in src/engine may import from src/worlds or src/domains, and no
 * type here may mention schools, lessons, offices or tasks. Domain meaning is
 * carried only by namespaced `ActionDescriptor.kind` strings and opaque payloads.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Vec2 {
  x: number;
  y: number;
}

/** Reference to a character spritesheet (16x24 frames, 3 cols x 4 rows: down, left, right, up). */
export interface SpriteRef {
  key: string;
  url: string;
}

/** Where a piece of dialogue came from. The UI must badge anything that is not model output. */
export type ContentSource = 'prototype_script' | 'llm_generated';

export interface DialogueChoice {
  label: string;
  /** If set, choosing this option requests a domain action (handled outside the engine). */
  action?: ActionDescriptor;
  /** Close the interaction after choosing (default true when no action). */
  closes?: boolean;
}

export interface DialogueLine {
  text: string;
  /** Choices shown on the final line only. */
  choices?: DialogueChoice[];
}

export interface DialogueScript {
  speaker: string;
  source: ContentSource;
  lines: DialogueLine[];
}

/** A domain action, e.g. { kind: 'school.openLesson', payload: { lessonId } }. Opaque to the engine. */
export interface ActionDescriptor {
  kind: string;
  payload?: Record<string, unknown>;
}

export interface InteractionDefinition {
  /** Short verb phrase shown in the prompt: "Talk to Cikgu Aisyah". */
  prompt: string;
  dialogue?: DialogueScript;
  /** Action to request immediately (no dialogue) — e.g. reading a blackboard. */
  action?: ActionDescriptor;
}

export type NpcBehavior =
  | { kind: 'idle'; facing?: Direction }
  | { kind: 'wander'; radiusTiles: number; speed?: number; pauseMs?: [number, number] };

export interface ActorDefinition {
  id: string;
  displayName: string;
  /** Free-text role label used only for UI (e.g. "Teacher", "Employee"). */
  roleLabel: string;
  sprite: SpriteRef;
  roomId: string;
  behavior: NpcBehavior;
  interaction?: InteractionDefinition;
}

export interface InteractableDefinition {
  id: string;
  roomId: string;
  interaction: InteractionDefinition;
}

export interface RoomDefinition {
  id: string;
  displayName: string;
  /** Tiled JSON (orthogonal, layers: ground, walls, furniture, objects). */
  mapUrl: string;
}

export interface TilesetRef {
  key: string;
  url: string;
  /** Name of the tileset inside the Tiled maps. */
  tiledName: string;
}

export interface WorldDefinition {
  id: string;
  displayName: string;
  tileset: TilesetRef;
  indicator: { key: string; url: string };
  rooms: RoomDefinition[];
  start: { roomId: string; spawn: string };
  player: { displayName: string; sprite: SpriteRef };
  actors: ActorDefinition[];
  interactables: InteractableDefinition[];
}

// ------------------------------------------------------------------ map-derived data

/** Parsed from the Tiled object layer, in pixels. */
export interface MapObjects {
  spawns: Record<string, Vec2>;
  doors: DoorZone[];
  npcPoints: Record<string, Vec2>; // actorId -> point
  interactableZones: InteractableZone[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DoorZone extends Rect {
  name: string;
  targetRoom: string;
  targetSpawn: string;
}

export interface InteractableZone extends Rect {
  interactableId: string;
}

// ------------------------------------------------------------------ runtime

export type WorldMode = 'loading' | 'exploring' | 'interacting' | 'transitioning';

/** Something the player could interact with right now. */
export interface InteractionTarget {
  /** actor id or interactable id */
  id: string;
  kind: 'actor' | 'interactable';
  prompt: string;
}

export interface SceneTransition {
  fromRoom: string;
  toRoom: string;
  spawn: string;
}

/** Events emitted by the engine. React (or anything else) subscribes; the engine never imports React. */
export type WorldEvent =
  | { type: 'world.loaded'; worldId: string }
  | { type: 'room.entered'; roomId: string; roomName: string; spawn: string }
  | { type: 'transition.started'; transition: SceneTransition }
  | { type: 'interaction.targetChanged'; target: InteractionTarget | null }
  | { type: 'interaction.started'; target: InteractionTarget; dialogue?: DialogueScript }
  | { type: 'action.requested'; action: ActionDescriptor; sourceId: string }
  | { type: 'interaction.ended'; targetId: string }
  | { type: 'mode.changed'; mode: WorldMode };

export type WorldEventType = WorldEvent['type'];
export type WorldEventOf<K extends WorldEventType> = Extract<WorldEvent, { type: K }>;
