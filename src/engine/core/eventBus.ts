import type { WorldEvent, WorldEventOf, WorldEventType } from './types';

type Handler<K extends WorldEventType> = (event: WorldEventOf<K>) => void;
type AnyHandler = (event: WorldEvent) => void;

/** Minimal typed event bus. Synchronous; handler errors are isolated so one bad listener can't break the game loop. */
export class WorldEventBus {
  private handlers = new Map<WorldEventType, Set<AnyHandler>>();
  private anyHandlers = new Set<AnyHandler>();
  private readonly history: WorldEvent[] = [];

  constructor(private readonly historyLimit = 200) {}

  on<K extends WorldEventType>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as AnyHandler);
    return () => set!.delete(handler as AnyHandler);
  }

  onAny(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  emit(event: WorldEvent): void {
    this.history.push(event);
    if (this.history.length > this.historyLimit) this.history.shift();
    const call = (h: AnyHandler) => {
      try {
        h(event);
      } catch (err) {
        console.error('[WorldEventBus] handler failed for', event.type, err);
      }
    };
    this.handlers.get(event.type)?.forEach(call);
    this.anyHandlers.forEach(call);
  }

  /** Recent events (debugging and tests). */
  recent(): readonly WorldEvent[] {
    return this.history;
  }

  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }
}
