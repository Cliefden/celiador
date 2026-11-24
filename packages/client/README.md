# @celiador/client — the daemon's client contract

One description of the daemon's HTTP API, shared by every client:

| File | What it is |
|---|---|
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1 spec of every route in `daemon/src` — request bodies, responses, errors, auth, and the event payloads of the SSE streams. **The source of truth.** |
| [`src/schema.ts`](src/schema.ts) | TypeScript types generated from it with [openapi-typescript](https://openapi-ts.dev) (pinned). Committed; never edit by hand. |

Clients: the editor's built-in `celiador-ai` extension (`Cliefden/celiador-editor`),
`celiador-remote` (`Cliefden/celiador-remote`) and the iOS app (`ios/`). Today
each still carries its own hand-written copy of these shapes; switching them to
the generated types is the next step of [#68](https://github.com/Cliefden/celiador/issues/68).

## The rule: API changes are additive only

Released clients can't be updated in lockstep with the daemon. An editor build
from months ago, a `celiador-remote` version someone never updated, and an iOS
build waiting in App Review all talk to the same production daemon. So:

- **Never remove or rename** a route, a field, a query parameter, an enum value
  the daemon sends, or an SSE event kind.
- **Never make an optional field required**, in a request or a response.
- **Never change a field's type** (or narrow it: `string | null` stays nullable).
- **New request fields are optional**, with the old behaviour when absent.
- **New response fields are optional** in the spec, so old clients that don't
  know them keep decoding.
- **New enum values and event kinds are allowed**, and clients must ignore the
  ones they don't know (the iOS decoders included).
- To retire something, stop using it in every client first; mark it
  `deprecated: true` in the spec and keep serving it until no released client
  sends it.

CI enforces the mechanical part: on every pull request that touches the spec,
[oasdiff](https://github.com/oasdiff/oasdiff) compares `openapi.yaml` against
the base branch's and fails on a breaking change
(`.github/workflows/client-contract.yml`).

## Changing the API

The spec is maintained by hand next to the handlers. In the same pull request
that changes a route in `daemon/src`:

1. Update `openapi.yaml` (route, request/response schema, status codes).
2. Regenerate the types and commit them:

   ```sh
   cd packages/client
   npm ci
   npm run generate   # openapi.yaml → src/schema.ts
   npm run check      # what CI runs: regenerate + fail on diff, then tsc
   ```

To run the breaking-change check locally against `main`:

```sh
git show origin/main:packages/client/openapi.yaml > /tmp/base-openapi.yaml
oasdiff breaking /tmp/base-openapi.yaml packages/client/openapi.yaml --fail-on ERR
```

## Using the types (TypeScript)

```ts
import type { components, paths } from "@celiador/client"; // or a relative path to src/schema.ts

type Session = components["schemas"]["Session"];
type SessionEvent = components["schemas"]["SessionEvent"]; // the SSE payload of GET /api/sessions/{id}/events
type TaskList = paths["/api/tasks"]["get"]["responses"][200]["content"]["application/json"];
```

The types have no runtime part. They also work with
[openapi-fetch](https://openapi-ts.dev/openapi-fetch/) should a client want a
typed fetch wrapper, but nothing requires it.

### Server-Sent Events

OpenAPI 3.1 has no way to type an SSE stream's events, so each `text/event-stream`
response lists its events in an `x-sse-events` extension (event name → schema;
`message` is the unnamed default event) and the payload schemas live in
`components.schemas`:

| Stream | Event payloads |
|---|---|
| `GET /api/sessions/{id}/events` | `SessionEvent` (frame `id` = `seq`) |
| `GET /api/sessions/{id}/commands` | `SessionCommand` |
| `GET /api/presence/commands` | `EditorCommand` |
| `GET /api/tasks/stream` | `Task` (event name `task`) |
| `POST /api/agent/messages` | `AnthropicStreamEvent`, `AgentStreamError` |
| `POST /api/anthropic/v1/messages` (`stream: true`) | Anthropic's stream, passed through |

Every stream also sends an empty `ping` event as a heartbeat.

## Swift

Not generated yet (TODO, next slice). The iOS app's API code (`ios/Shared/`) is
deliberately dependency-free — it compiles into the app, the widgets and the
Live Activity — and Apple's
[swift-openapi-generator](https://github.com/apple/swift-openapi-generator)
emits types that import `OpenAPIRuntime` even in types-only mode, and runs as an
SPM build plugin or a CLI built from source. Options for the next slice:

- generate with swift-openapi-generator (types only) and vendor the few
  `OpenAPIRuntime` types it references, or
- a small generator of plain `Codable` structs for `components.schemas` only,
  run in CI with the same "regenerate and fail on diff" check.

Until then the spec is the reference the hand-written Swift models are checked
against.
