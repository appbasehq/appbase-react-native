/** Shared public surface of both entry points: one factory, types, and the RevenueCat helper. */
import {
  createAnalytics,
  type Analytics,
  type AnalyticsOptions as CoreOptions,
  type RuntimeEnvironment,
} from '@mobile-analytics/sdk-core';
import { SDK_VERSION } from './version.js';
export { FeedbackError, connectRevenueCat } from '@mobile-analytics/sdk-core';
export type {
  Analytics,
  AnalyticsEvent,
  AppStateAdapter,
  Diagnostic,
  FeedbackInput,
  FeedbackReceipt,
  NetworkAdapter,
  Onboarding,
  OnboardingAttempt,
  OnboardingDefinition,
  OnboardingOptions,
  OnboardingQuestion,
  Paywall,
  PaywallAccessState,
  PaywallOptions,
  PaywallProduct,
  PaywallPurchase,
  PaywallTarget,
  PaywallView,
  PaywallViewOptions,
  ProfileInput,
  Properties,
  PurchaseResult,
  RevenueCatCustomerInfo,
  RevenueCatIdentityOptions,
  RevenueCatIntegration,
  RevenueCatIntegrationOptions,
  RevenueCatPurchases,
  RuntimeEnvironment,
  StorageAdapter,
} from '@mobile-analytics/sdk-core';

export interface AnalyticsOptions extends Omit<
  CoreOptions,
  'platform' | 'detectRuntimeEnvironment'
> {
  /** Derived from React Native's Platform.OS in an app; required outside React Native (Node tests). */
  platform?: CoreOptions['platform'];
}

/** Each entry supplies what only it knows: the platform and the build-detection hook. */
export function factory(host: {
  platform?: CoreOptions['platform'];
  detectRuntimeEnvironment?: () => Promise<RuntimeEnvironment>;
}) {
  return (options: AnalyticsOptions): Promise<Analytics> =>
    createAnalytics({
      ...options,
      platform: options.platform ?? host.platform!,
      sdk: `react-native/${SDK_VERSION}`,
      // An explicit runtimeEnvironment still wins: core skips detection when it is set.
      ...(host.detectRuntimeEnvironment
        ? { detectRuntimeEnvironment: host.detectRuntimeEnvironment }
        : {}),
    });
}
