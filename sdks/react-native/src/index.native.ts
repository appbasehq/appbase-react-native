/** React Native entry resolved by Metro: derives the platform and detects the build environment. */
import { NativeModules, Platform } from 'react-native';
import type { RuntimeEnvironment } from '@mobile-analytics/sdk-core';
import { factory } from './facade.js';
export * from './facade.js';

declare const __DEV__: boolean | undefined;
type RuntimeModule = { detectRuntimeEnvironment(): Promise<RuntimeEnvironment> };

/**
 * Debug JavaScript is always Development. Release iOS builds ask the bundled native module
 * (verified StoreKit AppTransaction); anything else is Unknown, which reports count as Production.
 */
async function detectRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return 'development';
  const runtime: RuntimeModule | undefined =
    Platform.OS === 'ios' ? NativeModules.AppbaseRuntime : undefined;
  return runtime ? runtime.detectRuntimeEnvironment() : 'unknown';
}

/** The only factory: Platform.OS (iOS or Android) and build detection come from the app. */
export const createReactNativeAnalytics = factory({
  platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : undefined,
  detectRuntimeEnvironment,
});
