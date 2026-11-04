import { useEffect, useRef, useState } from 'react';
import type { DialogueChoice, DialogueScript } from '../../engine';
import { SourceBadge } from './SourceBadge';

interface Props {
  dialogue: DialogueScript;
  onChoice: (choice: DialogueChoice) => void;
  onClose: () => void;
}

/** Bottom-of-screen dialogue. Space / Enter / E advance; 1–9 pick a choice; Esc leaves. */
export function DialogueBox({ dialogue, onChoice, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const line = dialogue.lines[Math.min(index, dialogue.lines.length - 1)];
  const isLast = index >= dialogue.lines.length - 1;
  const choices = isLast ? line.choices : undefined;
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButton.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (choices) {
        const n = Number.parseInt(e.key, 10);
        if (n >= 1 && n <= choices.length) {
          e.preventDefault();
          onChoice(choices[n - 1]);
        }
        return; // Space/Enter activate the focused choice button natively.
      }
      if (e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (isLast) onClose();
        else setIndex((i) => i + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choices, isLast, onChoice, onClose]);

  return (
    <section className="dialogue" role="dialog" aria-label={`${dialogue.speaker} says`} data-testid="dialogue">
      <header className="dialogue-head">
        <strong className="dialogue-speaker" data-testid="dialogue-speaker">
          {dialogue.speaker}
        </strong>
        <SourceBadge source={dialogue.source} />
      </header>
      <p className="dialogue-text" data-testid="dialogue-text">
        {line.text}
      </p>
      <footer className="dialogue-actions">
        {choices ? (
          choices.map((c, i) => (
            <button key={c.label} ref={i === 0 ? firstButton : undefined} onClick={() => onChoice(c)} data-testid="dialogue-choice">
              <kbd>{i + 1}</kbd> {c.label}
            </button>
          ))
        ) : (
          <button ref={firstButton} onClick={() => (isLast ? onClose() : setIndex((i) => i + 1))} data-testid="dialogue-next">
            {isLast ? 'Close' : 'Next'} <kbd>Space</kbd>
          </button>
        )}
        <span className="dialogue-progress">
          {index + 1}/{dialogue.lines.length}
        </span>
      </footer>
    </section>
  );
}
