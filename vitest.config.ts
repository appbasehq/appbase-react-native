import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ["tests/sdk.test.ts","tests/sdk-hardening.test.ts","tests/sdk-conformance.test.ts","tests/mobile-contract.test.ts","tests/onboarding-answer-sdk.test.ts","tests/paywall.test.ts","tests/feedback-sdk.test.ts","tests/revenuecat-identity-sdk.test.ts"], testTimeout: 15000 },
});
