# Appbase TypeScript SDK core

Internal, framework-independent implementation of durable delivery, identity, onboarding, paywalls, RevenueCat identity evidence and feedback. React Native's public package bundles this implementation; applications never install this private package.

Platform behavior enters through storage, lifecycle, connectivity, UUID, clock and HTTP adapters. Do not import React, React Native, UIKit, Node-only APIs or dashboard/admin code here. Keep UI components in the public platform SDK.

The canonical mobile contract and shared behavior scenarios live in `packages/contracts/mobile`. A change to delivery, identity or workflow semantics must update the specification/tests and be assessed against Swift. Swift is a separate native implementation of the same contract, not a consumer of this TypeScript runtime.

Preserve the deployed `mobile-analytics:v1:<app>:<environment>` storage namespace and payload schema. Storage changes require explicit migration and restart tests. Public React Native APIs remain exported by `sdks/react-native/src/index.ts`.
