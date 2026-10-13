import type { PaywallProduct, PaywallPurchase, PaywallView, PurchaseResult } from './paywall.js';

/** Where a purchase was offered: a recorded view, one still being recorded, or none. */
export type PaywallTarget =
  PaywallView | null | undefined | PromiseLike<PaywallView | null | undefined>;

/** How a billing provider's purchase call result or error maps to a recorded outcome. */
export interface PurchaseOutcomes<T> {
  succeeded(result: T): PurchaseResult;
  failed(error: unknown): PurchaseResult;
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === 'function';

/**
 * Records purchase attempts around a billing provider's store call. Shared by billing
 * integrations (RevenueCat today) so each one only maps its own result and error shapes.
 *
 * Analytics never delays, changes or fails the purchase: the attempt is recorded without
 * waiting, the store call's result is returned (or its error rethrown) unchanged, and the
 * outcome is recorded in the background. `settled()` waits for that background work.
 */
export class PurchaseTracker {
  private readonly work = new Set<Promise<unknown>>();

  async track<T>(
    target: PaywallTarget,
    product: PaywallProduct,
    purchase: () => Promise<T>,
    outcomes: PurchaseOutcomes<T>,
  ): Promise<T> {
    // Called synchronously for a ready view, so the attempt keeps its actual start time.
    const started = this.background(
      isPromiseLike(target)
        ? Promise.resolve(target).then((view) => view?.purchaseStarted(product) ?? null)
        : (target?.purchaseStarted(product) ?? Promise.resolve(null)),
    );
    let result: T;
    try {
      result = await purchase();
    } catch (error) {
      this.finish(started, () => outcomes.failed(error));
      throw error;
    }
    this.finish(started, () => outcomes.succeeded(result));
    return result;
  }

  /** Runs analytics work that must never reject into the app; `settled()` waits for it. */
  background<T>(work: PromiseLike<T>): Promise<T | null> {
    const safe = Promise.resolve(work).catch(() => null);
    this.work.add(safe);
    void safe.finally(() => this.work.delete(safe));
    return safe;
  }

  /** Resolves once every recorded attempt, outcome and other background work has finished. */
  async settled(): Promise<void> {
    while (this.work.size) await Promise.all([...this.work]);
  }

  private finish(started: Promise<PaywallPurchase | null>, outcome: () => PurchaseResult) {
    this.background(started.then((attempt) => (attempt ? attempt.finished(outcome()) : false)));
  }
}
