/** React Native entry resolved by Metro: adds automatic build detection to the shared facade. */
import { NativeModules, Platform } from 'react-native';
import {
  createAnalytics,
  type AnalyticsOptions,
  type RuntimeEnvironment,
} from '@mobile-analytics/sdk-core';
export * from '@mobile-analytics/sdk-core';

declare const __DEV__: boolean | undefined;
type RuntimeModule = { detectRuntimeEnvironment(): Promise<RuntimeEnvironment> };

/**
 * Debug JavaScript is always Development. Release iOS builds ask the bundled native module
 * (verified StoreKit AppTransaction); anything else is Unknown, which reports count as Production.
 */
export async function detectAppbaseRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return 'development';
  const runtime: RuntimeModule | undefined =
    Platform.OS === 'ios' ? NativeModules.AppbaseRuntime : undefined;
  return runtime ? runtime.detectRuntimeEnvironment() : 'unknown';
}

/** An explicit runtimeEnvironment still wins over detection. */
export function createReactNativeAnalytics(options: AnalyticsOptions) {
  return createAnalytics({
    detectRuntimeEnvironment: detectAppbaseRuntimeEnvironment,
    ...options,
  });
}
