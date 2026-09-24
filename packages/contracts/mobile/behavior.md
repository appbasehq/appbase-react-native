# Mobile behavior contract — version 1

Wire `schema_version: 1` and this behavior specification are separate from SDK package versions. Preserve old-client acceptance when adding features; app-store installs are not upgraded by publishing a new SDK.

## Ownership and validation

The server owns authoritative persistence, deduplication, tenant/environment isolation, verified billing and report calculations. SDKs own offline state, occurrence-time snapshots, native lifecycle adaptation and capture helpers. Collection keys are public write-only credentials. Never place reporting credentials in an SDK. SDK diagnostics must not include collection keys, raw user properties or feedback text, and an observer failure must not break the host app.

Only declared top-level event fields are accepted. Properties are flat finite numbers, booleans, null, strings or bounded arrays of strings; nested values are invalid. Numeric limits come from `limits.json`. SDK string limits count UTF-16 code units to preserve existing TypeScript behavior. The canonical Zod 4.6 server accepts string limits in Unicode code points; keep this historical, slightly broader acceptance rather than narrowing old-client compatibility. Serialized size budgets count UTF-8 bytes of JSON including escaping. A multi-byte character can fit the character bound and exceed the byte bound. JSON object key order is not semantically relevant except for the explicitly defined automatic-version fingerprint input.

Reserved event validation is stricter than general shape: identity links require a user; onboarding events require flow/version/attempt context; question answers must agree with the declared question/options/cardinality; paywall actions require the complete view/product/purchase context applicable to that action. Partial onboarding context on a paywall is invalid. Historical placement/version-only `paywall_viewed` events remain accepted. Client `subscription_*` events never verify revenue. RevenueCat links are client identity evidence with `link_source: client`, not authentication or proof of a purchase. `validation-vectors.json` exercises these existing canonical rules.

## Configuration and lifecycle

Scope durable state by app and environment, never by SDK API object lifetime. Namespaced keys determine this scope; an explicit conflicting app/environment is an error. Legacy keys require explicit scope. Production endpoints require HTTPS. Reject invalid configuration before replacing existing state. Defaults and upper bounds for queues, timers and request timeouts come from `limits.json`; queue capacity and batch count must be whole positive numbers, a zero flush interval disables periodic flushes, and the server caps batches at 100 events. TypeScript's existing positive batch-size clamp at the server maximum is preserved.

Record `app_first_open` once when establishing durable installation state. Preserve installation identity through logout/reset. Native adapters record `app_active` on active cold launch and foreground transitions and own any bounded background flush. Do not infer additional opens from helper calls. Controlled shared scenarios disable automatic lifecycle and periodic timers; native lifecycle checks are a separate requirement.

## Durable delivery and errors

Capture ID, timestamp, identity and a copy of properties at the time of an operation. Persist an event before treating it as recorded. Retry the same immutable event; never regenerate its ID/time/identity after failure or restart. Serialized operations must commit workflow progress and its event together. Failed storage writes roll back their in-memory changes and report failure. Reject the newest event when the bounded queue is full, retain older entries and increment the dropped counter. A rejected event must not advance its workflow.

One delivery sequence may be active per client. Batches obey both event-count and byte budgets. Network exceptions, timeouts, invalid/empty acknowledgements and 5xx responses retain unacknowledged events and apply bounded backoff. HTTP 429 also observes `Retry-After`; explicit `resume()` or network reconnection must not bypass an active server minimum. Other rejected HTTP responses block delivery until configuration is corrected and explicitly resumed. A restart is not permission to silently erase the queue.

Collection and feedback transports must not follow redirects to another endpoint with credentials or payloads. TypeScript requests specify `redirect: error`; injected and native React Native fetch adapters must honor this option and abort signals. The presence of the option is tested, but React Native platform enforcement still needs device/runtime evidence; do not claim browser fetch behavior proves it on every native version. Swift's URLSession adapter rejects redirects explicitly. Custom transports remain responsible for bounded response buffering and honoring cancellation.

A successful HTTP status alone is not a durable acknowledgement. Validate the response shape and membership against the batch that was actually sent. An acknowledgement must not contain unknown IDs; contradictory or duplicate dispositions must not cause silent removal. Remove only individually accepted or permanently rejected sent events, and persist that removal. Partial acknowledgements retain every remaining event. Diagnostic `rejected` identifies the permanently rejected event; malformed responses produce `network` and preserve the queue. If the server stored a batch but the response or local acknowledgement save is lost, replay must be safe through server deduplication.

The wire schema permits `event_id: null` in server rejection records for malformed incoming events. Such an ID can never identify a queued valid client event; clients must not remove anything based on it. The server's permissive envelope parser intentionally validates each event separately to provide individual rejections.

## Identity, consent and late callbacks

`identify` links the current anonymous identity to an opaque user. Switching from one user directly to another requires reset. Reset generates a new anonymous identity and clears active onboarding/paywall/RevenueCat linkage state while preserving installation identity and already queued events with their original owners. Outstanding async provider lookups must not attach results to a new identity. Paywall handles and workflows from before reset must not create post-reset events.

Disabling analytics durably clears queued analytics and workflows and prevents new analytics events; it survives restart. Abort active collection transport where supported. Re-enabling does not manufacture a second first-open. Explicit feedback remains available while analytics is disabled, without analytics identity attached. Disposal removes timers/listeners and prevents further analytics operations.

## Onboarding

Definitions are immutable and versioned. Start resumes the existing attempt, including a completed one; explicit restart creates a new attempt. Steps advance in declaration order. Repeated viewed-step events remain allowed, but completion requires all steps. Attempts persist through restart. Helpers overwrite caller-supplied reserved context with the actual flow/attempt IDs.

Answers are recorded only after reaching the declared step. Single-choice accepts one option; multiple-choice accepts unique declared options. Canonicalize selected options to definition order. `null` means explicitly skipped and produces an empty array with `answer_status: skipped`. Deduplicate repeated equivalent answers, including after restart. A changed answer increments its positive safe-integer revision. Keep the definition on onboarding events so reports can validate observed versions.

Automatic versions are compatibility fingerprints, not security hashes: serialize ordered `steps` alone if no questions, otherwise serialize `{steps,questions}` using fields in this order. Every question uses `id,stepId,title,type,options`; every option uses `id,label`. Match JSON.stringify compact escaping, iterate Unicode code points, take the first UTF-16 code unit of each point, then update unsigned 32-bit accumulators initially `0x811c9dc5` and `0x9e3779b9` by XOR with that unit and multiply modulo 2^32 by `0x01000193` and `0x85ebca6b`. Emit `auto-` plus each accumulator as eight lowercase hexadecimal digits. The server compares complete definitions, so a collision must not overwrite a different definition. See fixed fingerprint vectors.

## Paywalls and billing identity

Each actual presentation creates a distinct view. Capture paywall/version, placement, shown products, pre-presentation access state and optional full onboarding attempt context. Resume saved views without another exposure. Product actions must refer to a shown product when a list is known. Each purchase attempt is distinct and durable. Pending outcomes may resolve after dismissal/restart; final outcomes are idempotent and cannot be changed to another result. Preserve the exact store transaction ID; an app-reported success is never verified revenue. Reset/opt-out invalidates saved views/purchases.

RevenueCat identity lookup is optional and has no SDK dependency on RevenueCat. Deduplicate identical project/user links within the same analytics identity across restart. Identify/reset/opt-out invalidate the previous link and stale lookup results. Errors are diagnosable and retryable; they never invent provider IDs or expose provider secrets.

## Feedback

Feedback is an explicit HTTP submission, not a queued analytics event. Normalize message/email whitespace, validate bounds and receipt identity/time, and resolve only after a valid receipt. Preserve the submission UUID in errors so uncertain delivery can be retried with exactly the same message and ID. An ID reused for different content is a conflict. Offline, malformed-success, rate-limit, unavailable and configuration errors remain distinguishable. No automatic analytics consent is implied by submitting feedback.
