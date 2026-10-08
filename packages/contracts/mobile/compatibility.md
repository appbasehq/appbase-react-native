# SDK compatibility and release policy

Both SDK implementations target mobile contract v1. Package versions are independent of the wire version. Use the versioned installation instructions in each SDK guide and verify that exact npm version or Swift package tag exists. Source conformance evidence alone does not establish publication or acceptance of a different revision.

| Capability                                                | Shared fixture evidence                                                                                    | React Native implementation               | Swift implementation                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Durable queue, retry/ack, blocked state, storage rollback | Offline restart; partial/invalid/empty acknowledgements; rejection; rate limit; capacity; storage rollback | Implemented; shared runner                | Implemented; shared scenarios pass                         |
| Identify/reset and consent                                | Identity reset; consent restart                                                                            | Implemented; shared runner                | Implemented; shared scenarios pass                         |
| Local validation                                          | Invalid input; server validation vectors                                                                   | Implemented; canonical Zod + SDK checks   | Implemented; native checks + real API/Postgres             |
| Onboarding and answer revisions                           | Onboarding answer revisions; fingerprint vectors                                                           | Implemented; shared runner                | Implemented; shared scenarios pass                         |
| Paywall purchases and late outcomes                       | Pending result after dismissal/restart                                                                     | Implemented; shared runner                | Implemented; shared scenarios pass                         |
| RevenueCat client identity                                | Persistent deduplication and account changes                                                               | Implemented; shared runner                | Implemented; shared scenarios pass                         |
| Explicit feedback                                         | Opt-out; uncertain retry                                                                                   | Implemented; shared runner                | Implemented; shared scenarios pass                         |
| Native lifecycle and durable files                        | Platform-specific tests, separate from shared fixtures                                                     | Existing adapter/lab evidence in PROGRESS | Native tests pass; simulator acceptance tracked separately |
| Framework feedback UI                                     | Platform-specific UI tests                                                                                 | React Native feedback sheet               | Optional; no parity claim for a SwiftUI sheet              |

This matrix describes required support and test location. Exact run outcomes, compiler/platform evidence and remaining release blockers belong in `PROGRESS.md` and SDK release documentation. A missing runner or skipped fixture never counts as passing. Device, publication and purchase acceptance are separate from source conformance.

For a client-facing change:

1. Review the intended behavior and compatibility impact. Add or update schemas, constants, behavior rules and language-neutral scenarios/vectors together.
2. Implement the capability in every supported SDK. If an intentional gap remains, record the gap explicitly with API/install guidance; do not silently mark the capability supported.
3. Regenerate exports and native constants, then run artifact drift, both SDK suites and server tests using real local PostgreSQL. Keep historical payload vectors.
4. Update SDK guides, agent handoff/setup instructions and this capability matrix. Verify the actual package in a clean consumer, not only a monorepo import.
5. Deploy backward-compatible server support before releasing clients that send new fields. Publish each SDK independently with changelog/compatibility evidence, then update copied installation versions to packages that really exist.

Never weaken validation to make a failing scenario pass without reviewing its intended behavior. Never remove historical payload compatibility just because the latest SDK changed. Breaking behavior requires an explicit migration/deprecation policy and a new contract boundary where appropriate. Server-only report changes usually need neither SDK release; platform fixes still run shared conformance to detect regressions.

## Acquisition migration

React Native 0.3.0 and Swift 0.2.0 shipped the former `markNewUser()` helper. React Native 0.4.0 and Swift 0.3.0 remove that source API and local deduplication behavior by explicit migration. Acquisition now uses a saved server-side event definition. Remove helper calls when upgrading; reuse existing tracking. No collection wire version, storage namespace or identity change is required. Old states and queued marker events remain readable; `legacy-marker-upgrade` verifies both runners. The obsolete helper-only scenarios are removed; generic delivery/consent/storage scenarios remain. Published archives and tags stay immutable. Check release manifests for availability, and see [configured acquisition](behavior.md#configured-acquisition).
