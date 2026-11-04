import { useCallback, useEffect, useMemo, useState } from 'react';
import { profileFromDraft, sheetCanvas, sitSheetCanvas } from '../characters/appearance';
import { CharacterCreator } from '../characters/components/CharacterCreator';
import { newDraft, normalizeSelection } from '../characters/customization/wardrobe';
import { clearProfile, loadProfile, saveProfile } from '../characters/persistence';
import type { CharacterDraft, CharacterProfile } from '../characters/types';
import { DOMAIN_PANELS } from '../domains';
import { characterSpecForWorld, WARDROBE_NORMALIZERS, WARDROBES } from '../domains/characters';
import type { WorldMode } from '../engine';
import { parseClockTime } from '../environment/time';
import { useEnvironment } from '../environment/useEnvironment';
import { DEFAULT_WORLD_ID, WORLDS } from '../worlds/registry';
import { ConfirmDialog } from './components/ConfirmDialog';
import { GameView } from './GameView';
import { WorldSelector } from './components/WorldSelector';

const CATALOG = WARDROBES.school;

function initialWorldId(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('world');
  return fromUrl && WORLDS[fromUrl] ? fromUrl : DEFAULT_WORLD_ID;
}

/** Demo / QA override: `?mytime=19:45` pins the Malaysia clock (24 h). */
const FIXED_TIME = parseClockTime(new URLSearchParams(window.location.search).get('mytime'));

function initialProfile(): CharacterProfile | null {
  const { profile, issues } = loadProfile(WARDROBE_NORMALIZERS);
  if (issues.length) console.warn('[character] stored character was repaired or ignored:', issues);
  return profile;
}

function draftFrom(profile: CharacterProfile | null): CharacterDraft {
  if (!profile) return newDraft(CATALOG);
  const { presentation } = profile.identity;
  return {
    identity: { ...profile.identity },
    body: { ...profile.body },
    selection: profile.wardrobe[CATALOG.id] ?? normalizeSelection(CATALOG, presentation, null),
  };
}

type Editor = 'create' | 'edit' | null;

export function App() {
  const [worldId, setWorldId] = useState(initialWorldId);
  const world = WORLDS[worldId];
  const [profile, setProfile] = useState(initialProfile);
  // First visit to the school: the creator comes before the world.
  const [editor, setEditor] = useState<Editor>(() => (profile?.creationComplete || initialWorldId() !== 'school' ? null : 'create'));
  const [confirmReset, setConfirmReset] = useState(false);
  const [gameMode, setGameMode] = useState<WorldMode>('loading');

  const hasCharacter = !!profile?.creationComplete;
  const select = useCallback(
    (id: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set('world', id);
      window.history.replaceState(null, '', url);
      setWorldId(id);
      // The creator gates the school only; the office works with its default sprite.
      setEditor((e) => (id === 'school' ? (hasCharacter ? e : 'create') : e === 'create' ? null : e));
    },
    [hasCharacter],
  );

  const spec = useMemo(() => characterSpecForWorld(world.id, profile), [world.id, profile]);
  const playerSheet = useMemo(() => (spec ? sheetCanvas(spec) : null), [spec]);
  const playerSitSheet = useMemo(() => (spec ? sitSheetCanvas(spec) : null), [spec]);
  const env = useEnvironment(FIXED_TIME);
  const { setRoom } = env;
  const onRoomChange = useCallback((roomId: string) => setRoom(`${world.id}/${roomId}`), [setRoom, world.id]);
  const playerName = profile?.creationComplete ? profile.identity.name : null;

  const persist = useCallback(
    (draft: CharacterDraft) => {
      const next = profileFromDraft(draft, CATALOG.id, profile);
      setProfile(next);
      return saveProfile(next);
    },
    [profile],
  );

  const doReset = () => {
    clearProfile();
    setProfile(null);
    setConfirmReset(false);
    setEditor('create');
  };

  useEffect(() => {
    if (editor !== 'edit') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setEditor(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const canUseCharacterMenu = editor === null && gameMode === 'exploring';
  const creator = editor && (
    <CharacterCreator
      key={editor}
      catalog={CATALOG}
      initial={draftFrom(profile)}
      mode={editor}
      title={editor === 'create' ? 'Create your student' : 'Edit your character'}
      subtitle={
        editor === 'create'
          ? 'Choose a name and a Malaysian secondary-school uniform. You can change everything later.'
          : 'Changes apply to your character in every room as soon as you save.'
      }
      enterLabel={editor === 'create' && world.id === 'school' ? 'Enter School' : world.id === 'school' ? 'Back to School' : 'Done'}
      onSave={persist}
      onEnter={(d) => {
        persist(d);
        setEditor(null);
      }}
      onCancel={editor === 'edit' ? () => setEditor(null) : undefined}
    />
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>AgentSchool</strong> <span className="phase">Phase 0 · world prototype</span>
        </div>
        <div className="topbar-right">
          {editor !== 'create' && (
            <div className="character-menu" aria-label="Character">
              {profile?.creationComplete ? (
                <>
                  <span className="character-chip" data-testid="character-chip" title="Your character">
                    {profile.identity.name}
                  </span>
                  <button disabled={!canUseCharacterMenu} onClick={() => setEditor('edit')} data-testid="edit-character">
                    Edit character
                  </button>
                  <button disabled={!canUseCharacterMenu} onClick={() => setConfirmReset(true)} data-testid="reset-character">
                    Reset
                  </button>
                </>
              ) : (
                <button disabled={editor !== null} onClick={() => setEditor('create')} data-testid="create-character">
                  Create character
                </button>
              )}
            </div>
          )}
          <WorldSelector worlds={Object.values(WORLDS)} current={worldId} onSelect={select} />
        </div>
      </header>
      <div className="mock-notice" data-testid="mock-notice">
        Prototype: all dialogue and lessons are hand-written mock content. No AI agents, no backend, no grading.
      </div>
      <main className="stage">
        {editor === 'create' ? (
          <div className="creator-page">{creator}</div>
        ) : (
          <>
            {/* key: switching worlds (or default <-> custom sprite) boots a fresh game on the same engine. */}
            <GameView
              key={`${world.id}:${spec ? 'custom' : 'default'}`}
              world={world}
              panels={DOMAIN_PANELS}
              effects={env.effects}
              playerSheet={playerSheet}
              playerSitSheet={playerSitSheet}
              playerName={playerName}
              dialogueVars={env.dialogueVars}
              propTextures={env.propTextures}
              ambience={env.ambience}
              onRoomChange={onRoomChange}
              inputEnabled={editor === null && !confirmReset}
              onModeChange={setGameMode}
            />
            {editor && <div className="creator-overlay">{creator}</div>}
          </>
        )}
        {confirmReset && (
          <ConfirmDialog
            title="Reset character?"
            message="This deletes your saved name, uniform and colours from this browser. Lesson progress is kept."
            confirmLabel="Reset character"
            onConfirm={doReset}
            onCancel={() => setConfirmReset(false)}
          />
        )}
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
