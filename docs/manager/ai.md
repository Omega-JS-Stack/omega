# The ai service — one key per AI provider

The `ai` service ([#639](https://github.com/Omega-JS-Stack/omega/issues/639)) provisions
NOTHING: there is no AI platform API to reconcile a brand against, only two credentials the
backend needs before it can call OpenAI or Anthropic (contact inference, content and
newsletter generation). The whole service is the shared setup contract's gate plus a line in
the run record naming which providers the brand has credentials for.

It runs before the delivery lane, because the keys must be in the brand `.env` before a
target's runtime env composes from it.

## What it reconciles

One operation, `keys`: by the time it runs the setup gate has already acquired what was
missing (or skipped the service), so the environment IS the answer. It prints which of the
declared keys are present — NAMES only; a value never reaches the log — and returns them as
the operation's output.

## Config and credentials

- `ai.enabled: false` — the tri-state opt-out. A brand that does not want AI answers "Disable
  permanently" once and is never asked again.

`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in the brand `.env`. Both are OPTIONAL
(`gates: false`): preflight never gates a run on them, and the service asks in place. The
legacy split — a company-wide `OMEGA_*` key beside the brand's bare one — is GONE: the bare
name is the only name, and a company-wide value is simply the COMPANY layer of the `.env`
cascade under that same name.

## Gotcha

`ANTHROPIC_API_KEY` is a workspace API key. A Claude Code subscription login is a separate
thing and needs no key — the two are often confused when a brand's translation lane works
locally but not in CI.
