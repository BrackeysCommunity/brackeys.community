import type { GameEventMap } from "./types";

type Handler<T> = (payload: T) => void;

export class GameEventEmitter {
  private listeners = new Map<string, Set<Handler<unknown>>>();

  on<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): void {
    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set());
    }
    this.listeners.get(event as string)!.add(handler as Handler<unknown>);
  }

  off<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): void {
    this.listeners.get(event as string)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEventMap>(
    event: K,
    ...args: GameEventMap[K] extends undefined ? [] : [GameEventMap[K]]
  ): void {
    const handlers = this.listeners.get(event as string);
    if (!handlers) return;
    const payload = args[0] as GameEventMap[K];
    for (const handler of handlers) {
      handler(payload);
    }
  }

  destroy(): void {
    this.listeners.clear();
  }
}
