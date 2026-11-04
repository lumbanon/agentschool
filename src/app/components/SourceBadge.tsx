import type { ContentSource } from '../../engine';

/** Every piece of content shows where it came from. Phase 0 has no model output at all. */
export function SourceBadge({ source }: { source: ContentSource }) {
  if (source === 'prototype_script') {
    return (
      <span className="badge badge-mock" data-testid="source-badge" title="Hand-written Phase 0 content. No AI model was involved.">
        Prototype script — not AI-generated
      </span>
    );
  }
  return (
    <span className="badge badge-ai" data-testid="source-badge">
      AI-generated
    </span>
  );
}

export function MockBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="badge badge-mock" data-testid="mock-badge">
      {children}
    </span>
  );
}
