import type { Analytics } from './index.js';
import type { PaywallAccessState, PaywallProduct, PurchaseResult } from './paywall.js';
import { PurchaseTracker, type PaywallTarget, type PurchaseOutcomes } from './purchase-tracking.js';
import { validProviderId } from './validation.js';

/**
 * The parts of RevenueCat's React Native `Purchases` this integration uses. Pass `Purchases`
 * itself; Appbase has no dependency on RevenueCat.
 */
export interface RevenueCatPurchases {
  getAppUserID(): Promise<string>;
  getCustomerInfo(): Promise<RevenueCatCustomerInfo>;
  addCustomerInfoUpdateListener(listener: (info: RevenueCatCustomerInfo) => void): void;
  removeCustomerInfoUpdateListener(listener: (info: RevenueCatCustomerInfo) => void): boolean;
}
/** The parts of RevenueCat's `CustomerInfo` this integration reads. */
export interface RevenueCatCustomerInfo {
  readonly entitlements: { readonly active: Readonly<Record<string, unknown>> };
  /** When RevenueCat produced this info; an older update never replaces a newer one. */
  readonly requestDate?: string;
}
export interface RevenueCatIntegrationOptions {
  /** RevenueCat project ID (not an SDK key or secret API key), the same project as the webhook. */
  projectId: string;
  /** Entitlement that unlocks the paywalled offering. Any active entitlement counts when omitted. */
  entitlement?: string;
}
export interface RevenueCatIntegration {
  /**
   * The customer's current access for `paywall.view({ accessState })`: `unknown` until
   * RevenueCat has reported customer info, then `active` or `inactive`.
   */
  accessState(): PaywallAccessState;
  /**
   * Runs a RevenueCat purchase call and records its attempt and outcome on the paywall view:
   * `revenueCat.purchase(view, pkg.product.identifier, () => Purchases.purchasePackage(pkg))`.
   * Returns RevenueCat's result, or rethrows its error, unchanged; analytics never delays or
   * fails the purchase. Cancellation, pending (Ask to Buy) and failures keep their error code.
   */
  purchase<T>(
    view: PaywallTarget,
    product: string | PaywallProduct,
    purchase: () => Promise<T>,
  ): Promise<T>;
  /**
   * Links the current RevenueCat customer again and refreshes access. RevenueCat updates and
   * purchases already do this; call it after `analytics.identify()` or `reset()` when RevenueCat
   * itself did not change.
   */
  sync(): Promise<void>;
  /** Resolves once identity links and purchase outcomes recorded so far have been stored. */
  settled(): Promise<void>;
  /** Stops listening to RevenueCat. Purchases still work; they are no longer recorded. */
  dispose(): void;
}

// RevenueCat's PURCHASES_ERROR_CODE values for a cancelled purchase and Ask to Buy / deferred.
const CANCELLED = '1';
const PENDING = '20';
/** Maps `react-native-purchases` results and errors; exported for tests and future adapters. */
export const revenueCatOutcomes: PurchaseOutcomes<unknown> = {
  succeeded(result) {
    const id = (result as { transaction?: { transactionIdentifier?: unknown } | null } | null)
      ?.transaction?.transactionIdentifier;
    return { result: 'succeeded', ...(typeof id === 'string' && id ? { transactionId: id } : {}) };
  },
  failed(error): PurchaseResult {
    const { userCancelled, code } = (error ?? {}) as { userCancelled?: unknown; code?: unknown };
    const errorCode =
      typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
    return {
      result:
        userCancelled === true || errorCode === CANCELLED
          ? 'cancelled'
          : errorCode === PENDING
            ? 'pending'
            : 'failed',
      ...(errorCode ? { errorCode } : {}),
    };
  },
};

/**
 * Connects RevenueCat after `Purchases.configure()`: keeps the RevenueCat customer linked to the
 * analytics identity (on connect, on every RevenueCat customer update and before purchases),
 * tracks access for paywall views, and records purchases. Throws only for invalid options.
 */
export function connectRevenueCat(
  analytics: Pick<Analytics, 'linkRevenueCatUser'>,
  purchases: RevenueCatPurchases,
  options: RevenueCatIntegrationOptions,
): RevenueCatIntegration {
  const { projectId, entitlement } = options ?? ({} as RevenueCatIntegrationOptions);
  if (!validProviderId(projectId)) throw new Error('Supply the RevenueCat project ID');
  if (entitlement !== undefined && !validProviderId(entitlement))
    throw new Error('Use the RevenueCat entitlement identifier, or omit it');
  const tracker = new PurchaseTracker();
  let access: PaywallAccessState = 'unknown';
  let observedAt = -Infinity;
  let disposed = false;
  const observe = (info: RevenueCatCustomerInfo | null | undefined) => {
    const active = info?.entitlements?.active;
    if (disposed || !active || typeof active !== 'object') return;
    const at = Date.parse(info.requestDate ?? '');
    if (Number.isFinite(at)) {
      if (at < observedAt) return;
      observedAt = at;
    }
    const granted = entitlement
      ? Object.prototype.hasOwnProperty.call(active, entitlement) && !!active[entitlement]
      : Object.keys(active).length > 0;
    access = granted ? 'active' : 'inactive';
  };
  // The analytics SDK deduplicates identical links, so relinking on every update is cheap.
  const link = () =>
    tracker.background(
      analytics.linkRevenueCatUser({ projectId, getAppUserId: () => purchases.getAppUserID() }),
    );
  const refresh = () => tracker.background(purchases.getCustomerInfo().then(observe));
  const listener = (info: RevenueCatCustomerInfo) => {
    observe(info);
    void link();
  };
  try {
    purchases.addCustomerInfoUpdateListener(listener);
  } catch {
    // Not configured yet: links still try (and report), and sync() retries later.
  }
  void link();
  void tracker.background(Promise.resolve().then(refresh));
  return Object.freeze({
    accessState: () => access,
    purchase<T>(view: PaywallTarget, product: string | PaywallProduct, run: () => Promise<T>) {
      if (disposed) return run();
      void link();
      return tracker.track(
        view,
        typeof product === 'string' ? { productId: product } : product,
        run,
        revenueCatOutcomes as PurchaseOutcomes<T>,
      );
    },
    async sync() {
      if (disposed) return;
      await Promise.all([link(), refresh()]);
    },
    settled: () => tracker.settled(),
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        purchases.removeCustomerInfoUpdateListener(listener);
      } catch {
        // Nothing to remove when registration failed.
      }
    },
  });
}
