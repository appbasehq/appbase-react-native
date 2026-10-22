# Changelog: @appbasehq/react-native

Newest first. Each release says what changed and what an upgrade needs. To upgrade, read every entry between your installed version and the target, apply each **Upgrade** step, then:

1. Install the exact version (`npm install --save-exact @appbasehq/react-native@VERSION`) and commit the lockfile. Pin exact versions; the npm `latest` tag can lag behind the newest release.
2. Run `pod install` (bare React Native) or rebuild the Expo development and production builds, since the package includes an iOS module.
3. Launch a development build, confirm events still arrive (`GET /v1/agent/setup` with setup access, or the dashboard's Development view), and ship an app update. Installed apps keep their old SDK until then.

Wire schema v1, stored identities and queued events carry over between all versions below unless an entry says otherwise. Swift releases are in the [Swift changelog](https://appbase.so/docs/swift-sdk-changelog.md); wire and storage details are in the [compatibility notes](https://appbase.so/docs/sdk-compatibility.md).

## Unreleased

Nothing yet.

## 0.12.0 (2026-10-22)

**Upgrade:** no code changes for apps set up as in the guide (`createReactNativeAnalytics` with the app's `ma_prod_…` key). Remove `appId` and `environment` if you pass them, and replace `createAnalytics` with `createReactNativeAnalytics`. `apiUrl`, `platform` and `generateId` are now optional; you can drop `expo-crypto` if only analytics used it. Leave `apiUrl: 'https://api.appbase.so'` in place or remove it to use the new collection host. Run `pod install` or rebuild the Expo builds (the pod adds a privacy manifest).

- The `appId` and `environment` options are removed: the app's `ma_prod_…` collection key names its app. Any other key format (retired `ma_dev_…` keys, keys without an app ID) now throws when creating the client, and plain HTTP is accepted only for local development hosts. Stored identities and queued events are unchanged.
- `apiUrl` is optional and defaults to Appbase's collection host, `https://in.appbase.so`, for batches and feedback. An explicit `apiUrl` (a local server, or the `https://api.appbase.so` earlier setups pass) still wins.
- `createReactNativeAnalytics` is the only factory. In an app it takes `platform` from `Platform.OS` (the option is now optional) and always detects the build environment. `createAnalytics`, the `Analytics.create` value and `detectAppbaseRuntimeEnvironment` are no longer exported: they skipped build detection, so their events counted as Production. `Analytics` remains a type.
- Delivery follows one [status table](https://github.com/appbasehq/appbase-react-native/blob/main/packages/contracts/mobile/behavior.md#delivery-status-table) shared with the Swift SDK. Redirects, 401, 403, 404 and other 4xx block delivery and retry hourly, also across restarts (`resume()` still retries at once). `Retry-After` on any error is kept across restarts and never bypassed. 400 and 413 halve the batch, dropping only a single event the server cannot accept. 410 discards the queue and stops that key. Network failures back off with full jitter up to 15 minutes (was 1 minute). Requests use `redirect: 'manual'` instead of `'error'`.
- Obeys an optional server [`control`](https://github.com/appbasehq/appbase-react-native/blob/main/packages/contracts/mobile/behavior.md#server-control) in batch acknowledgements (retry floor, longer flush interval, smaller batches, pause until a time, purge), clamped and kept across restarts until an acknowledgement arrives without it. Appbase uses it to protect collection during incidents; apps need no code.
- `initiallyEnabled: false` waits for consent on a new installation: nothing is stored or sent, not even an identifier, until `setEnabled(true)`, which records the first open. Existing installations keep their saved choice.
- The queue also has a byte budget, 1.5 MiB by default (`maxQueueBytes`, up to 5 MiB); beyond it the newest event is dropped, as when the queue is full. An unreadable stored event is dropped (counted in `dropped`) and an unreadable onboarding or paywall section is cleared, with a `storage` diagnostic, instead of failing every launch; only unreadable stored identity still fails creation.
- `generateId` is optional: the SDK generates time-ordered UUIDv7 IDs itself, so apps no longer need `expo-crypto` or another UUID package for analytics. An app that passes `generateId` keeps working.
- Batch and feedback requests send `X-Appbase-SDK: react-native/<version>` and `X-Appbase-Dropped` (events this install dropped), so Appbase can see which SDK versions installs run (`sdk_versions` in `GET /v1/agent/setup`).
- The iOS pod now ships a privacy manifest (`PrivacyInfo.xcprivacy`, the same as the Swift SDK's) declaring Device ID, User ID, Product Interaction, Purchase History, Email Address and Name (Analytics, from `setProfile`), and Email Address and Other User Content (App Functionality, from feedback). Run `pod install` or rebuild.

## 0.11.0 (2026-10-21)

**Upgrade:** no code changes. You can remove `projectId` from `connectRevenueCat` and `linkRevenueCatUser`; apps that keep passing it work unchanged.

- `connectRevenueCat(analytics, Purchases, options?)` and `linkRevenueCatUser({ getAppUserId })` no longer need `projectId`: Appbase matches the link to the RevenueCat project the app is connected to, including links sent before it was connected. Pass `projectId` only when one app's purchases come from more than one RevenueCat project; apps that already pass it keep working unchanged.

## 0.10.0 (2026-10-18)

**Upgrade:** no code changes. If your app wrapped `onboarding()` to catch "different steps/questions" errors, that error no longer occurs.

- A changed onboarding definition under the same `version` no longer throws from `onboarding()`. Question and option edits keep the version; changed steps report a `configuration` diagnostic, printed once to the console in development builds, and the server keeps both definitions. A saved attempt continues after a question edit and starts over after a step change unless it finished. See [onboarding versions](https://appbase.so/docs/sdk.md#onboarding-versions).
- Server `warnings` in batch responses are reported as `configuration` diagnostics.

## 0.9.1 (2026-10-14)

**Upgrade:** no code changes. The SDK code is identical to 0.9.0.

- The package now includes this `CHANGELOG.md`.
- The packaged guide links the [setup guide](https://appbase.so/docs/agent-setup.md) for accounts, labels hand-wired purchase calls as the path without the RevenueCat integration, and clarifies that paywall `accessState` may be `unknown`.

## 0.9.0 (2026-10-14)

**Upgrade:** no code changes.

- Added `setProfile({ email, name })`: after `identify`, the dashboard shows this email and name for the account instead of its ID. It is stored apart from events, each call replaces the profile, and it is ignored (with a diagnostic) before `identify`. Optional; see [apps with accounts](https://appbase.so/docs/agent-setup.md#apps-with-accounts).
- When automatic build detection returns Unknown (for example a slow StoreKit answer during App Review), the SDK asks again in the background at about 5 s, 30 s, 2 min and 10 min. Later events carry the detected build.

## 0.8.0 (2026-10-13)

**Upgrade:** no code changes required. If the app uses RevenueCat, the integration is now recommended in place of hand-wired `linkRevenueCatUser` and paywall `purchaseStarted`/`finished` calls; do not use both.

- Added `connectRevenueCat(analytics, Purchases, { projectId, entitlement })`: links the RevenueCat customer to the analytics identity, reports access state for paywall views and records purchase attempts and outcomes through `revenueCat.purchase(...)`. It uses only the existing public APIs and adds no RevenueCat dependency.

## 0.7.0 (2026-10-13)

**Upgrade:** no code changes. Apps that relied on `identify` refusing an account switch should still call `reset()` on logout.

- Text containing NUL or unpaired surrogate characters is rejected at capture instead of failing on the server.
- Queued events flush when the app leaves the foreground, and `app_active` counts only returns from the background (Control Center, system alerts, Face ID and the purchase sheet no longer count as opens).
- `identify` with a different user while another is identified resets first, so the new person's activity is never credited to the previous account. `identity_linked` is sent only when the user changes.
- Requests send `X-Appbase-Sent-At` so the server can correct a wrong device clock.

## 0.6.0 (2026-10-12)

**Upgrade:** remove any build-detection adapter the app passes as `runtimeEnvironment` (an explicit value overrides automatic detection). Run `pod install` or rebuild Expo builds for the new iOS module. Use the app's single collection key in every build.

- The build environment is detected automatically: Development for `__DEV__`, otherwise a bundled, autolinked iOS module asks Apple's verified `AppTransaction` (App Store, TestFlight/App Review, development), bounded to 2.5 seconds and Unknown on failure.
- Plain HTTP is accepted only for loopback and private-network development hosts.
- Feedback carries the optional build environment.

## 0.5.0 (2026-10-12)

**Upgrade:** optional. Pass `runtimeEnvironment` (`production`, `sandbox`, `development` or `unknown`) to label events with their build; superseded by automatic detection in 0.6.0.

- Added the `runtimeEnvironment` option, recorded on each event without changing identity or storage.

## 0.4.0 (2026-10-08)

**Upgrade:** remove every `markNewUser()` call. New users now come from an event chosen in **App setup → New-user definition** (for example `account_created`).

- Removed `markNewUser()` and its local marker; acquisition uses a saved server-side event definition. Old stored state and queued marker events remain readable.

## 0.3.0 (2026-09-28)

- Added `markNewUser()` for explicit first-time use (removed again in 0.4.0).

## 0.2.1 (2026-09-25)

**Upgrade (from the old `mobile-analytics-react-native` archive):** replace the dependency and its imports, including `/ui`, with `@appbasehq/react-native`. Storage keys and event behavior are unchanged.

- First release of the bundled, framework-independent TypeScript core behind the unchanged React Native API: durable queue and workflow state, bounded retries, strict acknowledgement checks, identity/reset/consent, onboarding answers, resumable paywall purchases, explicit feedback and RevenueCat identity links.
- Version 0.2.0 was tagged but never published to npm.

## 0.1.x (2026-09-20)

- Early previews: `@appbasehq/react-native@0.1.1` and the dashboard-hosted `mobile-analytics-react-native-0.1.0` archive. Upgrade to the current version.
