# Appbase React Native SDK

A small explicit-event SDK for Expo and bare React Native. Its core entry point has no React, React Native, Zod or Expo runtime dependency. The optional `/ui` entry point uses your app’s React and React Native. Supply adapters from the app. Create one instance per app/environment, outside component rendering, and reuse it.

## Compatibility and reliability

This guide covers version **0.2.0**. SDK package versions and the wire contract are independent; this release continues to use schema version 1.

The public entry point now bundles `packages/sdk-core`, a framework-independent TypeScript implementation. No private workspace package is needed by consumers, and existing `createReactNativeAnalytics` imports remain valid. `createAnalytics` is an additive alias for adapter-based use. Swift has its own native implementation of the same versioned contract. See [shared compatibility policy](https://appbase.so/docs/sdk-compatibility.md).

Initialization fails without overwriting storage when saved identity/events/workflows are corrupt. Failed acknowledgements leave events queued; duplicated, unknown, empty or contradictory server receipts never discard them. Injected UUIDs must be valid and fresh. Invalid configuration throws before storing a new installation. Observe diagnostics for runtime capture failures; `track()` returning does not prove server receipt. Await `flush()` and inspect `getStatus()`, then verify server delivery separately.

## Install

Open **App setup** in your Appbase dashboard and copy **Install SDK (Expo)**.
Install the public npm package; no repository checkout is needed:

```sh
npm install @appbasehq/react-native@0.2.0
npx expo install @react-native-async-storage/async-storage @react-native-community/netinfo expo-crypto
```

The package is published under the Appbase-owned `@appbasehq` npm organization.
Commit your app’s lockfile. SDK updates are deliberate dependency upgrades and require shipping an app update; deploying the dashboard does not change installed SDKs.
The core has no runtime dependencies or private workspace imports. Native adapters are supplied by the host app. React Native 0.81 / Expo 54 on the iOS simulator is the tested native configuration; other supported peer versions require app validation.

For SDK source development, follow the build and verification commands in the [source repository](https://github.com/appbasehq/appbase-react-native#build-and-verify-this-source). Package publication follows the [release guide](https://appbase.so/docs/sdk-release.md).

Expo example (install compatible packages with `npx expo install @react-native-async-storage/async-storage @react-native-community/netinfo expo-crypto`):

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { createReactNativeAnalytics } from '@appbasehq/react-native';

export const analyticsReady = createReactNativeAnalytics({
  apiUrl: 'https://api.appbase.so',
  collectionKey: 'YOUR_SAVED_COLLECTION_KEY', // Select dev/prod through build configuration.
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  appVersion: '1.0.0', // Supply the actual app/build version.
  storage: AsyncStorage,
  generateId: randomUUID,
  appState: AppState, // Required for automatic repeat app-open tracking.
  networkInfo: NetInfo,
  onDiagnostic: (diagnostic) => {
    // Route diagnostics to your own development logger; don't log event payloads.
    if (__DEV__) console.warn(diagnostic.code, diagnostic.message);
  },
});
```

Bare React Native can use the same storage/network adapters and any secure UUID generator supported by that app. Initialization is asynchronous; handle initialization/storage failures in app startup without blocking the user from using the app. Production API URLs require HTTPS. On a physical phone, localhost points to the phone; use the hosted API or an explicitly configured local development endpoint.

## Automatic app opens

Pass React Native's `AppState` once at initialization, as shown above. The SDK owns these event names; do not manually call `track('app_first_open')` or `track('app_active')`.

- `app_first_open`: recorded once when this app/environment's local SDK storage is first created. Restarting the SDK/app keeps the marker; clearing storage or reinstalling may create a new one.
- `app_active`: recorded at initialization if the app is already active, and when AppState reports `active`. If the initial native state is unknown/null, the SDK waits for the change notification. Background/inactive notifications alone do not create an active event. Foreground notifications are not a session-duration or exact app-launch count.
- Missing `appState` on `ios`/`android` emits one `configuration` diagnostic per SDK initialization. First-open/custom events continue to work, but repeat opens are missing. With no diagnostic handler (or if it throws), a payload-free warning is written to the console. Headless `platform: 'test'` clients are exempt.
- Opt-out suppresses lifecycle events, and `dispose()` removes the listener. Initialize once outside component rendering to avoid duplicate listeners.
- Screen views, navigation parameters, taps and feature actions are not automatically captured. Track app-specific actions explicitly; use the onboarding/paywall helpers for those workflows.

Verify by foregrounding, backgrounding and returning to the lab/app. Its user journey should contain `app_active` without any manual tracking call, while a restart should not add another `app_first_open`.

See [React Native AppState](https://reactnative.dev/docs/0.81/appstate) for the native lifecycle states. Current active-user/retention report rules are documented in the tracking plan; changing SDK setup does not rewrite historical data or report definitions.

## Custom feature events

Use `track()` with stable names for your app's actions. No event registration or extra helper is needed:

```ts
await analytics.track('workout_completed', {
  workout_type: 'strength',
  duration_minutes: 20,
});
```

Feature usage discovers these names automatically and plots them together: users horizontally, times per user vertically, and area for occurrences. Each feature has its own bubble; overlapping circles spread apart with connectors to their true coordinates. Hover or focus shows the exact metrics. Select a bubble (or find its name) to see the feature’s daily/weekly trend and properties for the selected range. Properties describe variants; they do not create separate event rows. Send an event at the action it names: `workout_started` and `workout_completed` have different meanings. Automatic app-open, identity, onboarding and paywall events have their own reports and are excluded here. The old `activity_completed` convention remains accepted as a single custom event name. Select a property beneath the event trend to see category counts or a numeric average/distribution. Lists support multiple values per event; missing/null values are shown separately. Times per user divides event count by distinct performers in the selected range. No extra SDK configuration is needed. Custom dashboards remain future work.

## Onboarding

```ts
const analytics = await analyticsReady;
const onboarding = analytics.onboarding({
  id: 'main',
  version: 1, // Optional; omitted versions are derived from ordered step IDs.
  steps: ['welcome', 'goal', 'notifications'],
});
await onboarding.start();
await onboarding.step('welcome');
// When each of the other screens becomes visible:
await onboarding.step('goal');
await onboarding.step('notifications');
await onboarding.complete();
```

Use positive whole numbers (`1`, `2`, …) for explicit onboarding versions, up to `Number.MAX_SAFE_INTEGER`. Increment the version when you want separate results for a changed flow; it is independent of the app release version. The SDK normalizes numbers to strings in `definition`, saved attempts and event payloads, so `1` and `'1'` refer to the same version. Existing string labels remain supported; `'v1'` is a distinct version and its history is preserved. Omit `version` to derive it automatically from the ordered step IDs.

Define the flow once in app code. Every emitted event includes its immutable definition; the server registers it automatically and the web report appears without setup fields. A version can never be overwritten with different steps or questions. Automatic versions detect step and question/option changes; explicit versions must be incremented for those changes. Existing flows without questions keep their original automatic version.

- `start(properties?)`: start once or resume the saved attempt. Returns its ID, or null when disabled/dropped/failed. Repeated calls, including after completion, do not restart it.
- `restart(properties?)`: explicitly start a new attempt.
- `step(id, properties?)`: record a declared step when visible. Previously visited steps can be revisited; skipping an unreached preceding step is diagnosed and not recorded.
- `answer(questionId, selection, properties?)`: submit one option ID, an array of option IDs, or `null` for an explicit skip. The question's step must already have been viewed in the current, unfinished attempt. This records an answer without another step view. Confirm answers on Continue/Submit, not on each toggle. Empty arrays are invalid; use `null` to skip.
- `complete(properties?)`: record completion once after all declared steps have been recorded.
- `getState()`: `{ attemptId, nextStep, completed }` or null. The zero-based nextStep can equal the number of steps before completion.
- `definition`: read-only ID, resolved version and ordered steps.

Attempts and events are saved together in the existing storage/outbox. A queue/storage failure does not advance progress. Resetting identity or disabling collection clears saved attempts. Calling start after re-enabling begins a new attempt. The report still uses a 24-hour completion window; resuming an older attempt does not extend that window. This version supports linear flows with 1–20 unique step labels and at most 100 definitions per environment. IDs/versions/steps use 1–80 letters, numbers, dots, dashes or underscores, starting with a letter or number.

Configuration mistakes in `onboarding({...})` throw synchronously. Runtime tracking mistakes or storage failures are reported through onDiagnostic. Do not let analytics failures block the product flow.

### Single- and multiple-choice answers

```ts
const onboarding = analytics.onboarding({
  id: 'main',
  version: 2,
  steps: ['goal', 'reminders'],
  questions: [
    {
      id: 'goal',
      stepId: 'goal',
      title: 'What brings you here?',
      type: 'single',
      options: [
        { id: 'habit', label: 'Build a habit' },
        { id: 'focus', label: 'Improve focus' },
      ],
    },
    {
      id: 'times',
      stepId: 'reminders',
      title: 'When would reminders help?',
      type: 'multiple',
      options: [
        { id: 'morning', label: 'Morning' },
        { id: 'evening', label: 'Evening' },
      ],
    },
  ],
});
await onboarding.start();
await onboarding.step('goal'); // Screen appears.
await onboarding.answer('goal', 'habit'); // User confirms their choice.
await onboarding.step('reminders');
await onboarding.answer('times', ['morning', 'evening']);
// If the person explicitly skips instead: await onboarding.answer('times', null);
await onboarding.complete();
```

Questions and option IDs/labels are discovered from the SDK definition; there is no dashboard configuration. Multiple questions can belong to the same step. Up to 20 questions per flow, 1–20 options per question, title ≤160 characters, option label ≤80 characters and the complete definition ≤16 KiB UTF-8 JSON. Stable question/option IDs follow the existing step ID format. Keep display labels consistent across locales within one flow/version. This version supports choices, not free text or automatic form capture.

Answers inherit app/environment, identity, flow/version, attempt and step. Values are defensively copied and multiple selections are normalized to option order. Repeating the same selection is a no-op; a changed selection or explicit skip increments a persisted per-question revision. Revisions and queued events survive restart together. Answering does not advance the step or complete onboarding. Restart/reset starts fresh answer state; opt-out clears it. Calls after completion do nothing, matching the existing step helper. Existing events are never edited.

The chart shows the latest eligible submission per question/attempt, with option counts and percentages of **answered attempts**. Multiple-choice totals may exceed 100%; skips, no recorded answer and conflicting revisions stay separate. Definitions, date/window rules and report limits are in [the tracking plan](https://appbase.so/docs/tracking-plan.md#onboarding-answers).

New collection keys contain the app ID and environment for the SDK storage namespace. The backend authenticates the full key hash; it never trusts a client-supplied environment property. Legacy keys continue to work with their original `appId` and `environment` options. If supplied with a new key, those options must match. Key replacement for the same environment preserves local identity and queued events.

## Paywalls

Define a paywall once, then create a view when it actually becomes visible. Calls record interactions; the app owns its UI and purchase flow.

Use this same API for onboarding and in-app paywalls. Supply `onboarding` only for a presentation belonging to that attempt; omit it for later settings/feature-gate presentations, even when the design is the same. Different designs (including an exit discount) get separate IDs; a discount during onboarding keeps the same onboarding link. There is no second `onboarding.paywall()` API. The dashboard shows linked presentations inside the onboarding journey and other presentations in **In-app paywalls**. See `/docs/paywalls.md` for examples and metric definitions.

Record the configured onboarding steps before showing the linked paywall. The dashboard automatically derives **Paywall viewed → Subscription started** after those ordered steps; do not add a duplicate paywall step. Repeat views and optional discount offers count once per attempt. Subscription starts require the RevenueCat identity/transaction integration below and include trials or direct purchases. `onboarding.complete()` remains independent of buying. Earlier/missing-step paywall presentations stay recorded but are excluded from this ordered path.

```ts
const paywall = analytics.paywall({ id: 'upgrade', version: 1 });
const view = await paywall.view({
  placement: 'onboarding',
  productIds: ['pro_monthly', 'pro_annual'],
  onboarding, // Optional: an already-started onboarding helper from this SDK.
  properties: { experiment: 'layout_a' },
});

// When the user changes the selected plan:
await view?.productSelected({ productId: 'pro_annual' });

// Immediately before invoking the app's purchase flow:
const attempt = await view?.purchaseStarted({
  productId: 'pro_annual',
  offerId: 'trial_7d', // Optional actual offer identifier.
});

// From the app's purchase callback (this does not perform a purchase):
await attempt?.finished({ result: 'succeeded', transactionId: 'STORE_TRANSACTION_ID' });

// When the paywall actually closes:
await view?.dismissed({ reason: 'purchased' });
```

- `paywall({ id, version? })`: stable paywall ID and positive safe integer version (default `1`). Increment it for a changed design; versions are sent as strings. Configuration errors throw synchronously. There is no dashboard preregistration.
- `view({ placement, accessState?, productIds?, onboarding?, properties? })`: returns a handle with `viewId`, or null if disabled, dropped or not persisted. Each call means a new presentation; do not call during each render. Products are exact store IDs, including base plans where applicable. Supply 1–20 unique IDs or omit the list when unknown. Selection/purchase IDs must belong to the list when supplied. The optional onboarding link snapshots its current attempt and flow/version; finishing onboarding does not erase it.
- `accessState`: optional `active`, `inactive` or `unknown` snapshot immediately before presentation. Active includes paid/trial access. Omit when unknown; do not default to inactive. It is persisted as `paywall_access_state` with the view and later interactions, including after restart. Record subscriber views too: the backend excludes known active access from in-app acquisition conversion, while preserving history. Provider periods override an inactive snapshot; missing historical access makes the conversion rate unavailable. This is client evidence, not authorization. See `/docs/paywalls.md#existing-subscribers-and-eligibility`.
- `view.productSelected({ productId, offerId? })`: record an actual selection. Defaults need not generate a selection event; purchaseStarted always carries the purchased product explicitly.
- `view.purchaseStarted({ productId, offerId? })`: returns a handle with `attemptId` and `productId`, or null. Call once per purchase invocation; retries by the customer are new attempts. At most 20 attempts per view.
- `attempt.finished({ result, transactionId?, errorCode? })`: result is `pending`, `succeeded`, `cancelled` or `failed`. Pending can resolve later. Repeating an identical result is a no-op; changing a final result is rejected. Cancellation refers to the purchase dialog, independently of closing the paywall. Result events carry `result_source: 'client'`; they never prove a trial/payment alone. Pass the actual store transaction ID from the purchase result to enable exact matching against trusted RevenueCat billing. See `/docs/paywalls.md#verified-conversions`.
- `view.dismissed({ reason? })`: reason is `close_button`, `back`, `purchased` or `other` (default). Records once. Dismissed views accept late results for existing attempts, but cannot start new attempts or selections. App backgrounding/termination does not synthesize a dismissal or failure.
- `paywall.getView(viewId)` and `view.getPurchase(attemptId)`: retrieve saved handles without new events. Keep these IDs in your app's pending purchase context if you need to resume after a process restart. Up to the latest 100 views are retained across SDK restarts; older handles return null. This bounded local state is separate from queued/server event history.

All interaction methods use the same persistent queue. Selection, result and dismissal return true only when recorded (or already recorded identically), otherwise false; diagnostics explain failures. Queue/storage failures do not advance the saved lifecycle. Tracking failure must not prevent the app from displaying a paywall or completing a purchase. Reset/opt-out invalidate saved views and attempts, so late callbacks cannot be assigned to a new identity. Signing in with identify preserves the anonymous link and active handles.

Custom view properties are copied onto its later events. Reserved paywall/product/purchase/flow fields are controlled by the helper, so custom properties cannot overwrite them. Product, offer, transaction and error identifiers are opaque strings of 1–200 characters without surrounding whitespace. Paywall IDs/placements use the same stable label format as onboarding.

Generic `track(name, properties)` remains available. Properties support strings, finite numbers, booleans, null and bounded string lists (at most 20 entries, each at most 200 characters); nested objects are unsupported. All properties together are limited to 40 fields / 8 KiB UTF-8 JSON. Arrays and event context are copied at call time. Existing placement/version-only `paywall_viewed` events remain supported.

## RevenueCat identity link (optional)

The app owns its RevenueCat installation and authentication. Our SDK has no RevenueCat dependency. After your existing Purchases configuration completes, record its current ID:

```ts
const syncRevenueCatIdentity = () =>
  analytics.linkRevenueCatUser({
    projectId: 'YOUR_REVENUECAT_PROJECT_ID', // A project ID, not any API key.
    getAppUserId: () => Purchases.getAppUserID(),
  });
await syncRevenueCatIdentity();
```

The callback is deliberate: analytics captures its identity **before** asking RevenueCat for the ID. If identify/reset/opt-out occurs while that lookup is pending, it discards the result and reports a diagnostic. Pass a fresh lookup, not a callback returning an ID fetched earlier. Tracking can continue while the lookup runs.

Returns the durable event ID, or null when disabled, stale, invalid, full, lookup-failed or not persisted. Identical consecutive project/customer links for the same analytics identity return the same ID, including after restart. This means recorded locally, not delivered or provider-verified. Events and deduplication state are saved atomically; offline retries preserve the original identity/time/event ID. A changed project/customer or a successful analytics identity change creates new evidence. Project/customer IDs are case-sensitive, opaque 1–255 characters without surrounding whitespace or control characters; do not use an email address as an account ID.

**Account changes:** serialize your existing authentication and RevenueCat operations at the application level. After successful RevenueCat login, call analytics identify for that same app account, then sync. When switching accounts, reset analytics before identifying the next account. After successful RevenueCat logout and analytics reset, sync the new anonymous ID. Sync again after restore and at initialization. Keep the lookup callback limited to reading the current ID; it should not log in/out or mutate analytics identity itself. The SDK cannot detect a RevenueCat-only account change that the app never communicates to analytics.

Do not substitute our anonymous UUID for RevenueCat's App User ID, automatically merge restored users, or change the app's RevenueCat authentication policy to use this helper. RevenueCat has its own anonymous/alias behavior. See [RevenueCat identity documentation](https://www.revenuecat.com/docs/customers/identifying-customers).

The resulting `revenuecat_identity_linked` event has `revenuecat_project_id`, `revenuecat_app_user_id`, and `link_source: client`. It is client evidence, not authentication or entitlement verification. Owner receipt inspection matches these observations to provider-reported IDs/aliases within the mapped app/environment/project. Conflicting subjects remain unresolved; it never merges accounts or turns a successful callback into revenue.

## Identity and collection controls

- `identify('opaque-account-id')`: link anonymous history to an account. No email needed.
- `reset()`: on logout/account switch, create a new anonymous ID and clear onboarding attempts, paywall handles and saved RevenueCat link deduplication. Previously queued events keep their original identity.
- `setEnabled(false)`: disable collection and clear the pending queue, onboarding attempts, paywall handles and saved RevenueCat link deduplication. Already sent requests cannot be recalled. Opt-out persists across restarts.
- `setEnabled(true)`: resume future collection.
- `flush()`: send queued events; concurrent calls share one request sequence.
- `getIdentity()` / `getStatus()`: inspect IDs or pending queue size; these contain no reporting credentials.
- `resume()`: retry after fixing a blocked configuration or re-enabling server collection (usually requires a new client instance if credentials change).
- `dispose()`: remove lifecycle listeners/timers and abort in-flight delivery; queued events persist.

Default bounds: 1000 queued events, batches of 50, flush every 15 seconds, 10-second request timeout. Temporary failures back off up to 60 seconds (Retry-After can extend this). A full queue drops the newest event and reports a diagnostic. Permanent per-event server rejections are removed and reported. Authentication/collection-paused responses block delivery and retain events. HTTP 429 honors Retry-After up to one day, including calls to resume() and connectivity callbacks. getStatus().retryAt is the earliest retry time in epoch milliseconds (or zero).

`app_first_open` is recorded automatically once per app/environment storage namespace. Foreground `app_active` is captured if AppState is supplied, including initialization when `currentState` is already active. Meaningful activity is explicit. The Expo test harness verifies native iOS behavior; Android device validation and integration into the real consumer app remain separate steps.

## Feedback / Contact us

Use `await analytics.feedback({ message, email? })` for explicit contact. Unlike `track()`, it sends directly and only resolves after database storage. On failure, keep `FeedbackError.submissionId` and supply it as `submissionId` on retry to prevent duplicate messages. Email is optional; message length is 1–4,000 characters.

An optional `FeedbackSheet` is exported from `@appbasehq/react-native/ui`; mount it with `analytics`, `visible`, and `onClose` props. It includes the form, validation, acknowledged success and retry handling. It uses your app’s React/React Native; importing the core SDK does not load it.

Explicit contact works while tracking is disabled; in that case analytics identity is omitted. Feedback is stored separately and never counted as feature usage or app activity. See [the complete feedback guide](https://appbase.so/docs/feedback.md) for installation, examples, delivery semantics and the dashboard inbox.
