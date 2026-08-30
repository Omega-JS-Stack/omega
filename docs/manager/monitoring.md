# The monitoring service — one Sentry project per target

The `monitoring` service (Sentry provider) creates one error-monitoring project per enabled
target — web, backend, desktop, extension — and lands each project's DSN in the brand's
config. It has no cross-service dependencies: its own API, its own token.

The cross-framework error-reporting contract — the doctrine, the switches, the release tags,
the capture seams — is [monitoring.md](../shared/monitoring.md); this file is what the manage
walk provisions.

## What it reconciles

- **`projects`** — resolves the org (config wins, else the token's one visible org, written
  back to `monitoring.providers.sentry.org`) and the team, then ensures one project per
  enabled target.
- **`dsn`** — each project's client-key DSN written to
  `targets.<type>.monitoring.providers.sentry.dsn`
  ([#425](https://github.com/Omega-JS-Stack/omega/issues/425)) through the comment-preserving
  writeback. DSNs are PUBLIC by design and schema-pinned, so config is their home; only the
  auth token is a secret. The resolved value always wins — a hand-set stale DSN is drift and
  gets patched — and a converged rerun leaves the file byte-identical.

## Config

| Key | Meaning |
|---|---|
| `monitoring.enabled: false` (or `monitoring: false`) | Skip. |
| `monitoring.providers.sentry` | The monitor is a KEY under `providers`: no entry means none chosen and the service skips. Any other key is "not a known monitor". |
| `monitoring.providers.sentry.org` | The Sentry org — resolved and written back when absent. |
| `targets.<type>.monitoring.providers.sentry.dsn` | Where each DSN lands. |

**Credential**: `SENTRY_AUTH_TOKEN` in the brand `.env` — a PERSONAL auth token with
`org:read`, `project:read`, `project:write`, `team:read`, `team:write`.

## Gotchas

- **Sentry's "organization tokens" cannot create teams or projects.** They are CI-scoped; only
  a personal token works here, which is why the setup hint spells the scope list out.
- **A project with no active client key** cannot yield a DSN. The operation says to create one
  and rerun — closing that with an API call (`createProjectKey`) is a separate enhancement, not
  a wait: there is nothing to poll for.
