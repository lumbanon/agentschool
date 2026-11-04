import type { ComponentType } from 'react';
import type { ActionDescriptor } from '../engine';

/** Props every domain panel receives. A panel must call `onClose` to hand control back to the world. */
export interface DomainPanelProps {
  action: ActionDescriptor;
  onClose: () => void;
}

/** Action kind (e.g. 'school.openLesson') -> React panel. Domains register here; the engine never sees it. */
export type PanelRegistry = Readonly<Record<string, ComponentType<DomainPanelProps>>>;

/** Context passed to an effect handler. */
export interface EffectContext {
  worldId: string;
  roomId: string;
}

/**
 * An action handled without a panel: it does its work (e.g. toggles a light),
 * optionally returns a short confirmation shown as a toast, and the interaction
 * ends immediately so the player can keep moving.
 */
export type ActionEffect = (action: ActionDescriptor, ctx: EffectContext) => string | void;

/** Action kind -> effect handler. */
export type EffectRegistry = Readonly<Record<string, ActionEffect>>;
