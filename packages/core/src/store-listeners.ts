import type { Unsubscribe } from "./adapter.ts";

interface Subscription<T> {
  readonly listener: (value: T) => void;
  active: boolean;
}

/** Listeners of a store, called in subscription order. */
export interface Listeners<T> {
  subscribe(listener: (value: T) => void): Unsubscribe;
  /**
   * Calls the listeners subscribed when the call starts, skipping any that
   * was unsubscribed meanwhile. A throwing listener does not stop the others;
   * the first error is rethrown once they all ran.
   */
  emit(value: T): void;
}

export function createListeners<T>(): Listeners<T> {
  let subscriptions: Subscription<T>[] = [];
  return {
    subscribe(listener) {
      const subscription: Subscription<T> = { listener, active: true };
      subscriptions = [...subscriptions, subscription];
      return () => {
        if (!subscription.active) return;
        subscription.active = false;
        subscriptions = subscriptions.filter((other) => other !== subscription);
      };
    },
    emit(value) {
      let failure: { readonly error: unknown } | undefined;
      // The array is replaced, never mutated, so this is a stable snapshot.
      for (const subscription of subscriptions) {
        if (!subscription.active) continue;
        try {
          subscription.listener(value);
        } catch (error) {
          failure ??= { error };
        }
      }
      if (failure !== undefined) throw failure.error;
    },
  };
}
