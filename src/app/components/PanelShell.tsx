import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}

/** Shared modal chrome for domain panels. Esc closes and returns control to the world. */
export function PanelShell({ title, subtitle, badges, onClose, children, testId }: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section className="panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} data-testid={testId}>
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="panel-subtitle">{subtitle}</p>}
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close panel" data-testid="panel-close">
          ✕ <kbd>Esc</kbd>
        </button>
      </header>
      {badges && <div className="panel-badges">{badges}</div>}
      <div className="panel-body">{children}</div>
    </section>
  );
}
