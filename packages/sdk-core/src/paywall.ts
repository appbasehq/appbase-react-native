import { MOBILE_LIMITS } from '@mobile-analytics/contracts/mobile-constants';
import type { Properties } from '@mobile-analytics/contracts/types';
import { validLabel, validUuid } from './validation.js';
import { snapshotProperties, validProperties } from './properties.js';

export interface PaywallOptions {
  id: string;
  /** Positive whole number; defaults to 1. Increment for a changed paywall design. */
  version?: number;
}
export interface PaywallViewOptions {
  placement: string;
  /** Access to this app's paid offering immediately before presentation. Omit if unknown. */
  accessState?: 'inactive' | 'active' | 'unknown';
  /** Exact store IDs (including a base plan where applicable); omit when unknown. */
  productIds?: readonly string[];
  /** An onboarding helper created by this analytics instance. */
  onboarding?: { readonly definition: { readonly id: string; readonly version: string } };
  properties?: Properties;
}
export interface PaywallProduct {
  productId: string;
  offerId?: string;
}
export interface PurchaseResult {
  result: 'succeeded' | 'cancelled' | 'failed' | 'pending';
  transactionId?: string;
  errorCode?: string;
}
export interface PaywallPurchase {
  readonly attemptId: string;
  readonly productId: string;
  /** App-reported callback; never a verified trial or payment. Pending can resolve later. */
  finished(result: PurchaseResult): Promise<boolean>;
}
export interface PaywallView {
  readonly viewId: string;
  productSelected(product: PaywallProduct): Promise<boolean>;
  purchaseStarted(product: PaywallProduct): Promise<PaywallPurchase | null>;
  dismissed(options?: {
    reason?: 'close_button' | 'back' | 'purchased' | 'other';
  }): Promise<boolean>;
  getPurchase(attemptId: string): Promise<PaywallPurchase | null>;
}
export interface Paywall {
  readonly id: string;
  readonly version: number;
  /** Call once when actually presented, not on each render. Each call creates a new view. */
  view(options: PaywallViewOptions): Promise<PaywallView | null>;
  /** Resume a saved view without recording another exposure. */
  getView(viewId: string): Promise<PaywallView | null>;
}
interface SavedPurchase {
  product: PaywallProduct;
  result?: PurchaseResult;
}
interface SavedView {
  context: Properties;
  dismissed?: string;
  purchases: Record<string, SavedPurchase>;
}
export type PaywallStore = Record<string, SavedView>;
export interface PaywallHost {
  generateId(): string;
  ownsOnboarding(handle: object): boolean;
  perform<T>(
    operation: (
      store: PaywallStore,
      emit: (name: string, properties: Properties) => boolean,
      onboarding: (id: string, version: string) => string | undefined,
    ) => T,
  ): Promise<T | null>;
}
const opaque = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= MOBILE_LIMITS.storeIdLength &&
  v.trim() === v;
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function createPaywall(options: PaywallOptions, host: PaywallHost): Paywall {
  const id = options.id,
    version = options.version === undefined ? 1 : options.version;
  check(typeof id === 'string' && validLabel(id), 'Paywall requires a stable ID');
  check(
    Number.isSafeInteger(version) && version > 0,
    'Paywall version must be a positive safe integer',
  );
  const saved = (store: PaywallStore, viewId: string) => {
    const view = store[viewId];
    check(
      view && view.context.paywall_id === id && view.context.paywall_version === String(version),
      'Paywall view is unavailable; it may have been reset or evicted',
    );
    return view;
  };
  const productProps = (product: PaywallProduct, view: SavedView): Properties => {
    check(opaque(product.productId), 'Use the exact product ID (1–200 characters)');
    check(product.offerId === undefined || opaque(product.offerId), 'Invalid offer ID');
    const shown = view.context.product_ids;
    check(
      !Array.isArray(shown) || shown.includes(product.productId),
      'Product was not listed on this paywall view',
    );
    return {
      product_id: product.productId,
      ...(product.offerId ? { offer_id: product.offerId } : {}),
    };
  };
  const purchaseHandle = (viewId: string, attemptId: string, productId: string): PaywallPurchase =>
    Object.freeze({
      attemptId,
      productId,
      async finished(input: PurchaseResult) {
        const result = { ...input };
        return (
          (await host.perform((store, emit) => {
            const view = saved(store, viewId),
              purchase = view.purchases[attemptId];
            check(purchase, 'Purchase attempt is unavailable');
            check(
              ['succeeded', 'cancelled', 'failed', 'pending'].includes(result.result),
              'Invalid purchase result',
            );
            check(
              result.transactionId === undefined || opaque(result.transactionId),
              'Invalid transaction ID',
            );
            check(result.errorCode === undefined || opaque(result.errorCode), 'Invalid error code');
            const previous = purchase.result;
            if (
              previous?.result === result.result &&
              previous.transactionId === result.transactionId &&
              previous.errorCode === result.errorCode
            )
              return true;
            check(
              !previous || previous.result === 'pending',
              'Purchase attempt already has a final result',
            );
            if (
              !emit('paywall_purchase_result', {
                ...view.context,
                ...productProps(purchase.product, view),
                purchase_attempt_id: attemptId,
                result: result.result,
                result_source: 'client',
                ...(result.transactionId ? { transaction_id: result.transactionId } : {}),
                ...(result.errorCode ? { error_code: result.errorCode } : {}),
              })
            )
              return false;
            purchase.result = result;
            return true;
          })) === true
        );
      },
    });
  const viewHandle = (viewId: string): PaywallView =>
    Object.freeze({
      viewId,
      async productSelected(input: PaywallProduct) {
        const product = { ...input };
        return (
          (await host.perform((store, emit) => {
            const view = saved(store, viewId);
            check(!view.dismissed, 'Paywall view has been dismissed');
            return emit('paywall_product_selected', {
              ...view.context,
              ...productProps(product, view),
            });
          })) === true
        );
      },
      async purchaseStarted(input: PaywallProduct) {
        const product = { ...input };
        const attemptId = await host.perform((store, emit) => {
          const view = saved(store, viewId);
          check(!view.dismissed, 'Paywall view has been dismissed');
          check(
            Object.keys(view.purchases).length < MOBILE_LIMITS.paywallPurchases,
            'At most 20 purchase attempts per paywall view',
          );
          const props = productProps(product, view),
            attemptId = host.generateId();
          check(validUuid(attemptId), 'generateId must return a UUID');
          check(
            !Object.values(store).some((saved) =>
              Object.keys(saved.purchases).some(
                (id) => id.toLowerCase() === attemptId.toLowerCase(),
              ),
            ),
            'generateId returned an existing purchase attempt ID',
          );
          if (
            !emit('paywall_purchase_started', {
              ...view.context,
              ...props,
              purchase_attempt_id: attemptId,
            })
          )
            return null;
          view.purchases[attemptId] = { product };
          return attemptId;
        });
        return attemptId ? purchaseHandle(viewId, attemptId, product.productId) : null;
      },
      async dismissed(input: { reason?: 'close_button' | 'back' | 'purchased' | 'other' } = {}) {
        const reason = input?.reason ?? 'other';
        return (
          (await host.perform((store, emit) => {
            check(
              input && typeof input === 'object' && !Array.isArray(input),
              'Use valid dismissal options',
            );
            const view = saved(store, viewId);
            check(
              ['close_button', 'back', 'purchased', 'other'].includes(reason),
              'Invalid dismissal reason',
            );
            if (view.dismissed) return true;
            if (!emit('paywall_dismissed', { ...view.context, dismiss_reason: reason }))
              return false;
            view.dismissed = reason;
            return true;
          })) === true
        );
      },
      async getPurchase(attemptId: string) {
        const productId = await host.perform(
          (store) => saved(store, viewId).purchases[attemptId]?.product.productId ?? null,
        );
        return productId ? purchaseHandle(viewId, attemptId, productId) : null;
      },
    });
  return Object.freeze({
    id,
    version,
    async view(input: PaywallViewOptions) {
      try {
        check(
          input && typeof input === 'object' && !Array.isArray(input),
          'Use valid paywall view options',
        );
        check(
          input.properties === undefined || validProperties(input.properties),
          'Use valid flat paywall properties',
        );
        check(
          input.productIds === undefined || Array.isArray(input.productIds),
          'Use a product ID list',
        );
        const placement = input.placement;
        const accessState = input.accessState;
        const productIds = input.productIds ? [...input.productIds] : undefined;
        const properties = snapshotProperties(input.properties ?? {});
        for (const key of [
          'paywall_id',
          'paywall_version',
          'paywall_view_id',
          'placement',
          'paywall_access_state',
          'product_ids',
          'flow_id',
          'flow_version',
          'onboarding_attempt_id',
          'product_id',
          'offer_id',
          'purchase_attempt_id',
          'result',
          'result_source',
          'transaction_id',
          'error_code',
          'dismiss_reason',
        ])
          delete properties[key];
        const ownsOnboarding = !input.onboarding || host.ownsOnboarding(input.onboarding);
        const flow = input.onboarding?.definition
          ? { id: input.onboarding.definition.id, version: input.onboarding.definition.version }
          : undefined;
        const viewId = await host.perform((store, emit, onboarding) => {
          check(ownsOnboarding, 'Use an onboarding helper from this analytics instance');
          check(
            typeof placement === 'string' && validLabel(placement),
            'Paywall requires a stable placement',
          );
          check(
            accessState === undefined || ['inactive', 'active', 'unknown'].includes(accessState),
            'Paywall access state must be inactive, active or unknown',
          );
          check(
            !productIds ||
              (productIds.length > 0 &&
                productIds.length <= MOBILE_LIMITS.propertyArrayLength &&
                productIds.every(opaque) &&
                new Set(productIds).size === productIds.length),
            'List 1–20 unique product IDs, or omit the list when unknown',
          );
          const attemptId = flow ? onboarding(flow.id, flow.version) : undefined;
          check(!flow || attemptId, 'Start onboarding on this SDK before linking a paywall');
          const viewId = host.generateId();
          check(validUuid(viewId), 'generateId must return a UUID');
          check(
            !Object.keys(store).some((id) => id.toLowerCase() === viewId.toLowerCase()),
            'generateId returned an existing paywall view ID',
          );
          const context: Properties = {
            ...properties,
            paywall_id: id,
            paywall_version: String(version),
            paywall_view_id: viewId,
            placement,
            ...(accessState ? { paywall_access_state: accessState } : {}),
            ...(productIds ? { product_ids: productIds } : {}),
            ...(flow
              ? { flow_id: flow.id, flow_version: flow.version, onboarding_attempt_id: attemptId! }
              : {}),
          };
          if (!emit('paywall_viewed', context)) return null;
          store[viewId] = { context, purchases: {} };
          // Event history remains in the outbox/server; only resumable handles are bounded.
          while (Object.keys(store).length > MOBILE_LIMITS.paywallViews)
            delete store[Object.keys(store)[0]];
          return viewId;
        });
        return viewId ? viewHandle(viewId) : null;
      } catch {
        await host.perform(() => {
          throw new Error('Use valid paywall options and properties');
        });
        return null;
      }
    },
    async getView(viewId: string) {
      const found = await host.perform((store) => {
        const view = store[viewId];
        return (
          !!view &&
          view.context.paywall_id === id &&
          view.context.paywall_version === String(version)
        );
      });
      return found ? viewHandle(viewId) : null;
    },
  });
}
