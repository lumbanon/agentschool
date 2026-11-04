import type { WorldDefinition } from '../../engine';

interface Props {
  worlds: readonly WorldDefinition[];
  current: string;
  onSelect: (id: string) => void;
}

export function WorldSelector({ worlds, current, onSelect }: Props) {
  return (
    <nav className="world-selector" aria-label="Environment">
      <span className="world-selector-label">Environment</span>
      {worlds.map((w) => (
        <button
          key={w.id}
          aria-pressed={w.id === current}
          data-testid={`world-${w.id}`}
          // Blur after click so Space (the interact key) never re-presses this button.
          onClick={(e) => {
            e.currentTarget.blur();
            if (w.id !== current) onSelect(w.id);
          }}
        >
          {w.displayName}
        </button>
      ))}
    </nav>
  );
}
