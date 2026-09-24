# Mobile contract v1

This directory is the language-neutral agreement between the collection API and every mobile SDK. It is checked into the same repository as the implementations so a feature review can include server behavior, SDK behavior and its tests together.

The canonical runtime schemas remain in `../src/index.ts`, `../src/mobile-feedback.ts` and `../src/mobile-response.ts`. `../src/mobile-constants.ts` owns numeric limits and defaults. Run `pnpm contract:generate` after changing those sources; `pnpm contract:check` rejects stale generated artifacts. Do not edit `*.schema.json` or `limits.json` manually. The `$id` values identify schemas; the URLs do not imply a deployed schema registry.

JSON Schema exports describe structure. The existing Zod refinements still enforce cross-field consistency, reserved event semantics and serialized byte budgets; the export does **not** replace the server validator. The server uses Zod 4.6 string limits counted in Unicode code points, as does JSON Schema `maxLength`. Existing TypeScript SDK string limits are conservatively counted in UTF-16 code units; native clients preserve that SDK behavior. This distinction deliberately retains historical server acceptance. Native implementations must also use the rules below and the vectors; a generic JSON Schema validator does not establish behavioral parity.

| File                           | Authority and purpose                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `*.schema.json`, `limits.json` | Generated structural descriptions and canonical numeric limits                                |
| `behavior.md`                  | Versioned semantic rules and failure guarantees                                               |
| `scenarios/*.json`             | Reviewed actions and expected observable network payloads/status/diagnostics                  |
| `validation-vectors.json`      | Server validation compatibility examples, including custom refinements and Unicode boundaries |
| `vectors/property-bytes.json`  | Shared JSON byte-count and UTF-8 boundary cases, including numeric spellings                  |
| `fingerprint-vectors.json`     | Fixed automatic onboarding-version compatibility examples                                     |
| `scenario-format.md`           | Language-neutral runner grammar                                                               |
| `compatibility.md`             | Change/release policy and SDK capability evidence                                             |

Run `pnpm sdk:conformance` for the React Native public API runner and canonical contract tests. The native runner belongs to `sdks/swift/Tests`; run `swift test --package-path sdks/swift`. Swift and TypeScript execute the same scenario files directly; they do not maintain copied fixtures. Both compare against expected results, rather than treating either implementation as the oracle. The TypeScript runner also validates emitted requests through the real canonical schemas.

These controlled tests use simulated storage/networking. They do not prove physical-device lifecycle, actual disk crash behavior, StoreKit/RevenueCat sandbox purchases, or hosted deployment. Those acceptance layers and published-package checks remain separate release requirements.

## Repeatable checks and CI

`pnpm sdk:conformance` runs the TypeScript shared scenarios, canonical validation/fingerprint vectors and the real PostgreSQL compatibility corpus. The existing local test guard requires a localhost database whose name ends in `_test`; run `pnpm db:up` first for the default configuration. `pnpm sdk:swift:test` runs native unit and shared-scenario tests. `pnpm sdk:swift:http` uses a native Swift consumer across two process launches and real local HTTP/PostgreSQL; `pnpm sdk:swift:ios` builds and runs an isolated simulator app against the same local test database. The latter two require macOS with Xcode. `pnpm sdk:candidate:check` packages current React Native source into an ignored candidate directory and validates a clean consumer install without changing the published release. `pnpm sdk:check` runs all these gates.

After preparing that candidate, `pnpm sdk:react-native:http` installs it into a clean temporary consumer and exercises actual HTTP, a controlled 503 outage, disk persistence through SDK recreation, replay deduplication and PostgreSQL-backed reports. Its evidence explicitly identifies the portable SDK running on Node.js; this is not a React Native device/lifecycle test. `pnpm sdk:setup:test` checks desktop/mobile customer setup in Chromium with isolated local credentials and PostgreSQL; install its browser first with `pnpm exec playwright install chromium`. Both write credential-free summaries under `test-results/multi-sdk/`, remove their owned fixtures, and run in the comprehensive `sdk:check` command. CI runs browser acceptance on Node 24 and HTTP acceptance on both supported Node versions.

`.github/workflows/sdk.yml` configures Node 22/24 Linux checks using PostgreSQL 17 and a macOS job for Swift, native HTTP and iOS simulator acceptance. The macOS job pins the reviewed Xcode installation, initializes its own temporary PostgreSQL cluster, and removes it at job end. Actions are pinned to reviewed commit SHAs; updates should be deliberate. The workflow reads no hosted credentials and performs no deployment or publication. Workflow presence is not evidence that hosted CI ran: this checkout currently has no remote, and remote execution status must be recorded separately. Runtime image/toolchain availability may require a reviewed update when GitHub retires an image.
