# Shared scenario format v1

Each JSON file contains `version`, unique `id`, `capability`, `config`, ordered `actions` and `expect`. Both runners fail on unsupported actions rather than skipping them. Config supplies fixed occurrence time (`now`), platform, app version and optional queue/batch sizes. Use a deterministic valid UUID generator; the exact call order is not contractual. Disable periodic timers and automatic lifecycle. Recreate SDK instances using the same simulated durable store for `restart`.

`expect.requests` contains every attempted transport request in order, including attempts that fail offline. Compare request path and decoded JSON body recursively with exact object keys, array ordering and scalar values. Do not ignore nulls, missing fields, unexpected fields or properties. Object-key order does not matter. Strings beginning `$uuid:` bind a valid UUID on their first appearance and require that same value thereafter; different labels must bind different UUIDs. This establishes original ID/identity retention without depending on private generator call order. Tokens are only an expectation syntax, never sent to the SDK.

Compare `expect.status` to the public `queued`, `dropped`, `enabled`, `blocked` fields. Retry timestamps are implementation-independent clock measurements and are not compared directly. `expect.diagnostics` is the ordered list of diagnostic codes accumulated across recreations; prose messages may differ. Diagnostic callbacks must be nonthrowing in shared scenarios; observer failure belongs to native focused tests.

| Action                                                          | Additional fields and meaning                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `clock.set`                                                     | `now` ISO timestamp; change injected occurrence clock so retries must preserve older events                                            |
| `track`                                                         | `name`, optional `properties`; invoke public capture API                                                                               |
| `identify`                                                      | `userId`                                                                                                                               |
| `reset`, `flush`, `resume`                                      | No arguments                                                                                                                           |
| `setEnabled`                                                    | `enabled` boolean                                                                                                                      |
| `restart`                                                       | Dispose/recreate same durable store, keep captured requests and semantic handle IDs; clear actual helper objects                       |
| `storage.failNext`                                              | Fail the next durable save before changing stored bytes                                                                                |
| `network`                                                       | Append exactly one `response` to the fake transport's FIFO                                                                             |
| `onboarding.define`                                             | `handle`, `definition` (native onboarding API input)                                                                                   |
| `onboarding.start`, `onboarding.restart`, `onboarding.complete` | `handle`, optional `properties`                                                                                                        |
| `onboarding.step`                                               | `handle`, `stepId`, optional `properties`                                                                                              |
| `onboarding.answer`                                             | `handle`, `questionId`, `selection` string/list/null, optional `properties`                                                            |
| `paywall.define`                                                | `handle`, `id`, optional numeric `version`                                                                                             |
| `paywall.view`                                                  | `handle`, `view` name, `options`; optional `onboarding` helper name                                                                    |
| `paywall.purchase`                                              | `view`, `purchase` name, `product`                                                                                                     |
| `paywall.result`                                                | `purchase`, `result` object; success must return true                                                                                  |
| `paywall.dismiss`                                               | `view`, `reason`; success must return true                                                                                             |
| `paywall.resumeView`                                            | `handle`, `view`; use remembered view ID through public lookup                                                                         |
| `paywall.resumePurchase`                                        | `view`, `purchase`; use remembered attempt ID through public lookup                                                                    |
| `revenuecat.link`                                               | `projectId`, `appUserId`; provide callback returning that ID and require valid returned event UUID                                     |
| `feedback.submit`                                               | `input`, optional `expectError` code; successful receipt must match submission ID and include valid timestamp; errors must preserve ID |

Transport response kinds:

- `offline`: throw a transport error after recording the request.
- `ack`: HTTP 200, optional `accepted` zero-based indices and `rejected` entries `{index,reason}` referring to the current request's events. An omitted accepted list acknowledges all events; an explicit empty list acknowledges none.
- `http`: arbitrary HTTP `status`, optional `headers` and optional JSON `body` (default `{}`).
- `raw`: arbitrary JSON response `body`, optional `status` (default 200) and `headers`, used for malformed acknowledgements.

After scripted responses are consumed, default to acknowledgement of all sent events or a valid matching feedback receipt using `config.now`. Require all scripted responses to have been consumed, so a fixture cannot pass without exercising its intended failure. Never implement retry, queue, identity, workflow or consent behavior in a runner; runners only adapt these actions to the actual public SDK APIs.
