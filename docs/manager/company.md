# The company workspace

> The COMPANY → BRAND rung: one workspace whose config, secrets, and signing material every brand it manages inherits. Two commands own it — `omega company init` makes the workspace, `omega company adopt` joins a brand to it. The runtime behavior (discovery, the per-brand fan-out, the child-process model) is in [packages/manager/README.md](../../packages/manager/README.md) § Company mode.

## What a company workspace IS

A **repo, not a machine cache.** Machine-wide state stays in `~/.omega` (auth token caches, the per-machine deploy record); the company workspace is a directory you clone, commit, and share with the company's other machines. It owns exactly four things:

| What | Where | Reaches a brand by |
|---|---|---|
| The config layer | `config/omega.json5` (the `brands` key is what MAKES it a company root) | the merge chain: manager DEFAULTS ← **company** ← brand ← `targets.<type>` ← local |
| The shared secrets | `.env` | the env chain: shell env > brand `.env` > **company `.env`** |
| The shared Apple signing tree | `.omega/certificates/apple/` | `signingRoot = companyRoot \|\| brandRoot` — the certificates + disperse services read the company's tree for every company-managed brand |
| Where the brands are | `brands.roots` in that config (default `['./brands']`; `['..']` treats the workspace's siblings as brands) | company-wide runs (`omega manage` from the company root) |

A brand behaves IDENTICALLY everywhere — standalone, nested under `brands/`, or a loose sibling. The company layer only changes what defaults it inherits.

## The stamp is the whole link

The reverse link needs no nesting and no registry: a brand carries `.omega/company.json` (`{ "root": "/abs/path/to/company" }`), and every brand-local run reads it, layers the company config (minus the `brands` key), loads the company `.env` under the brand's own, resolves the signing tree there, and prints a `Company:` line in its header. A marker pointing at something that is no longer a company root warns and the run continues standalone; no marker at all = standalone. That is the ONE mechanism — `omega company adopt` writes exactly this file, `omega onboard` writes it for brands it creates in a company, and a company-wide `omega manage` re-stamps every brand it discovers.

## `omega company init [path]`

Scaffolds the workspace in one command (default: the current directory). **Idempotent** — it fills gaps only and never overwrites a file that exists, so rerunning it after an edit is a byte-level no-op.

```bash
mkdir my-company && cd my-company
npx omega company init          # or: npx omega company init ~/Developer/my-company
```

What it writes:

| Path | What it is |
|---|---|
| `config/omega.json5` | The company layer: a real `brands: { roots: ['./brands'] }` plus commented, brand-agnostic placeholders for the sections a company usually owns (identity, `account.admins`, the GA account, the Sentry org, the Apple `bundleIdPrefix`) |
| `.env` | The canonical group template with every key commented out — no values, no generated secrets (a brand's own `.env` always wins over this file) |
| `.gitignore` | The tracking decisions below |
| `README.md` | A short stub: what's here, and the verbs |
| `.omega/certificates/apple/{certificates,csr,profiles}/` | The shared signing tree, created empty — the App Store Connect `AuthKey_*.p8` goes at its root. Carries its own self-protecting `.gitignore` (`*`) so signing material can never be committed even if the tree is copied elsewhere |
| `brands/` | The default `brands.roots` entry, created empty |

**Tracked vs ignored.** The repo tracks the config skeleton, the README, and the `.gitignore` — the shareable half. Ignored: `.env` (secrets), `.omega/` (the signing tree's `.p8`/`.p12`/CSR private keys, plus run output and caches), `logs/`, and `brands/` — each managed brand is its OWN git repo and must never be embedded in this one. Signing material moves between machines out of band, never through git; the certificates service re-downloads or recreates what it can, and preserves the CSR private key that pairs with each issued certificate.

## `omega company adopt <brand-path>`

Run from anywhere inside the company workspace. Adoption is the ONE step a brand needs:

```bash
npx omega company adopt brands/acme      # or any path: ../acme, /abs/path/to/acme
```

It writes the brand's `.omega/company.json` and nothing else. Idempotent: a marker already pointing here is left untouched. It refuses what would be wrong rather than guessing — a cwd that is not a company root, a path with no `config/omega.json5`, or a path that is itself a company workspace (the hierarchy is one rung: company → brands). A brand outside `brands.roots` is still stamped — its own runs inherit the company — but the command warns that company-wide runs won't include it until its parent dir joins `brands.roots`.

New brands need no adopt step: `omega onboard` from a company root lands the brand under `brands.roots[0]` and stamps it in the same pass.

## After adoption

```bash
npx omega manage                  # from the company root: the full walk, once per brand (child process each)
npx omega manage --brand=acme     # one brand
npx omega manage --parallel       # every brand concurrently
```

Brand-local runs need nothing new — `npm run manage` inside an adopted brand already layers the company. See [packages/manager/README.md](../../packages/manager/README.md) § Company mode for the fan-out mechanics, the per-brand log tee, and why children are processes; [../shared/config.md](../shared/config.md) for the merge chain itself.
