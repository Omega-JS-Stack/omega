# @omegajs/manager

The OMEGA orchestration engine — omega-manager's brains, ported into the monorepo for the brand-monorepo world. `omega-manager` (or `npx omega-manager` in any brand repo) walks every service in dependency order and reconciles each one to the brand's `config/omega.json5`, **idempotently**: run it twice, get the same result.

```bash
npx omega-manager                      # manage: all services against the brand containing cwd
npx omega-manager --service=update     # one service
npx omega-manager --dry-run            # preview update's install/build work without running it
npx omega-manager --continue-on-error  # don't stop at the first failing service
```

Works from the brand root, from inside any `apps/{app}`, or from inside a backend's `functions/` dir — the brand root resolves by the same walk-up rule `@omegajs/config` uses.

## Three data buckets (the omega-manager principle, relocated)

| Location | Contains | Lifetime |
|----------|----------|----------|
| `config/omega.json5` | **User choices** — the same file every framework reads; no `.brands/` mirror to disperse | Committed, human-edited |
| `.omega/state.json` | **Durable derived data** (API-returned IDs) | Persists across runs, gitignored |
| `.omega/runs/{ts}.json` | **Transient per-run output** (counts, status flags, errors) | One file per process |

Secrets live in the brand root `.env` (loaded before any service runs) — `@omegajs/config` hard-fails on secret-shaped keys in omega.json5.

## Service runner contract (ported verbatim from omega-manager)

Services declare operations in [src/config.js](src/config.js) `OPERATIONS`; handlers live in `src/services/{service}/{ensure,read,transform,write}/{operation}.js`. Handler returns are **strictly validated** — allowed top-level keys are `state`, `output`, `status`, `error` only; anything else throws. `state` accumulates into `.omega/state.json`, `output` into the run file. Statuses: `success` (✓), `warned` (⚠), `error` (✗), `skipped`.

## Services (ported so far)

| Service | Operations | What it ensures |
|---------|-----------|-----------------|
| `workspace` | structure, config, gitignore | Root `apps/*` workspaces; an app per enabled target (app→target via declared `targets` in the app's omega.json5, else `website*`/`backend*`/… dir conventions); brand + app configs load and validate; `.omega/` is gitignored |
| `github` | org, repo, pages | The brand's GitHub presence matches `github: {}` in omega.json5: org profile (name, support/billing email, description ≤160, blog; `location` only when configured; skipped whole for `shared` orgs), THE brand-monorepo repo (`github.repo`, default = brand id; created empty when missing — you push, no clone; visibility + homepage diffed and patched), Pages on gh-pages + custom domain for web brands (a missing gh-pages branch = deploy-first guidance, not an error). Auth via the `gh` CLI (`gh auth login`, or `GH_TOKEN` in the brand `.env`). No `github.org` configured → clean skip. Repo identity lands in `.omega/state.json` for later services |
| `update` | targets | One resolution-gated `npm install` at the brand root (skipped when every app's deps already resolve through the node_modules climb — a brand nested in a bigger workspace never grows a stray install), then each app's own `npm run build` (apps without a build script are recorded skipped, not failed) |
| `testing` | target-checks | Per-target health: web → `dist/index.html` exists; backend → `firebase.json` + `functions/package.json`; all → parseable `package.json` |

`--dry-run` in github performs reads only: every drift is reported as `planned`, zero mutations.

**The porting queue** (omega-manager's full order, external services join one at a time with their `.env` credentials and their DEFAULTS sections): cloudflare → domain → firebase → recaptcha → analytics → search-console → adsense → sendgrid → beehiiv → payment → slapform → chatsy → replyify → server → assets → certificates → seo → account → migrations → testing (live checks). `disperse` mostly dissolves — the config hierarchy replaces file dispersal; what remains (cert files, `.env` composition) ports as its own service. Old-world github behaviors (per-target template repos, cloning, GitHub Desktop, setup commands, subdomain Pages repos) ride the onboarding/company-mode ports. Schema prompting (`ensureSchemaFields`) and company mode (many brands from one workspace, parallel logger — design settled, see PROGRESS.md Task M3) also ride later ports.

## Module map

- `src/manage.js` — the orchestrator: resolve brand root → load brand → walk SERVICE_ORDER → persist state per service → run output → summary (exit 1 on errors)
- `src/config.js` — SERVICE_ORDER, OPERATIONS, manager DEFAULTS (deliberately minimal: defaults move here WITH their service), app-dir conventions, `templateObject` (`{ domain }` templating)
- `src/lib/service-runner.js` — the ported runner (ensure/read/transform/write phases, strict return contract)
- `src/lib/run-summary.js` — cross-service summary with update/testing drill-downs + retry command
- `src/lib/brand.js` — brand-root resolution, omega.json5 loading (defaults ← brand, whole-file merge), app discovery
- `src/lib/state.js` — the `.omega/` store
- `src/cli.js` + `src/commands/` — devkit cli-router; `manage` is the default command

## Tests

`npm test` — 42 tests: the runner contract (strict returns, accumulation, stop-on-error, setup skip), brand loading (root resolution from any depth including a brand nested in a parent workspace's `apps/`, declared-vs-convention target mapping, `{ domain }` templating, secret-key load failure), end-to-end manage over staged fixture brands (full loop with a real `npm run build`, idempotent rerun, dry-run, missing-app and unloadable-config failures), and the github service against a recording fake API (converged brand = zero-mutation no-op, drift patches exactly the drifted fields, shared-org filtering, dry-run zero-mutation guarantee).

Live-proven against [apps/sandbox-brand](../../apps/sandbox-brand): both apps map, install is correctly skipped (deps resolve through the monorepo), the website builds, all five health checks pass, and a second run changes nothing. The github service is live-proven read-only: a `--dry-run` against the real `itw-creative-works/ultimate-jekyll` repo diffed real settings (public repo vs `private: true` default), filtered org reconciliation for the shared org, and reported the missing gh-pages branch — zero writes.
