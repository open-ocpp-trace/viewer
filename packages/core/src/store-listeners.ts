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
   * was unsubscribed meanwhile. Never throws: each listener error goes to
   * the `report` function of {@link createListeners}, and the others still
   * run.
   */
  emit(value: T): void;
}

/** Listeners whose errors go to `report`, which must not throw. */
export function createListeners<T>(report: (error: unknown) => void): Listeners<T> {
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
      // The array is replaced, never mutated, so this is a stable snapshot.
      for (const subscription of subscriptions) {
        if (!subscription.active) continue;
        try {
          subscription.listener(value);
        } catch (error) {
          report(error);
        }
      }
    },
  };
}

/** The first error thrown by steps that must all run. */
export interface FirstError {
  /** Runs `step`, keeping its error unless an earlier step already threw. */
  run(step: () => void): void;
  /** The first error kept, wrapped so that a thrown `undefined` counts. */
  readonly failure: { readonly error: unknown } | undefined;
  /** Throws the first error kept, if any. */
  rethrow(): void;
}

export function firstError(): FirstError {
  let failure: { readonly error: unknown } | undefined;
  return {
    run(step) {
      try {
        step();
      } catch (error) {
        failure ??= { error };
      }
    },
    get failure() {
      return failure;
    },
    rethrow() {
      if (failure !== undefined) throw failure.error;
    },
  };
}

/**
 * Reports `error` asynchronously, as an unhandled rejection: the default
 * for errors that cannot be rethrown to the caller.
 */
export function reportAsync(error: unknown): void {
  void Promise.reject(error);
}
