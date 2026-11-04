import Phaser from 'phaser';
import type { WorldController } from '../core/controller';
import { findInteractionTarget, pointInRect, type InteractionCandidate } from '../core/interaction';
import { computeVelocity, facingToward, NO_INPUT, resolveFacing, type InputState } from '../core/movement';
import { parseMapObjects, type TiledMap } from '../core/tiled';
import type { ActorDefinition, Direction, DoorZone, MapObjects, Vec2, WorldMode } from '../core/types';

/**
 * Generic top-down room renderer for any WorldDefinition.
 *
 * Responsibilities: draw the Tiled map, collide, move the player, run NPC
 * behaviours, detect doors and interaction targets, and report all of it to
 * the WorldController. It knows nothing about what an interaction *means*.
 */

// Character sheets: 16x24 frames, 3 columns (stand, stepA, stepB) x 4 rows.
export const FRAME_W = 16;
export const FRAME_H = 24;
const DIR_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };
/** Feet-sized physics body so characters overlap furniture tops naturally. */
const BODY = { w: 10, h: 6, offsetX: 3, offsetY: 18 };
/** Origin chosen so the sprite position equals the centre of the feet body. */
const ORIGIN = { x: 0.5, y: (BODY.offsetY + BODY.h / 2) / FRAME_H };

const PLAYER_SPEED = 80; // px/s
const PROBE = { reach: 10, radius: 14 };
const FADE_MS = 180;
/** Ignore the interact key briefly after an interaction closes (key that closed it must not reopen it). */
const INTERACT_COOLDOWN_MS = 250;
const MAX_ZOOM = 5;
const LAYER_DEPTH = { ground: 0, walls: 1, furniture: 2 } as const;
const CHARACTER_DEPTH = 10;

export const mapCacheKey = (roomId: string) => `map:${roomId}`;

interface NpcRuntime {
  def: ActorDefinition;
  sprite: Phaser.Physics.Arcade.Sprite;
  home: Vec2;
  facing: Direction;
  paused: boolean;
  goal?: Vec2;
  goalDeadline: number;
  waitUntil: number;
}

export interface SceneSnapshot {
  roomId: string;
  mode: WorldMode;
  x: number;
  y: number;
  facing: Direction;
  moving: boolean;
  targetId: string | null;
  /** Map size in pixels, and the current camera zoom. */
  map: { width: number; height: number; zoom: number };
}

/**
 * Build (once) a copy of the tileset with every tile's edge pixels duplicated
 * into a 1px margin / 2px spacing. Without this, GPU sampling at integer zoom
 * occasionally reads the neighbouring tile and draws a 1px seam across the map.
 */
function extrudeTileset(scene: Phaser.Scene, key: string, tw: number, th: number): string {
  const outKey = `${key}:extruded`;
  if (scene.textures.exists(outKey)) return outKey;
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const cols = Math.floor(src.width / tw);
  const rows = Math.floor(src.height / th);
  const canvas = scene.textures.createCanvas(outKey, cols * (tw + 2), rows * (th + 2));
  if (!canvas) return key;
  const ctx = canvas.getContext();
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = c * tw;
      const sy = r * th;
      const dx = c * (tw + 2) + 1;
      const dy = r * (th + 2) + 1;
      // [sx, sy, sw, sh, dx, dy] — centre, 4 edges, 4 corners.
      const parts: [number, number, number, number, number, number][] = [
        [sx, sy, tw, th, dx, dy],
        [sx, sy, tw, 1, dx, dy - 1],
        [sx, sy + th - 1, tw, 1, dx, dy + th],
        [sx, sy, 1, th, dx - 1, dy],
        [sx + tw - 1, sy, 1, th, dx + tw, dy],
        [sx, sy, 1, 1, dx - 1, dy - 1],
        [sx + tw - 1, sy, 1, 1, dx + tw, dy - 1],
        [sx, sy + th - 1, 1, 1, dx - 1, dy + th],
        [sx + tw - 1, sy + th - 1, 1, 1, dx + tw, dy + th],
      ];
      for (const [a, b, w, h, x, y] of parts) ctx.drawImage(src, a, b, w, h, x, y, w, h);
    }
  }
  canvas.refresh();
  return outKey;
}

type KeyMap =Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>;

function isTypingInField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export class WorldScene extends Phaser.Scene {
  private roomId = '';
  private spawnName = '';
  private arrivedByDoor = false;
  private map!: Phaser.Tilemaps.Tilemap;
  private objects!: MapObjects;
  private player!: Phaser.Physics.Arcade.Sprite;
  private facing: Direction = 'down';
  private moving = false;
  private npcs: NpcRuntime[] = [];
  private zoneCandidates: InteractionCandidate[] = [];
  private keys!: KeyMap;
  private indicator!: Phaser.GameObjects.Image;
  private transitioning = false;
  private interactAllowedAt = 0;
  private cleanups: (() => void)[] = [];

  constructor(private readonly controller: WorldController) {
    super({ key: 'world' });
  }

  init(data: { roomId?: string; spawn?: string }) {
    const def = this.controller.definition;
    this.roomId = data.roomId ?? def.start.roomId;
    this.spawnName = data.spawn ?? def.start.spawn;
    this.arrivedByDoor = data.roomId !== undefined;
  }

  preload() {
    const def = this.controller.definition;
    this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.controller.reportError(`Failed to load ${file.type} '${file.key}' from ${String(file.url)}`);
    });
    if (!this.textures.exists(def.tileset.key)) this.load.image(def.tileset.key, def.tileset.url);
    if (!this.textures.exists(def.indicator.key)) this.load.image(def.indicator.key, def.indicator.url);
    const sprites = new Map([def.player.sprite, ...def.actors.map((a) => a.sprite)].map((s) => [s.key, s.url]));
    for (const [key, url] of sprites) {
      if (!this.textures.exists(key)) this.load.spritesheet(key, url, { frameWidth: FRAME_W, frameHeight: FRAME_H });
    }
    // All rooms are tiny, so load every map up front: transitions are then instant.
    for (const room of def.rooms) {
      if (!this.cache.tilemap.exists(mapCacheKey(room.id))) this.load.tilemapTiledJSON(mapCacheKey(room.id), room.mapUrl);
    }
  }

  create() {
    const def = this.controller.definition;
    this.transitioning = false;
    this.npcs = [];
    this.cleanups = [];

    const cached = this.cache.tilemap.get(mapCacheKey(this.roomId)) as { data: TiledMap } | undefined;
    if (!cached || !this.textures.exists(def.tileset.key)) {
      this.controller.reportError(`Room '${this.roomId}' could not be built: map or tileset missing.`);
      return;
    }

    // ---- map
    this.map = this.make.tilemap({ key: mapCacheKey(this.roomId) });
    const tw = this.map.tileWidth;
    const th = this.map.tileHeight;
    const extruded = extrudeTileset(this, def.tileset.key, tw, th);
    const tiles = this.map.addTilesetImage(def.tileset.tiledName, extruded, tw, th, 1, 2);
    if (!tiles) {
      this.controller.reportError(`Tileset '${def.tileset.tiledName}' not found in room '${this.roomId}'.`);
      return;
    }
    const solid: Phaser.Tilemaps.TilemapLayer[] = [];
    for (const name of ['ground', 'walls', 'furniture'] as const) {
      const layer = this.map.createLayer(name, tiles, 0, 0);
      if (!layer) continue;
      layer.setDepth(LAYER_DEPTH[name]);
      if (name !== 'ground') {
        // Collision comes from the `collides` tile property authored in the Tiled tileset.
        layer.setCollisionByProperty({ collides: true });
        solid.push(layer);
      }
    }
    this.physics.world.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
    this.objects = parseMapObjects(cached.data);

    // ---- animations (once per sprite key, shared across restarts)
    for (const key of new Set([def.player.sprite.key, ...def.actors.map((a) => a.sprite.key)])) this.ensureAnimations(key);

    // ---- player
    const spawn = this.objects.spawns[this.spawnName] ??
      this.objects.spawns[def.start.spawn] ?? { x: this.map.widthInPixels / 2, y: this.map.heightInPixels / 2 };
    this.facing = this.arrivedByDoor ? this.facingAwayFromNearestDoor(spawn) : 'down';
    this.player = this.makeCharacter(spawn, def.player.sprite.key, this.facing);
    this.player.setCollideWorldBounds(true);
    for (const layer of solid) this.physics.add.collider(this.player, layer);

    // ---- NPCs
    for (const actor of def.actors) {
      if (actor.roomId !== this.roomId) continue;
      const point = this.objects.npcPoints[actor.id];
      if (!point) continue;
      const facing = actor.behavior.kind === 'idle' ? (actor.behavior.facing ?? 'down') : 'down';
      const sprite = this.makeCharacter(point, actor.sprite.key, facing);
      sprite.setImmovable(true);
      (sprite.body as Phaser.Physics.Arcade.Body).pushable = false;
      sprite.setCollideWorldBounds(true);
      for (const layer of solid) this.physics.add.collider(sprite, layer);
      this.physics.add.collider(this.player, sprite);
      this.npcs.push({ def: actor, sprite, home: { ...point }, facing, paused: false, goalDeadline: 0, waitUntil: this.time.now + 600 });
    }

    // ---- static interaction zones
    this.zoneCandidates = [];
    for (const zone of this.objects.interactableZones) {
      const it = def.interactables.find((i) => i.id === zone.interactableId && i.roomId === this.roomId);
      if (!it) continue;
      const { x, y, width, height } = zone;
      this.zoneCandidates.push({ id: it.id, kind: 'interactable', prompt: it.interaction.prompt, shape: { rect: { x, y, width, height } } });
    }

    // ---- indicator bubble
    this.indicator = this.add.image(0, 0, def.indicator.key).setOrigin(0.5, 1).setDepth(100).setVisible(false);

    // ---- input (no key capture, so React text fields keep working)
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as KeyMap;
    const onInteractKey = (event: KeyboardEvent) => {
      if (event.repeat || isTypingInField()) return;
      if (this.time.now < this.interactAllowedAt || this.transitioning) return;
      if (this.controller.interact()) this.player.setVelocity(0, 0);
    };
    kb.on('keydown-E', onInteractKey);
    kb.on('keydown-SPACE', onInteractKey);
    this.cleanups.push(() => {
      kb.off('keydown-E', onInteractKey);
      kb.off('keydown-SPACE', onInteractKey);
    });

    // ---- controller events
    const bus = this.controller.bus;
    this.cleanups.push(
      bus.on('mode.changed', ({ mode }) => {
        if (mode === 'exploring') this.interactAllowedAt = this.time.now + INTERACT_COOLDOWN_MS;
        else this.player?.setVelocity(0, 0);
      }),
      bus.on('interaction.started', ({ target }) => {
        if (target.kind !== 'actor') return;
        const npc = this.npcs.find((n) => n.def.id === target.id);
        if (!npc) return;
        npc.paused = true;
        npc.goal = undefined;
        npc.sprite.setVelocity(0, 0);
        npc.facing = facingToward({ x: npc.sprite.x, y: npc.sprite.y }, { x: this.player.x, y: this.player.y });
        this.animate(npc.sprite, npc.def.sprite.key, npc.facing, false);
      }),
      bus.on('interaction.ended', ({ targetId }) => {
        const npc = this.npcs.find((n) => n.def.id === targetId);
        if (npc) {
          npc.paused = false;
          npc.waitUntil = this.time.now + 800;
        }
      }),
    );

    // ---- camera + resize
    const onResize = () => this.layoutCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.cleanups.push(() => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    this.layoutCamera();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.runCleanups());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.runCleanups());

    this.cameras.main.fadeIn(FADE_MS, 0, 0, 0);
    this.controller.roomReady(this.roomId, this.spawnName);
  }

  update(time: number) {
    if (!this.player || this.transitioning) return;

    // ---- player movement
    const canMove = this.controller.canMove() && !isTypingInField();
    const input: InputState = canMove ? this.readInput() : NO_INPUT;
    const v = computeVelocity(input, PLAYER_SPEED);
    this.player.setVelocity(v.x, v.y);
    this.facing = resolveFacing(input, this.facing);
    this.moving = v.x !== 0 || v.y !== 0;
    this.animate(this.player, this.controller.definition.player.sprite.key, this.facing, this.moving);

    // ---- NPCs
    for (const npc of this.npcs) this.updateNpc(npc, time);

    // ---- depth sort characters by feet
    this.player.setDepth(CHARACTER_DEPTH + this.player.y / 10000);
    for (const npc of this.npcs) npc.sprite.setDepth(CHARACTER_DEPTH + npc.sprite.y / 10000);

    // ---- targets and doors
    if (this.controller.mode === 'exploring') {
      const feet = { x: this.player.x, y: this.player.y };
      const candidates: InteractionCandidate[] = [...this.zoneCandidates];
      for (const npc of this.npcs) {
        if (npc.def.interaction) {
          candidates.push({ id: npc.def.id, kind: 'actor', prompt: npc.def.interaction.prompt, shape: { point: { x: npc.sprite.x, y: npc.sprite.y } } });
        }
      }
      const best = findInteractionTarget(feet, this.facing, candidates, PROBE);
      this.controller.setTarget(best ? { id: best.id, kind: best.kind, prompt: best.prompt } : null);

      const door = this.objects.doors.find((d) => pointInRect(feet, d));
      if (door && this.controller.beginTransition(door)) this.startTransition(door);
    }
    this.placeIndicator(time);
  }

  /** Read-only state for debugging and end-to-end tests. */
  snapshot(): SceneSnapshot | null {
    if (!this.player || !this.map) return null;
    return {
      roomId: this.roomId,
      mode: this.controller.mode,
      x: Math.round(this.player.x * 10) / 10,
      y: Math.round(this.player.y * 10) / 10,
      facing: this.facing,
      moving: this.moving,
      targetId: this.controller.target?.id ?? null,
      map: { width: this.map.widthInPixels, height: this.map.heightInPixels, zoom: this.cameras.main.zoom },
    };
  }

  // ------------------------------------------------------------------ helpers

  private runCleanups() {
    const fns = this.cleanups;
    this.cleanups = [];
    for (const fn of fns) fn();
  }

  private readInput(): InputState {
    const k = this.keys;
    return {
      up: k.UP.isDown || k.W.isDown,
      down: k.DOWN.isDown || k.S.isDown,
      left: k.LEFT.isDown || k.A.isDown,
      right: k.RIGHT.isDown || k.D.isDown,
    };
  }

  private makeCharacter(at: Vec2, key: string, facing: Direction): Phaser.Physics.Arcade.Sprite {
    const s = this.physics.add.sprite(at.x, at.y, key, DIR_ROW[facing] * 3);
    s.setOrigin(ORIGIN.x, ORIGIN.y);
    const body = s.body as Phaser.Physics.Arcade.Body;
    body.setSize(BODY.w, BODY.h, false);
    body.setOffset(BODY.offsetX, BODY.offsetY);
    s.setDepth(CHARACTER_DEPTH);
    return s;
  }

  private ensureAnimations(key: string) {
    for (const dir of Object.keys(DIR_ROW) as Direction[]) {
      const animKey = `${key}:walk:${dir}`;
      if (this.anims.exists(animKey)) continue;
      const r = DIR_ROW[dir] * 3;
      this.anims.create({
        key: animKey,
        frames: [r + 1, r, r + 2, r].map((frame) => ({ key, frame })),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  private animate(sprite: Phaser.Physics.Arcade.Sprite, key: string, facing: Direction, moving: boolean) {
    if (moving) {
      sprite.anims.play(`${key}:walk:${facing}`, true);
    } else {
      if (sprite.anims.isPlaying) sprite.anims.stop();
      const frame = DIR_ROW[facing] * 3;
      if (sprite.frame.name !== String(frame)) sprite.setFrame(frame);
    }
  }

  private updateNpc(npc: NpcRuntime, time: number) {
    const s = npc.sprite;
    const behavior = npc.def.behavior;
    if (npc.paused || behavior.kind === 'idle') {
      s.setVelocity(0, 0);
      this.animate(s, npc.def.sprite.key, npc.facing, false);
      return;
    }
    if (!npc.goal) {
      s.setVelocity(0, 0);
      this.animate(s, npc.def.sprite.key, npc.facing, false);
      if (time < npc.waitUntil) return;
      const r = behavior.radiusTiles;
      const tw = this.map.tileWidth;
      npc.goal = {
        x: npc.home.x + Phaser.Math.Between(-r, r) * tw,
        y: npc.home.y + Phaser.Math.Between(-r, r) * tw,
      };
      npc.goalDeadline = time + 3000;
    }
    const dx = npc.goal.x - s.x;
    const dy = npc.goal.y - s.y;
    if (Math.hypot(dx, dy) < 2 || time > npc.goalDeadline) {
      // Arrived (or blocked): rest a moment.
      npc.goal = undefined;
      const [lo, hi] = behavior.pauseMs ?? [800, 2000];
      npc.waitUntil = time + Phaser.Math.Between(lo, hi);
      s.setVelocity(0, 0);
      this.animate(s, npc.def.sprite.key, npc.facing, false);
      return;
    }
    // Move one axis at a time: reads as more "grid-like" and avoids sliding along corners.
    const speed = behavior.speed ?? 30;
    const alongX = Math.abs(dx) >= 2;
    s.setVelocity(alongX ? Math.sign(dx) * speed : 0, alongX ? 0 : Math.sign(dy) * speed);
    npc.facing = alongX ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    this.animate(s, npc.def.sprite.key, npc.facing, true);
  }

  private placeIndicator(time: number) {
    const target = this.controller.target;
    if (!target || this.controller.mode !== 'exploring') {
      this.indicator.setVisible(false);
      return;
    }
    let x: number;
    let top: number;
    const npc = target.kind === 'actor' ? this.npcs.find((n) => n.def.id === target.id) : undefined;
    if (npc) {
      x = npc.sprite.x;
      top = npc.sprite.y - FRAME_H * ORIGIN.y - 1;
    } else {
      const zone = this.zoneCandidates.find((c) => c.id === target.id);
      if (!zone || !('rect' in zone.shape)) return void this.indicator.setVisible(false);
      x = zone.shape.rect.x + zone.shape.rect.width / 2;
      top = zone.shape.rect.y + 2;
    }
    const bob = Math.round(Math.sin(time / 180)); // gentle 1px bob
    this.indicator.setPosition(Math.round(x), Math.round(top) + bob).setVisible(true);
  }

  private facingAwayFromNearestDoor(spawn: Vec2): Direction {
    let nearest: DoorZone | undefined;
    let best = Infinity;
    for (const d of this.objects.doors) {
      const c = { x: d.x + d.width / 2, y: d.y + d.height / 2 };
      const dist = Math.hypot(c.x - spawn.x, c.y - spawn.y);
      if (dist < best) {
        best = dist;
        nearest = d;
      }
    }
    if (!nearest) return 'down';
    return facingToward({ x: nearest.x + nearest.width / 2, y: nearest.y + nearest.height / 2 }, spawn);
  }

  private startTransition(door: DoorZone) {
    this.transitioning = true;
    this.player.setVelocity(0, 0);
    this.animate(this.player, this.controller.definition.player.sprite.key, this.facing, false);
    this.indicator.setVisible(false);
    this.cameras.main.fadeOut(FADE_MS, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ roomId: door.targetRoom, spawn: door.targetSpawn });
    });
  }

  /** Integer zoom for crisp pixels; centre small rooms, follow the player in rooms larger than the view. */
  private layoutCamera() {
    if (!this.map) return;
    const cam = this.cameras.main;
    const { width, height } = this.scale.gameSize;
    const mw = this.map.widthInPixels;
    const mh = this.map.heightInPixels;
    const fit = Math.min(width / mw, height / mh);
    const zoom = Math.max(1, Math.min(MAX_ZOOM, Math.floor(fit)));
    cam.setZoom(zoom);
    if (mw * zoom <= width && mh * zoom <= height) {
      cam.stopFollow();
      cam.removeBounds();
      cam.centerOn(mw / 2, mh / 2);
      cam.setScroll(Math.round(cam.scrollX), Math.round(cam.scrollY));
    } else {
      cam.setBounds(0, 0, mw, mh);
      cam.startFollow(this.player, true, 0.2, 0.2);
    }
  }
}
