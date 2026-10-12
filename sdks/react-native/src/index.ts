/** React Native public facade. The private core is bundled into the published package. */
import { createAnalytics, type RuntimeEnvironment } from '@mobile-analytics/sdk-core';
export * from '@mobile-analytics/sdk-core';

/**
 * Outside a React Native app (Node, tests, web) there is no native build signal. Metro resolves
 * `index.native` instead, which detects Development, TestFlight and App Store builds.
 */
export async function detectAppbaseRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  return 'unknown';
}
export const createReactNativeAnalytics = createAnalytics;
