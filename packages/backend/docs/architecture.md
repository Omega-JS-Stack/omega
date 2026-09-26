# Architecture

## The `Omega` instance

The package's main export is ONE instance of the `Omega` class (`src/omega/index.js`, an EventEmitter); a consumer never writes `new`:

```javascript
const omega = require('@omega.js/backend');

omega.initialize({ /* options */ });

module.exports = omega.functions;
```

`initialize(options)` is synchronous (Firebase reads a functions entry's exports at module load) and returns the instance. It:
- loads the `.env` cascade and the composed config (`omega.config`, with `config.resolved`), and resolves the environment once
- initializes Firebase Admin (`omega.firebase.admin`, `omega.firebase.app`)
- builds the process services (`omega.utilities`, `omega.storage()`, `omega.email`, `omega.ai`) and the instance's own logger (`omega.logger`)
- wires the built-in Cloud Functions into `omega.functions` (`omega_api`, the auth and Firestore triggers, the cron schedules), or starts the custom server

The option list and every member of the instance: [the guide](../../../docs/backend/index.md#the-consumer-entry).

## `Context`

Every route, event and cron job runs with ONE `Context` (`src/omega/context.js`), the `ctx` its handler receives. It carries the tagged logger, the response door (`respond`, `redirect`, `report`), authentication, the parsed request (`ctx.request`, null outside HTTP), the validated input (`ctx.data`), and the request services, each built on first read: `ctx.user`, `ctx.usage`, `ctx.analytics`, `ctx.email`, `ctx.ai`, `ctx.metadata()`.

## Derived config values (`config.resolved.*`)

The composed config a consumer reads (`omega.config`, the same object every
route, hook and cron job reaches through `omega`) carries a `resolved` group of values the FRAMEWORK derives at
boot ([#290](https://github.com/Omega-JS-Stack/omega/issues/290)). A brand target cannot
require `@omega.js/config` — it is a private package, vendored into the framework's dist
— so a brand that needed a derived value used to re-implement the derivation and drift
from the real merge rules. The framework runs the recipe once; brands read the answer.

| Path | What it is |
|---|---|
| `config.resolved.github` | The brand's SOURCE repo, or `null` when the config names no org |
| `config.resolved.github.slug` | That repo as an `owner/name` slug |
| `config.resolved.github.owner` | The same answer's owner (GitHub org or user) |
| `config.resolved.github.name` | The same answer's bare repo name |

The GitHub value is the brand's SOURCE repo, `<brand.id>-omega` under the one
`repo: { provider, org }` block ([#883](https://github.com/Omega-JS-Stack/omega/issues/883)).
No repo name is configurable anywhere: the per-target `github` override, the top-level
`github` block and the `repo.providers.*` keys are all retired, and a config still
carrying one fails validation. `null` is the honest answer for a brand that declares no
org, and the CMS routes answer "GitHub repo not configured" off exactly that.

Every derivation lives in `@omega.js/config` (`sourceRepo()` here), never a second copy.
`src/omega/helpers/resolved-config.js` only names the group and the values in it; new
derived values join there as real brand needs surface, each with a test pinning it to the
config package's own function.

## Dual-Mode Support

@omega.js/backend supports two deployment modes, picked by the brand's config —
`targets.backend.projectType` in `config/omega.json5`, read by `initialize()`, so a
consumer's `src/index.js` is the same in both. An explicit `projectType` option overrides it.
- **Firebase Functions** (`projectType: 'firebase'`, the default): Cloud Functions with Firebase triggers
- **Custom Server** (`projectType: 'custom'`): the same routes, schemas, request pipeline and
  services (the framework's routes under `/omega/`, a consumer's at their own path), served by the Express app on `process.env.PORT` (`src/omega/server.js`,
  `omega.server`) for a container host. `firebase-functions` is never loaded
  (`omega.firebase.functions` is `null`); `firebase-admin` still is. The Firebase-only CLI verbs (`deploy`, `serve`, `emulator`, `test`) refuse and
  name their replacement lane — `src/cli/utils/project-type.js` is the one home of that list.

## Services

A route never constructs a service: it reads it off `ctx` or `omega`. Each service is one class, `class X { constructor(owner) }` (`src/omega/services/`): a process service takes `omega` and is built once, a request service takes `ctx` and is built on its first read.

```javascript
omega.utilities                  // Firestore/Auth iteration, randomId(), slugify(), sanitize(), trim()
omega.storage({ name })          // A named local JSON store (lowdb)
omega.email / ctx.email          // Transactional and marketing email
omega.ai / ctx.ai                // OpenAI and Anthropic
ctx.user                         // The caller, a User from @omega.js/account
ctx.usage                        // The counted-feature gate
ctx.analytics                    // GA4 events as the caller
ctx.metadata(metadata, document) // A document's metadata block
ctx.data                         // The input, validated by services/settings.js
```
