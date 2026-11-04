import { WorldEventBus } from './eventBus';
import type {
  ActionDescriptor,
  DialogueChoice,
  DialogueScript,
  DoorZone,
  InteractionDefinition,
  InteractionTarget,
  WorldDefinition,
  WorldMode,
} from './types';

export interface ActiveInteraction {
  target: InteractionTarget;
  dialogue?: DialogueScript;
}

/**
 * Renderer-independent world state machine.
 *
 *   loading ──► exploring ◄──► interacting
 *                   │  ▲
 *                   ▼  │
 *              transitioning
 *
 * The Phaser scene asks `canMove()` every frame and reports targets/doors;
 * the React layer calls `chooseDialogueChoice()` / `endInteraction()`.
 * Domain logic never lives here — actions are emitted as opaque descriptors.
 */
export class WorldController {
  private _mode: WorldMode = 'loading';
  private _roomId: string;
  private _target: InteractionTarget | null = null;
  private _active: ActiveInteraction | null = null;

  constructor(
    readonly definition: WorldDefinition,
    readonly bus: WorldEventBus = new WorldEventBus(),
  ) {
    this._roomId = definition.start.roomId;
  }

  get mode(): WorldMode {
    return this._mode;
  }
  get roomId(): string {
    return this._roomId;
  }
  get target(): InteractionTarget | null {
    return this._target;
  }
  get activeInteraction(): ActiveInteraction | null {
    return this._active;
  }

  canMove(): boolean {
    return this._mode === 'exploring';
  }

  private setMode(mode: WorldMode) {
    if (mode === this._mode) return;
    this._mode = mode;
    this.bus.emit({ type: 'mode.changed', mode });
  }

  /** Called once the first room is ready. */
  roomReady(roomId: string, spawn: string): void {
    const first = this._mode === 'loading';
    this._roomId = roomId;
    this.setMode('exploring');
    if (first) this.bus.emit({ type: 'world.loaded', worldId: this.definition.id });
    const room = this.definition.rooms.find((r) => r.id === roomId);
    this.bus.emit({ type: 'room.entered', roomId, roomName: room?.displayName ?? roomId, spawn });
  }

  /** The scene reports what is in front of the player. Ignored unless exploring. */
  setTarget(target: InteractionTarget | null): void {
    if (this._mode !== 'exploring') return;
    if (target?.id === this._target?.id) return;
    this._target = target;
    this.bus.emit({ type: 'interaction.targetChanged', target });
  }

  private resolveInteraction(target: InteractionTarget): InteractionDefinition | undefined {
    if (target.kind === 'actor') return this.definition.actors.find((a) => a.id === target.id)?.interaction;
    return this.definition.interactables.find((i) => i.id === target.id)?.interaction;
  }

  /** Player pressed the interact key. Returns true if an interaction started. */
  interact(): boolean {
    if (this._mode !== 'exploring' || !this._target) return false;
    const target = this._target;
    const def = this.resolveInteraction(target);
    if (!def) return false;
    this._active = { target, dialogue: def.dialogue };
    // Hide the prompt while interacting.
    this._target = null;
    this.bus.emit({ type: 'interaction.targetChanged', target: null });
    this.setMode('interacting');
    this.bus.emit({ type: 'interaction.started', target, dialogue: def.dialogue });
    if (!def.dialogue && def.action) this.requestAction(def.action);
    return true;
  }

  /** UI picked a dialogue option. */
  chooseDialogueChoice(choice: DialogueChoice): void {
    if (this._mode !== 'interacting') return;
    if (choice.action) {
      this.requestAction(choice.action);
      if (choice.closes) this.endInteraction();
      return;
    }
    if (choice.closes !== false) this.endInteraction();
  }

  /** Forward a domain action. The interaction stays open until the UI ends it. */
  requestAction(action: ActionDescriptor): void {
    if (this._mode !== 'interacting' || !this._active) return;
    this.bus.emit({ type: 'action.requested', action, sourceId: this._active.target.id });
  }

  endInteraction(): void {
    if (this._mode !== 'interacting' || !this._active) return;
    const targetId = this._active.target.id;
    this._active = null;
    this.setMode('exploring');
    this.bus.emit({ type: 'interaction.ended', targetId });
  }

  /** The scene detected the player inside a door zone. Returns true if the transition may proceed. */
  beginTransition(door: DoorZone): boolean {
    if (this._mode !== 'exploring') return false;
    if (!this.definition.rooms.some((r) => r.id === door.targetRoom)) return false;
    this._target = null;
    this.bus.emit({ type: 'interaction.targetChanged', target: null });
    this.setMode('transitioning');
    this.bus.emit({
      type: 'transition.started',
      transition: { fromRoom: this._roomId, toRoom: door.targetRoom, spawn: door.targetSpawn },
    });
    return true;
  }

  /** The renderer failed (e.g. an asset did not load). Surfaced to the UI; does not change mode. */
  reportError(message: string): void {
    this.bus.emit({ type: 'world.error', message });
  }
}
