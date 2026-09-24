# Appbase React Native SDK source

This is a generated, independently buildable source mirror for `@appbasehq/react-native`. The npm package is the supported installation route; this repository contains the complete portable implementation and its build/test inputs. It contains no Appbase API, dashboard, database, native lab, customer fixtures or credentials.

`sdks/react-native` is the public facade and optional feedback UI. `packages/sdk-core` owns TypeScript delivery and capture logic. `packages/contracts` contains canonical shared types, validation schemas, limits and reviewed mobile fixtures, not a backend service. Both workspace packages remain `private: true` to prevent accidental separate npm publication; their source is included here, and they are bundled into the public SDK.

## Install in an application

`npm install @appbasehq/react-native`

See [the SDK guide](sdks/react-native/README.md) for storage, lifecycle, identity, onboarding, paywalls and explicit feedback. A source version or repository tag is not evidence that the same version has been published to npm.

## Build and verify this source

Use Node.js 22 or newer and `pnpm@10.23.0`:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm pack:sdk
```

The check runs generated-schema drift validation, the SDK build, workspace typechecks and eight portable test files, including all 19 shared behavior scenarios. `pnpm sdk:conformance` runs only shared scenarios and canonical contract vectors. `pnpm pack:sdk` (also aliased as `pnpm sdk:release` for the SDK guide) creates a local candidate under ignored `artifacts/`; neither command publishes or changes customer installation metadata.

The portable suite uses controlled storage/network adapters. It does not prove real PostgreSQL acceptance, a React Native device runtime, lifecycle crash recovery, store purchases, Swift parity or deployment. Those release gates run in the canonical product repository. Shared contract documents discuss those broader upstream gates; only commands listed in this mirror's package.json are available here. The automatic source-check workflow checks Node 22 and 24 and never publishes. Workflow presence alone is not evidence of a completed hosted run.

## Reviewed npm release workflow

The manual-only workflow at `.github/workflows/npm-publish.yml` defaults to `verify`: it validates and uploads a candidate archive without publishing. It requires an existing immutable `vVERSION` tag pointing to the current `main` commit and the matching package version. The checked-out tag must exactly match the workflow dispatch commit so provenance identifies the source that was verified. Re-run review if `main` has advanced; do not move an existing release tag.

Run `verify` first with the archive SHA-256 left empty to obtain the hosted candidate, `SHA256SUMS`, and the workflow summary. Download and review that candidate and its acceptance evidence. A supplied hash is also checked during verification. Identical source and unpacked tar bytes can produce different gzip archive bytes across Node/zlib distributions, so a local archive hash is not assumed to match the hosted archive. Source input hashes and behavioral checks describe the source and payload; the archive checksum identifies the exact distribution bytes.

An intentional `publish` run requires the reviewed hosted candidate's SHA-256. It rebuilds and verifies that exact digest before the separate `npm` GitHub environment approves publication of the checked artifact through npm OIDC. Configure its required reviewer and restrict it to `main` before publishing; npm trust must match this repository, `npm-publish.yml`, and that environment. The default `next` channel leaves `latest` unchanged. No long-lived npm token is needed. This exporter neither creates tags nor dispatches publication.

Before any release, complete the canonical product repository's full PostgreSQL, Swift parity, native lifecycle and clean external-consumer gates against the reviewed candidate. Passing this mirror's portable CI is only one part of release readiness. The npm workflow's archive verification does not replace upstream acceptance evidence or decide whether a candidate is ready to publish. If a rebuilt archive fails its reviewed checksum, investigate and review a new candidate; never bypass the checksum gate.

## Source of truth and contribution flow

This mirror is exported by `scripts/export-react-native-repository.mjs` from Appbase's canonical product workspace. `EXPORT_MANIFEST.json` records source and exported-file hashes so its exact contents can be reviewed. Changes should be reviewed and integrated in that source of truth, including both SDK runners when changing shared behavior, then exported here. Do not treat editing a generated mirror as a completed cross-SDK rollout.

The package's wire contract version and npm version are independent. Preserve schema-v1 historical compatibility. Keep canonical validators and shared expected fixtures synchronized; `pnpm contract:generate` regenerates this mirror's structural JSON artifacts without changing native constants or another SDK. Read [the behavior contract](packages/contracts/mobile/behavior.md) before modifying capture semantics.

This export does not change npm owners, configure trusted publishing, create GitHub repositories, promote release archives or publish a package. The repository URL in package metadata was verified as a public GitHub repository when exporting.

The SDK source is MIT licensed; see [LICENSE](LICENSE).
