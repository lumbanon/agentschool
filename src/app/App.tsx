import { useCallback, useState } from 'react';
import { DOMAIN_PANELS } from '../domains';
import { DEFAULT_WORLD_ID, WORLDS } from '../worlds/registry';
import { GameView } from './GameView';
import { WorldSelector } from './components/WorldSelector';

function initialWorldId(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('world');
  return fromUrl && WORLDS[fromUrl] ? fromUrl : DEFAULT_WORLD_ID;
}

export function App() {
  const [worldId, setWorldId] = useState(initialWorldId);
  const world = WORLDS[worldId];

  const select = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('world', id);
    window.history.replaceState(null, '', url);
    setWorldId(id);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>AgentSchool</strong> <span className="phase">Phase 0 · world prototype</span>
        </div>
        <WorldSelector worlds={Object.values(WORLDS)} current={worldId} onSelect={select} />
      </header>
      <div className="mock-notice" data-testid="mock-notice">
        Prototype: all dialogue and lessons are hand-written mock content. No AI agents, no backend, no grading.
      </div>
      <main className="stage">
        {/* key: switching worlds tears down the Phaser game and boots a fresh one with the same engine. */}
        <GameView key={world.id} world={world} panels={DOMAIN_PANELS} />
      </main>
      <footer className="controls-hint">
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> / arrows: move
        </span>
        <span>
          <kbd>E</kbd> / <kbd>Space</kbd>: interact
        </span>
        <span>
          <kbd>Esc</kbd>: close
        </span>
      </footer>
    </div>
  );
}
