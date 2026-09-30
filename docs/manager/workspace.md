# The workspace service — the brand monorepo itself

The `workspace` service runs FIRST in every walk, and on the boot lane too: everything
downstream assumes a sane brand monorepo. It reconciles the repo's own shape — root
`package.json` workspaces, a dir per enabled target, config health, the agent-docs chain,
the `.env` files — and it is the one service that touches no network at all.

## What it reconciles

Under `--dry-run` every operation below prints its plan line and writes nothing: not the brand files, not the retired-link removal ([#971](https://github.com/Omega-JS-Stack/omega/issues/971)).

| Operation | What it does |
|---|---|
| `structure` | Root `package.json` declares `targets/*` and every enabled target has its dir. A dir mapping to no target WARNS; a declared target with no dir is an ERROR naming the dir to create. The dir IS the key: `targets.<name>` lives in `targets/<name>` ([#886](https://github.com/Omega-JS-Stack/omega/issues/886)). |
| `config` | `config/omega.json5` loads and validates. A brand file that fails to load or validate is an ERROR — there is nothing sound to reconcile against. Per-target findings are warnings; each framework's own audit is the hard gate for its surface. |
| `defaults` | Materializes the schema-defaulted blocks the brand file does not carry yet ([#478](https://github.com/Omega-JS-Stack/omega/issues/478)), each with the schema's own description as its comment. A target-only default (web's `meta.index`) lands under each declared `targets.<name>` that lacks it ([#943](https://github.com/Omega-JS-Stack/omega/issues/943)). Never overwrites: a converged config is byte-identical. |
| `company` | The ONE key that joins this brand to its company ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)) is asked when the brand file carries none, in the same words `omega onboard` uses. A blank answer is the standalone brand and writes nothing (the next run asks again); a headless run never asks. |
| `gitignore` | The brand root `.gitignore` (and the company tree's, when the brand names a company) is the marked file: its `Default Values` section is the framework's list (one home, `src/lib/gitignore.js`, which the onboard and `company init` scaffolds write too), rewritten every manage; `Custom Values` is kept verbatim. A file from before the markers converges once: the framework's lines and their old headers go to Default, every other line lands under Custom, nothing duplicated. The secrets, the manager state and the run logs never get committed. |
| `scripts` | Root `package.json` scripts say `omega` (a legacy omega-manager brand is healed) and a `deploy` script exists; each framework target's scripts sync to the scripts its framework writes: one `"<verb>": "omega <verb>"` per fan-out verb (`fanout: 'each'`) the framework owns, derived from the verb table (`@omega.js/devkit/verb-scripts`, [#985](https://github.com/Omega-JS-Stack/omega/issues/985)), plus `"start": "omega dev"` from the `dev` row, with the framework's `projectScripts` declaration merged over them. Those standard keys are FRAMEWORK-owned ([#689](https://github.com/Omega-JS-Stack/omega/issues/689)): the walk and the framework's own ensureTarget both rewrite them to the defaults on every run, so a hand-edited standard script heals instead of drifting; customize behavior through hook points, never by editing one. Keys the framework never writes are the consumer's own and are never touched. The walk runs it at all as the onboard→dev cycle break (#675): the dev fan-out reaches those verbs THROUGH these scripts. Exceptions: a custom target maps to no framework, so it is skipped whole (#603); a custom-server backend is skipped PER KEY (#584): it owns `start` and `deploy` (the scripts running a verb its mode refuses, `dev` and `deploy`, named by the framework's scaffold entry as `CUSTOM_OWNED_SCRIPTS`, derived from its `FIREBASE_ONLY_VERBS`), which are never written and never scaffolded, while `test` and every other script stay framework-owned. Script VALUES only; no other key is touched. |
| `agents` | The brand's agent-docs chain: root `AGENTS.md` imports `node_modules/@omega.js/manager/AGENTS.md` in its `Default Values` section; the retired `node_modules/@omega.js/AGENTS.md` link is removed. The `Custom Values` section is preserved; an older shape converges with its notes under Custom; no `CLAUDE.md` is written or read. |
| `claude-settings` | The committed `.claude/settings.json` that enables the omega plugin (below). |
| `workflows` | Deletes the brand root's composed `.github/workflows/<target>-*.yml` for targets the config no longer enables ([#636](https://github.com/Omega-JS-Stack/omega/issues/636)). Only files carrying the GENERATED header AND the composed name — the brand's own workflows share that dir and are never candidates. The target's DIR is left alone. |
| `env-keys` | Mints the env schema's `generated` keys into the brand `.env` when the cascade has none ([#569](https://github.com/Omega-JS-Stack/omega/issues/569)). |
| `env-order` | Converges the brand (and company) `.env` onto the marker sections: a `Default Values` section the framework rewrites on every run (the canonical groups and their `# KEY=""` placeholders, every set value kept on its key's line), then a `Custom Values` section kept verbatim, where a key the framework does not know lives. The `.env.<environment>` overlays beside it are a human's hand-picked few, not a canonical inventory, so nothing converges them. |
| `env-rules` | Names the keys the brand's own config made mandatory and nobody filled in ([#626](https://github.com/Omega-JS-Stack/omega/issues/626)). |
| `translation-sdk` | A translating web target declares + installs `@anthropic-ai/claude-agent-sdk` ([#168](https://github.com/Omega-JS-Stack/omega/issues/168)). |

## Config and credentials

No credential of its own — nothing here leaves the machine. It reads `targets` (which dirs
must exist), the whole of `config/omega.json5` (the `config` and `defaults` ops), and each
target's own config for the translation check.

## The `.env` ops, and why presence is judged on the RESOLVED value

`env-keys` and `env-rules` both read `process.env` — which `manage.js` already layered as
shell > brand `.env` > company `.env`, each of those overlaid by its own
`.env.<environment>` file ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)) —
never the brand file alone. A brand of a company therefore never shadows its company's
value with a freshly minted one, and neither does a brand whose value lives only in an
overlay. A minted value is
published into `process.env` too, so the same run's builds compose it: the key is live one
manage after the gap, not two. Values are never printed; the run says WHICH key it minted.

`env-order` leaves a file untouched with a note when converging it would change a value
the loader reads: a line dotenv reads another way (e.g. `KEY: value`). Multi-line values and duplicated keys converge. `env-rules` WARNS and never fails: a half-configured brand is a normal step
on the way to a configured one, and the lanes that truly cannot proceed (a production
backend boot) refuse on their own. Its rules are evaluated per enabled target against that
target's resolved config, so a per-surface key is judged where the services write it — and
a TARGET-LESS rule (a service's own key, like `SENTRY_AUTH_TOKEN`) is owed when its config
path is truthy in the brand root or in ANY enabled target's resolved config
([#683](https://github.com/Omega-JS-Stack/omega/issues/683)), because that is where the
service wrote the value that requires it.

## The `claude-settings` op

The `claude-settings` op ([#62](https://github.com/Omega-JS-Stack/omega/issues/62)) writes the OTHER half of a brand's agent setup: the committed `.claude/settings.json` that registers the omega marketplace shipped inside the installed manager package (`./node_modules/@omega.js/manager`) and enables `omega@omega`, so every session in that brand — anyone's, on any machine — loads the plugin. Gated on a published install: the installed manager must carry the vendored `.claude-plugin/marketplace.json` ([publishing.md](../shared/publishing.md)) and be a real directory rather than a symlink into the monorepo, so the local era skips and the developer's own user-scope install serves those sessions. Idempotent and non-clobbering — the two omega keys are deep-merged, a correct file is not rewritten, and a settings file that doesn't parse is reported, never overwritten (`src/lib/claude-settings.js`, pinned by `test/claude-settings.test.js`).

## Gotchas

- **Custom targets are checked BY DIR.** A `type: 'custom'` target maps to no framework, so
  `structure` reads the declaration's dir name and never counts it among the unmapped — one
  of only two manage ops that see custom targets at all ([config.md](../shared/config.md) § Custom targets).
- **`defaults` never invents an owner decision.** Keys with no sane framework answer —
  provisioned ids, anything secret-shaped — carry no schema default and are never written.
- **`translation-sdk` never removes.** Turning translation off leaves the dep in place;
  uninstalling on a config flip is riskier than leaving it.
