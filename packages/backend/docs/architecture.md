# Architecture

## Manager Class

The core `Manager` class (in `src/manager/index.js`) extends EventEmitter and orchestrates all functionality:
- Initializes Firebase Admin SDK
- Sets up built-in Cloud Functions (`omega_api`, auth events, cron)
- Provides factory methods for helper classes
- Manages configuration from multiple sources

## Derived config values (`config.resolved.*`)

The composed config a consumer reads (`Manager.config`, and the same object every
route/hook/cron receives) carries a `resolved` group of values the FRAMEWORK derives at
boot ([#290](https://github.com/Omega-JS-Stack/omega/issues/290)). A brand target cannot
require `@omega.js/config` — it is a private package, vendored into the framework's dist
— so a brand that needed a derived value used to re-implement the derivation and drift
from the real merge rules. The framework runs the recipe once; brands read the answer.

| Path | What it is |
|---|---|
| `config.resolved.github.repo` | The brand repo as an `owner/name` slug (`''` unless both halves resolve) |
| `config.resolved.github.owner` | The same answer's owner (GitHub org or user) |
| `config.resolved.github.name` | The same answer's bare repo name |

The GitHub values resolve `repo.providers.github` (`org`, `repo`) overlaid by the backend
target's own `github` block, which wins — the CMS/content-repo override — with `repo`
taking either an `owner/name` slug or a bare name, name falling back to `brand.id` and
owner to `repo.providers.github.org`.

Every derivation lives in `@omega.js/config` (`brandRepo()` here) — never a second copy.
`src/manager/helpers/resolved-config.js` only names the group and the values in it; new
derived values join there as real brand needs surface, each with a test pinning it to the
config package's own function.

## Dual-Mode Support

@omega.js/backend supports two deployment modes:
- **Firebase Functions** (`projectType: 'firebase'`): Cloud Functions with Firebase triggers
- **Custom Server** (`projectType: 'custom'`): Express server for non-Firebase deployments

## Helper Factory Pattern

All helpers are accessed via factory methods on the Manager instance:

```javascript
Manager.RouteContext({ req, res })  // Request handler
Manager.User(data)               // User properties
Manager.Analytics({ ctx }) // GA4 events
Manager.Usage()                  // Rate limiting
Manager.Middleware(req, res)     // Request pipeline
Manager.Settings()               // Schema validation
Manager.Utilities()              // Batch operations
Manager.Metadata(doc)            // Timestamps/tags
Manager.storage({ name })        // Local JSON storage (lowdb)
```
