import type { ComponentType } from 'react';
import type { ActionDescriptor } from '../engine';

/** Props every domain panel receives. A panel must call `onClose` to hand control back to the world. */
export interface DomainPanelProps {
  action: ActionDescriptor;
  onClose: () => void;
}

/** Action kind (e.g. 'school.openLesson') -> React panel. Domains register here; the engine never sees it. */
export type PanelRegistry = Readonly<Record<string, ComponentType<DomainPanelProps>>>;
