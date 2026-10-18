# Changelog: @appbasehq/react-native

Newest first. Each release says what changed and what an upgrade needs. To upgrade, read every entry between your installed version and the target, apply each **Upgrade** step, then:

1. Install the exact version (`npm install --save-exact @appbasehq/react-native@VERSION`) and commit the lockfile. Pin exact versions; the npm `latest` tag can lag behind the newest release.
2. Run `pod install` (bare React Native) or rebuild the Expo development and production builds, since the package includes an iOS module.
3. Launch a development build, confirm events still arrive in App setup, and ship an app update. Installed apps keep their old SDK until then.

Wire schema v1, stored identities and queued events carry over between all versions below unless an entry says otherwise. Swift releases are in the [Swift changelog](https://appbase.so/docs/swift-sdk-changelog.md); wire and storage details are in the [compatibility notes](https://appbase.so/docs/sdk-compatibility.md).

## Unreleased

Nothing yet.

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
