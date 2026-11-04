import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  createWorldGame,
  WorldController,
  type ActionDescriptor,
  type DialogueChoice,
  type DialogueScript,
  type InteractionTarget,
  type WorldDefinition,
  type WorldEvent,
  type WorldMode,
} from '../engine';
import { DialogueBox } from './components/DialogueBox';
import type { PanelRegistry } from './panels';

interface UiState {
  mode: WorldMode;
  roomName: string;
  target: InteractionTarget | null;
  /** Bumped on every interaction so the dialogue box remounts at line 1. */
  interactionSeq: number;
  dialogue: DialogueScript | null;
  action: ActionDescriptor | null;
  error: string | null;
}

const INITIAL: UiState = { mode: 'loading', roomName: '', target: null, interactionSeq: 0, dialogue: null, action: null, error: null };

function reduce(state: UiState, ev: WorldEvent): UiState {
  switch (ev.type) {
    case 'mode.changed':
      return { ...state, mode: ev.mode };
    case 'room.entered':
      return { ...state, roomName: ev.roomName };
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
    default:
      return state;
  }
}

interface Props {
  world: WorldDefinition;
  panels: PanelRegistry;
}

/** Hosts one Phaser world and renders the React overlay (prompt, dialogue, domain panels). */
export function GameView({ world, panels }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<WorldController | null>(null);
  const [ui, dispatch] = useReducer(reduce, INITIAL);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const controller = new WorldController(world);
    controllerRef.current = controller;
    const off = controller.bus.onAny(dispatch);
    const handle = createWorldGame(host, controller);
    window.__agentWorld = {
      worldId: world.id,
      mode: () => controller.mode,
      roomId: () => controller.roomId,
      snapshot: () => handle.snapshot(),
    };
    return () => {
      off();
      handle.destroy();
      controllerRef.current = null;
      if (window.__agentWorld?.worldId === world.id) delete window.__agentWorld;
    };
  }, [world]);

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

      {ui.dialogue && <DialogueBox key={ui.interactionSeq} dialogue={ui.dialogue} onChoice={onChoice} onClose={endInteraction} />}

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
