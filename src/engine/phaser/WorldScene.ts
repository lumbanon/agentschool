import Phaser from 'phaser';
import type { WorldController } from '../core/controller';
import { candidateKey, DEFAULT_PROBE, findInteractionTarget, indicatorAnchor, pointInRect, type InteractionCandidate } from '../core/interaction';
import { computeVelocity, facingToward, NO_INPUT, resolveFacing, type InputState } from '../core/movement';
import { parseMapObjects, type TiledMap } from '../core/tiled';
import type { ActorDefinition, Direction, DoorZone, MapObjects, Vec2, WorldMode, PropZone, SeatZone } from '../core/types';

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
const FADE_MS = 180;
/** Ignore the interact key briefly after an interaction closes (key that closed it must not reopen it). */
const INTERACT_COOLDOWN_MS = 250;
const MAX_ZOOM = 5;
const LAYER_DEPTH = { ground: 0, walls: 1, furniture: 2 } as const;
const CHARACTER_DEPTH = 10;

export const mapCacheKey = (roomId: string) => `map:${roomId}`;

const DIRECTIONS: readonly Direction[] = ['down', 'left', 'right', 'up'];
const walkAnimKey = (key: string, dir: Direction) => `${key}:walk:${dir}`;

/**
 * Install or refresh a character sheet supplied at runtime (e.g. composed on a
 * canvas) under `key`. Same-size updates redraw in place, so existing sprites
 * and animations keep working without being rebuilt.
 */
export function upsertCanvasSheet(
  textures: Phaser.Textures.TextureManager,
  anims: Phaser.Animations.AnimationManager,
  key: string,
  source: HTMLCanvasElement,
): void {
  const { width, height } = source;
  let tex = textures.exists(key) ? textures.get(key) : null;
  if (tex && !(tex instanceof Phaser.Textures.CanvasTexture && tex.width === width && tex.height === height)) {
    // Shape changed (or a file texture was loaded first): rebuild texture and its animations.
    for (const dir of DIRECTIONS) if (anims.exists(walkAnimKey(key, dir))) anims.remove(walkAnimKey(key, dir));
    textures.remove(key);
    tex = null;
  }
  if (!tex) {
    const created = textures.createCanvas(key, width, height);
    if (!created) return;
    const cols = Math.floor(width / FRAME_W);
    const rows = Math.floor(height / FRAME_H);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) created.add(r * cols + c, 0, c * FRAME_W, r * FRAME_H, FRAME_W, FRAME_H);
    tex = created;
  }
  const canvasTex = tex as Phaser.Textures.CanvasTexture;
  canvasTex.context.clearRect(0, 0, width, height);
  canvasTex.context.drawImage(source, 0, 0);
  canvasTex.refresh();
}

/** Texture key for a prop overlay (see PropZone). */
export const propTextureKey = (propId: string) => `prop:${propId}`;
/** Optional companion texture with one sitting frame per direction (down, left, right, up). */
export const sitTextureKey = (spriteKey: string) => `${spriteKey}:sit`;
const SIT_FRAME: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };
/** Fallback when a character has no sit frames: hide this many rows (legs) of the standing frame. */
const SIT_FALLBACK_CROP = 5;
const PROP_DEPTH = 1.5; // over wall tiles, under furniture and characters
const AMBIENCE_DEPTH = 50; // over the room and characters, under labels and the indicator

/** Install or refresh a single-image canvas texture (redrawn in place when the size is unchanged). */
export function upsertCanvasTexture(textures: Phaser.Textures.TextureManager, key: string, source: HTMLCanvasElement): void {
  const { width, height } = source;
  let tex = textures.exists(key) ? textures.get(key) : null;
  if (tex && !(tex instanceof Phaser.Textures.CanvasTexture && tex.width === width && tex.height === height)) {
    textures.remove(key);
    tex = null;
  }
  const canvasTex = (tex as Phaser.Textures.CanvasTexture | null) ?? textures.createCanvas(key, width, height);
  if (!canvasTex) return;
  canvasTex.context.clearRect(0, 0, width, height);
  canvasTex.context.drawImage(source, 0, 0);
  canvasTex.refresh();
}

/** Room-wide tint, e.g. dusk or night. `alpha` 0 = none. */
export interface Ambience {
  color: string;
  alpha: number;
}

export interface WorldSceneOptions {
  /** Sprite sheets provided at runtime, by texture key. They replace the definition's sprite URL. */
  spriteSheets?: Map<string, HTMLCanvasElement>;
  /** Text shown above the player (null = none). */
  playerLabel?: string | null;
  /** Prop overlay textures by prop id. */
  propTextures?: Map<string, HTMLCanvasElement>;
  ambience?: Ambience | null;
}

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
  label: { text: string | null; visible: boolean };
  playerTexture: string;
  /** Seat id while seated. */
  seatId: string | null;
  /** Prop ids currently drawn with a runtime texture. */
  props: string[];
  ambienceAlpha: number;
  /** The single interaction indicator (world px). */
  indicator: { visible: boolean; x: number; y: number };
  /** Unique key of the targeted zone / seat / actor (null = nothing in reach). */
  targetKey: string | null;
  /** Interaction position (feet body centre); equals x/y by construction. */
  feet: Vec2;
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
  /** The exact candidate (zone / seat / NPC) currently targeted; the indicator is anchored to it. */
  private targetCandidate: InteractionCandidate | null = null;
  private keys!: KeyMap;
  private indicator!: Phaser.GameObjects.Image;
  private transitioning = false;
  private interactAllowedAt = 0;
  private cleanups: (() => void)[] = [];
  private label?: Phaser.GameObjects.Text;
  private labelText: string | null;
  private inputEnabled = true;
  private readonly spriteSheets: Map<string, HTMLCanvasElement>;
  private readonly propTextures: Map<string, HTMLCanvasElement>;
  private propImages: { zone: PropZone; image: Phaser.GameObjects.Image }[] = [];
  private ambience: Ambience | null;
  private ambienceRect?: Phaser.GameObjects.Rectangle;
  /** Where the player stood before sitting (restored on stand). */
  private standPos: Vec2 | null = null;
  private seated: SeatZone | null = null;

  constructor(
    private readonly controller: WorldController,
    options: WorldSceneOptions = {},
  ) {
    super({ key: 'world' });
    this.spriteSheets = options.spriteSheets ?? new Map();
    this.labelText = options.playerLabel ?? null;
    this.propTextures = options.propTextures ?? new Map();
    this.ambience = options.ambience ?? null;
  }

  /** Supply or update the texture of every prop with this id (live). */
  setPropTexture(propId: string, source: HTMLCanvasElement): void {
    this.propTextures.set(propId, source);
    if (!this.sys.game?.isRunning) return;
    upsertCanvasTexture(this.sys.game.textures, propTextureKey(propId), source);
    this.refreshProps();
  }

  setAmbience(ambience: Ambience | null): void {
    this.ambience = ambience;
    this.applyAmbience();
  }

  /** Replace a character sheet at runtime (live, keeps room and position). */
  setSpriteSheet(key: string, source: HTMLCanvasElement): void {
    this.spriteSheets.set(key, source);
    if (this.sys.game?.isRunning) upsertCanvasSheet(this.sys.game.textures, this.sys.game.anims, key, source);
    if (this.seated) this.applySeatedPose();
  }

  setPlayerLabel(text: string | null): void {
    this.labelText = text && text.length > 0 ? text : null;
    this.label?.setText(this.labelText ?? '');
  }

  /** Disable keyboard handling while an overlay outside the world (e.g. a form) is open. */
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    const kb = this.player ? this.input.keyboard : null;
    if (kb) {
      kb.enabled = enabled;
      if (!enabled) kb.resetKeys();
    }
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
      const runtime = this.spriteSheets.get(key);
      if (runtime) upsertCanvasSheet(this.textures, this.anims, key, runtime);
      else if (!this.textures.exists(key)) this.load.spritesheet(key, url, { frameWidth: FRAME_W, frameHeight: FRAME_H });
      const sit = this.spriteSheets.get(sitTextureKey(key));
      if (sit) upsertCanvasSheet(this.textures, this.anims, sitTextureKey(key), sit);
    }
    for (const [propId, source] of this.propTextures) upsertCanvasTexture(this.textures, propTextureKey(propId), source);
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
    this.seated = null;
    this.standPos = null;

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
    this.targetCandidate = null;
    this.objects.interactableZones.forEach((zone, i) => {
      const it = def.interactables.find((d) => d.id === zone.interactableId && d.roomId === this.roomId);
      if (!it) return;
      const { x, y, width, height } = zone;
      // key: one per physical zone, even when zones share an interactable id
      this.zoneCandidates.push({ id: it.id, key: `zone:${i}`, kind: 'interactable', prompt: it.interaction.prompt, shape: { rect: { x, y, width, height } } });
    });
    for (const seat of this.objects.seats) {
      const { x, y, width, height } = seat;
      this.zoneCandidates.push({ id: seat.id, key: `seat:${seat.id}`, kind: 'seat', prompt: seat.prompt, shape: { rect: { x, y, width, height } } });
    }

    // ---- runtime-textured props (clock faces, window views, ...) and room ambience
    this.propImages = this.objects.props.map((zone) => ({
      zone,
      image: this.add.image(zone.x, zone.y, '__DEFAULT').setOrigin(0, 0).setDepth(PROP_DEPTH).setVisible(false),
    }));
    this.refreshProps();
    this.ambienceRect = this.add
      .rectangle(0, 0, this.map.widthInPixels, this.map.heightInPixels, 0x000000, 0)
      .setOrigin(0, 0)
      .setDepth(AMBIENCE_DEPTH);
    this.applyAmbience();

    // ---- indicator bubble
    this.indicator = this.add.image(0, 0, def.indicator.key).setOrigin(0.5, 1).setDepth(100).setVisible(false);

    // ---- player name label (crisp: rendered at camera zoom, see layoutCamera)
    this.label = this.add
      .text(0, 0, this.labelText ?? '', {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '6px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: 'rgba(20, 16, 28, 0.72)',
        padding: { x: 2, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(99)
      .setVisible(false);

    // ---- input (no key capture, so React text fields keep working)
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as KeyMap;
    kb.enabled = this.inputEnabled;
    const onInteractKey = (event: KeyboardEvent) => {
      if (event.repeat || isTypingInField()) return;
      if (this.time.now < this.interactAllowedAt || this.transitioning) return;
      if (this.controller.mode === 'seated') this.controller.stand();
      else if (this.controller.interact()) this.player.setVelocity(0, 0);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.repeat || isTypingInField()) return;
      if (this.controller.mode === 'seated') this.controller.stand();
    };
    kb.on('keydown-E', onInteractKey);
    kb.on('keydown-SPACE', onInteractKey);
    kb.on('keydown-ESC', onEscape);
    this.cleanups.push(() => {
      kb.off('keydown-E', onInteractKey);
      kb.off('keydown-SPACE', onInteractKey);
      kb.off('keydown-ESC', onEscape);
    });

    // ---- controller events
    const bus = this.controller.bus;
    this.cleanups.push(
      bus.on('mode.changed', ({ mode }) => {
        if (mode === 'exploring' || mode === 'seated') this.interactAllowedAt = this.time.now + INTERACT_COOLDOWN_MS;
        if (mode !== 'exploring') this.player?.setVelocity(0, 0);
      }),
      bus.on('seat.entered', ({ seatId }) => {
        const seat = this.objects.seats.find((st) => st.id === seatId);
        if (!seat) return;
        this.standPos = { x: this.player.x, y: this.player.y };
        this.seated = seat;
        this.facing = seat.facing;
        (this.player.body as Phaser.Physics.Arcade.Body).reset(seat.sit.x, seat.sit.y);
        this.applySeatedPose();
      }),
      bus.on('seat.left', () => {
        const back = this.standPos;
        this.seated = null;
        this.standPos = null;
        this.player.setCrop();
        this.player.setTexture(this.controller.definition.player.sprite.key, DIR_ROW[this.facing] * 3);
        if (back) (this.player.body as Phaser.Physics.Arcade.Body).reset(back.x, back.y);
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
    const canMove = this.controller.canMove() && this.inputEnabled && !isTypingInField();
    const input: InputState = canMove ? this.readInput() : NO_INPUT;
    const v = computeVelocity(input, PLAYER_SPEED);
    this.player.setVelocity(v.x, v.y);
    this.facing = resolveFacing(input, this.facing);
    this.moving = v.x !== 0 || v.y !== 0;
    if (!this.seated) this.animate(this.player, this.controller.definition.player.sprite.key, this.facing, this.moving);

    // ---- NPCs
    for (const npc of this.npcs) this.updateNpc(npc, time);

    // ---- depth sort characters by feet
    this.player.setDepth(CHARACTER_DEPTH + this.player.y / 10000);
    for (const npc of this.npcs) npc.sprite.setDepth(CHARACTER_DEPTH + npc.sprite.y / 10000);

    // ---- targets and doors
    if (this.controller.mode === 'exploring') {
      const feet = this.feet();
      const candidates: InteractionCandidate[] = [...this.zoneCandidates];
      for (const npc of this.npcs) {
        if (npc.def.interaction) {
          candidates.push({ id: npc.def.id, key: `actor:${npc.def.id}`, kind: 'actor', prompt: npc.def.interaction.prompt, shape: { point: { x: npc.sprite.x, y: npc.sprite.y } } });
        }
      }
      const current = this.targetCandidate ? candidateKey(this.targetCandidate) : null;
      const best = findInteractionTarget(feet, this.facing, candidates, { ...DEFAULT_PROBE, current });
      this.targetCandidate = best;
      this.controller.setTarget(best ? { id: best.id, kind: best.kind, prompt: best.prompt } : null);

      const door = this.objects.doors.find((d) => pointInRect(feet, d));
      if (door && this.controller.beginTransition(door)) this.startTransition(door);
    } else {
      // dialogue, panel, seat or transition: nothing is targeted until exploring resumes
      this.targetCandidate = null;
    }
    this.placeIndicator(time);
    this.placeLabel();
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
      label: { text: this.labelText, visible: !!this.label?.visible },
      playerTexture: this.player.texture.key,
      seatId: this.seated?.id ?? null,
      props: this.propImages.filter((p) => p.image.visible).map((p) => p.zone.propId),
      ambienceAlpha: this.ambienceRect?.visible ? this.ambienceRect.fillAlpha : 0,
      indicator: { visible: !!this.indicator?.visible, x: Math.round(this.indicator?.x ?? 0), y: Math.round(this.indicator?.y ?? 0) },
      targetKey: this.targetCandidate ? candidateKey(this.targetCandidate) : null,
      feet: { x: Math.round(this.feet().x * 10) / 10, y: Math.round(this.feet().y * 10) / 10 },
    };
  }

  // ------------------------------------------------------------------ helpers

  /** Sitting frame from the companion `<key>:sit` sheet, or a cropped standing frame as fallback. */
  private applySeatedPose() {
    if (!this.seated || !this.player) return;
    const key = this.controller.definition.player.sprite.key;
    this.player.anims.stop();
    this.moving = false;
    if (this.textures.exists(sitTextureKey(key))) {
      this.player.setCrop();
      this.player.setTexture(sitTextureKey(key), SIT_FRAME[this.facing]);
    } else {
      this.player.setTexture(key, DIR_ROW[this.facing] * 3);
      this.player.setCrop(0, 0, FRAME_W, FRAME_H - SIT_FALLBACK_CROP);
    }
  }

  private refreshProps() {
    for (const { zone, image } of this.propImages) {
      const key = propTextureKey(zone.propId);
      if (!this.textures.exists(key)) continue;
      if (image.texture.key !== key) image.setTexture(key);
      image.setDisplaySize(zone.width, zone.height).setVisible(true);
    }
  }

  private applyAmbience() {
    if (!this.ambienceRect) return;
    const a = this.ambience;
    if (!a || a.alpha <= 0) {
      this.ambienceRect.setVisible(false);
      return;
    }
    this.ambienceRect.setFillStyle(Phaser.Display.Color.HexStringToColor(a.color).color, Math.min(1, a.alpha)).setVisible(true);
  }

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
      const animKey = walkAnimKey(key, dir);
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

  /** Shown only for the candidate that pressing E would activate right now. */
  private placeIndicator(time: number) {
    const c = this.targetCandidate;
    const target = this.controller.target;
    if (!c || !target || target.id !== c.id || this.controller.mode !== 'exploring') {
      this.indicator.setVisible(false);
      return;
    }
    const anchor = indicatorAnchor(c.shape, FRAME_H * ORIGIN.y + 1);
    const bob = Math.round(Math.sin(time / 180)); // gentle 1px bob
    this.indicator.setPosition(Math.round(anchor.x), Math.round(anchor.y) + bob).setVisible(true);
  }

  /** The player's interaction position: the centre of the feet physics body (what actually collides). */
  private feet(): Vec2 {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    return { x: body.center.x, y: body.center.y };
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
    this.targetCandidate = null;
    this.cameras.main.fadeOut(FADE_MS, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ roomId: door.targetRoom, spawn: door.targetSpawn });
    });
  }

  /** Integer zoom for crisp pixels; centre small rooms, follow the player in rooms larger than the view. */
  /** Name above the player while exploring; hidden when a prompt or interaction needs the space. */
  private placeLabel() {
    if (!this.label) return;
    const show = !!this.labelText && this.controller.mode === 'exploring' && !this.controller.target;
    this.label.setVisible(show);
    if (show) this.label.setPosition(Math.round(this.player.x), Math.round(this.player.y - FRAME_H * ORIGIN.y - 2));
  }

  private layoutCamera() {
    if (!this.map) return;
    const cam = this.cameras.main;
    const { width, height } = this.scale.gameSize;
    const mw = this.map.widthInPixels;
    const mh = this.map.heightInPixels;
    const fit = Math.min(width / mw, height / mh);
    const zoom = Math.max(1, Math.min(MAX_ZOOM, Math.floor(fit)));
    cam.setZoom(zoom);
    this.label?.setResolution(Math.min(8, zoom * (window.devicePixelRatio || 1)));
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
