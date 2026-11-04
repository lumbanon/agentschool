import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  createWorldGame,
  sitTextureKey,
  WorldController,
  type ActionDescriptor,
  type Ambience,
  type DialogueChoice,
  type DialogueScript,
  type InteractionTarget,
  type WorldDefinition,
  type WorldEvent,
  type WorldGameHandle,
  type WorldMode,
} from '../engine';
import { DialogueBox } from './components/DialogueBox';
import type { EffectRegistry, PanelRegistry } from './panels';

interface UiState {
  mode: WorldMode;
  roomId: string | null;
  roomName: string;
  target: InteractionTarget | null;
  /** Bumped on every interaction so the dialogue box remounts at line 1. */
  interactionSeq: number;
  dialogue: DialogueScript | null;
  action: ActionDescriptor | null;
  error: string | null;
  toast: { id: number; message: string } | null;
}

const INITIAL: UiState = {
  mode: 'loading',
  roomId: null,
  roomName: '',
  target: null,
  interactionSeq: 0,
  dialogue: null,
  action: null,
  error: null,
  toast: null,
};

type UiEvent = WorldEvent | { type: 'ui.toast'; message: string } | { type: 'ui.toastClear'; id: number };

function reduce(state: UiState, ev: UiEvent): UiState {
  switch (ev.type) {
    case 'mode.changed':
      return { ...state, mode: ev.mode };
    case 'room.entered':
      return { ...state, roomId: ev.roomId, roomName: ev.roomName };
    case 'interaction.targetChanged':
      return { ...state, target: ev.target };
    case 'interaction.started':
      return { ...state, interactionSeq: state.interactionSeq + 1, dialogue: ev.dialogue ?? null, action: null };
    case 'action.requested':
      return { ...state, dialogue: null, action: ev.action };
    case 'interaction.ended':
      return { ...state, dialogue: null, action: null };
    case 'world.error':
      return { ...state, error: ev.message };
    case 'ui.toast':
      return { ...state, toast: { id: (state.toast?.id ?? 0) + 1, message: ev.message } };
    case 'ui.toastClear':
      return state.toast?.id === ev.id ? { ...state, toast: null } : state;
    default:
      return state;
  }
}

const TOAST_MS = 2500;

interface Props {
  world: WorldDefinition;
  panels: PanelRegistry;
  /** Actions handled without a panel (e.g. a light switch). */
  effects?: EffectRegistry;
  /** Composed sheet for the player (null = the world's default sprite). Updated live. */
  playerSheet?: HTMLCanvasElement | null;
  /** Sitting frames for the player (engine `<key>:sit` texture). */
  playerSitSheet?: HTMLCanvasElement | null;
  /** Name shown above the player and substituted for {playerName} in dialogue. */
  playerName?: string | null;
  /** Extra `{name}` values for dialogue (e.g. the current time). */
  dialogueVars?: Record<string, string>;
  /** Runtime textures for the map's `prop` objects, by prop id. Updated live. */
  propTextures?: Record<string, HTMLCanvasElement>;
  ambience?: Ambience | null;
  /** False while a UI layer outside the world (e.g. the character editor) has focus. */
  inputEnabled?: boolean;
  onModeChange?: (mode: WorldMode) => void;
  onRoomChange?: (roomId: string) => void;
}

/** Hosts one Phaser world and renders the React overlay (prompt, dialogue, domain panels). */
export function GameView({
  world,
  panels,
  effects = {},
  playerSheet = null,
  playerSitSheet = null,
  playerName = null,
  dialogueVars: extraVars,
  propTextures = {},
  ambience = null,
  inputEnabled = true,
  onModeChange,
  onRoomChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<WorldController | null>(null);
  const handleRef = useRef<WorldGameHandle | null>(null);
  const [ui, dispatch] = useReducer(reduce, INITIAL);
  // Latest values for the one-time game boot below (and for effect handlers).
  const latest = useRef({ playerSheet, playerSitSheet, playerName, inputEnabled, propTextures, ambience, effects });
  latest.current = { playerSheet, playerSitSheet, playerName, inputEnabled, propTextures, ambience, effects };
  const playerKey = world.player.sprite.key;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const controller = new WorldController(world);
    controllerRef.current = controller;
    const off = controller.bus.onAny((ev) => {
      // Effect actions (no panel): run, confirm with a toast, and hand control straight back.
      if (ev.type === 'action.requested') {
        const effect = latest.current.effects[ev.action.kind];
        if (effect) {
          const message = effect(ev.action, { worldId: world.id, roomId: controller.roomId });
          if (message) dispatch({ type: 'ui.toast', message });
          controller.endInteraction();
          return;
        }
      }
      dispatch(ev);
    });
    const boot = latest.current;
    const key = world.player.sprite.key;
    const handle = createWorldGame(host, controller, {
      spriteSheets: {
        ...(boot.playerSheet ? { [key]: boot.playerSheet } : {}),
        ...(boot.playerSitSheet ? { [sitTextureKey(key)]: boot.playerSitSheet } : {}),
      },
      playerLabel: boot.playerName,
      propTextures: boot.propTextures,
      ambience: boot.ambience,
    });
    handle.setInputEnabled(boot.inputEnabled);
    handleRef.current = handle;
    window.__agentWorld = {
      worldId: world.id,
      mode: () => controller.mode,
      roomId: () => controller.roomId,
      snapshot: () => handle.snapshot(),
      playerTextureKey: world.player.sprite.key,
      textureSignature: (k) => handle.textureSignature(k),
    };
    return () => {
      off();
      handle.destroy();
      handleRef.current = null;
      controllerRef.current = null;
      if (window.__agentWorld?.worldId === world.id) delete window.__agentWorld;
    };
  }, [world]);

  useEffect(() => {
    if (playerSheet) handleRef.current?.setSpriteSheet(playerKey, playerSheet);
  }, [playerSheet, playerKey]);
  useEffect(() => {
    if (playerSitSheet) handleRef.current?.setSpriteSheet(sitTextureKey(playerKey), playerSitSheet);
  }, [playerSitSheet, playerKey]);
  useEffect(() => {
    for (const [propId, canvas] of Object.entries(propTextures)) handleRef.current?.setPropTexture(propId, canvas);
  }, [propTextures]);
  useEffect(() => handleRef.current?.setAmbience(ambience), [ambience]);
  useEffect(() => handleRef.current?.setPlayerLabel(playerName), [playerName]);
  useEffect(() => handleRef.current?.setInputEnabled(inputEnabled), [inputEnabled]);
  useEffect(() => onModeChange?.(ui.mode), [ui.mode, onModeChange]);
  useEffect(() => {
    if (ui.roomId) onRoomChange?.(ui.roomId);
  }, [ui.roomId, onRoomChange]);
  useEffect(() => {
    if (!ui.toast) return;
    const id = ui.toast.id;
    const t = window.setTimeout(() => dispatch({ type: 'ui.toastClear', id }), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [ui.toast]);

  const dialogueVars = useMemo(() => ({ ...extraVars, playerName: playerName || 'there' }), [extraVars, playerName]);

  const onChoice = useCallback((choice: DialogueChoice) => controllerRef.current?.chooseDialogueChoice(choice), []);
  const endInteraction = useCallback(() => controllerRef.current?.endInteraction(), []);

  const Panel = ui.action ? panels[ui.action.kind] : undefined;

  return (
    <div className="game-view" data-testid="game-view" data-mode={ui.mode} data-world={world.id}>
      <div className="game-canvas" ref={hostRef} data-testid="game-canvas" />

      <div className="hud">
        <span className="hud-room" data-testid="room-name">
          {ui.roomName || 'Loading…'}
        </span>
      </div>

      {ui.mode === 'loading' && !ui.error && <div className="loading">Loading world…</div>}
      {ui.error && (
        <div className="error-banner" role="alert" data-testid="world-error">
          {ui.error}
        </div>
      )}

      {ui.target && ui.mode === 'exploring' && (
        <div className="prompt" data-testid="interaction-prompt">
          <kbd>E</kbd> {ui.target.prompt}
        </div>
      )}
      {ui.mode === 'seated' && (
        <div className="prompt" data-testid="interaction-prompt">
          <kbd>E</kbd> / <kbd>Esc</kbd> Stand up
        </div>
      )}

      {ui.toast && (
        <div className="toast" role="status" data-testid="toast" key={ui.toast.id}>
          {ui.toast.message}
        </div>
      )}

      {ui.dialogue && <DialogueBox key={ui.interactionSeq} dialogue={ui.dialogue} onChoice={onChoice} onClose={endInteraction} vars={dialogueVars} />}

      {ui.action && (
        <div className="panel-backdrop" data-testid="panel-backdrop">
          {Panel ? (
            <Panel action={ui.action} onClose={endInteraction} />
          ) : (
            <section className="panel" role="dialog" aria-label="Unknown action">
              <h2>No panel registered</h2>
              <p>
                Action <code>{ui.action.kind}</code> has no React panel.
              </p>
              <button onClick={endInteraction}>Close</button>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
