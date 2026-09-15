# The company

> The COMPANY to BRAND rung: ONE key joins a brand to its company, and the company's shared config, secrets and signing material live in a `company/` folder inside the company brand's own repo. One resolver in `@omega.js/config` answers every question about it ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)).

## The one key

A brand states its company OUTSIDE `brand` (Ian 2026-09-12: "brand key is for things about this brand, and the parent/company/organization key is OUTSIDE of that"), naming the parent by its own `brand.id`:

```json5
company: { id: 'itw-creative-works' },                   // a sub-brand
company: { id: 'self' },                                 // the company brand itself, kept visible on purpose
company: { id: 'itw-creative-works', webhooks: false },  // ...whose provider ACCOUNT is somebody else's
```

The typed keys are the whole surface:

| Key | Type | Default | What it says |
|---|---|---|---|
| `company.id` | string | none | The company this brand belongs to, by the parent's own `brand.id`, or the literal `'self'` on the company brand itself. Absent means the brand IS the whole entity |
| `company.webhooks` | boolean | `true` | Whether the manage walk may repoint this company's provider ACCOUNT webhooks. `false` says the SendGrid Event Webhook and the Beehiiv webhook belong to someone else (a shared account whose one account-level webhook points at their production), so the campaigns and newsletter services leave them alone. It is the successor to the retired top-level `parent: false` ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)) |

The loader FILLS the same key at load, so what a reader sees is:

```js
company: { id, name, url, images: { wordmark }, webhooks }
```

One name, one shape, at every level (the same-name doctrine, [../shared/rulings.md](../shared/rulings.md)). The name, url and wordmark come from the PARENT's own config, so no brand ever restates a fact its parent owns; `webhooks` is the brand's OWN statement and is read from its own file at every branch. A brand with no `company` key resolves to `{ id: null, name: brand.name, url: brand.url, images: {}, webhooks: true }`, so no reader anywhere carries a fallback: the footer credit, the email wordmark, the in-house ads api and the webhook topology all read one shape.

The onboard and manage walks ask for `company.id` like any other field: joining a company is a single answer.

## The company tree

The company's shared files live in `company/`, INSIDE the company brand's repo, shaped like a brand:

```
itw-creative-works-omega/          # the company brand's own repo
  config/omega.json5               # its OWN brand config (company: { id: 'self' })
  company/
    config/omega.json5             # the layer every brand of the company inherits
    .env                           # the shared secrets
    .omega/certificates/apple/     # the shared signing tree
```

Secrets and signing material inside it stay gitignored exactly as a brand's do.

## Making one: `omega company init`

One command, run INSIDE the company brand, the brand whose own config says
`company: { id: 'self' }`. Anywhere else it refuses, because a tree in a brand that is not the
company would never be read:

```bash
npx omega company init
# → <brand root>/company/
#   ✓ created config/omega.json5   the layer every brand of the company inherits
#   ✓ created .gitignore           .env* and .omega/: the unshareable half, mirrored from the brand's rules
#   ✓ created .env                 the shared secrets, in the same canonical shape a brand .env has
#   ✓ created README.md
#   ✓ created .omega/certificates/apple/certificates/   the shared Apple signing tree
#   ✓ created .omega/certificates/apple/csr/
#   ✓ created assets/templates/                         the shared PSD templates a brand seeds from
```

Fill-missing, like every OMEGA scaffold: a rerun creates what is missing and rewrites not one
byte of what is there. The config layer it writes is brand-AGNOSTIC: commented placeholders
for the sections a company usually owns (identity contact, `account.admins`, the GA account,
the Sentry org, the Apple `bundleIdPrefix`) and nothing about the brand the folder sits inside.

Joining is not a command: a brand types `company: { id }` in its own config, and `omega
onboard` and the manage walk's workspace service both ASK for it, in the same words, when a
brand carries none.

### ITW, the worked example

```
itw-creative-works-omega/            # the company brand's repo, company: { id: 'self' }
  config/omega.json5
  .env                               # ITW's OWN brand secrets
  company/
    config/omega.json5               # the layer every ITW brand inherits
    .env                             # GOOGLE_CLIENT_ID/_SECRET, GH_TOKEN, CLOUDFLARE_TOKEN,
                                     # NAMECHEAP_*, RECAPTCHA_*, SENTRY_AUTH_TOKEN,
                                     # SENDGRID_API_KEY, BEEHIIV_API_KEY, the Apple set
    .omega/certificates/apple/       # the ONE Apple account that signs everything ITW ships
    assets/templates/

playground-omega/                    # a brand of it, company: { id: 'itw-creative-works' }
  config/omega.json5
```

The playground's run resolves ITW through the registry, layers `company/config/omega.json5`
under its own config, loads `company/.env` under its own `.env`, and signs from ITW's tree.
Nothing is copied into the playground, and nothing is duplicated in its files.

## Inheritance is ONE rule

**A brand-level file the child lacks resolves from the company's `company/` at the same relative path.** That is the whole mechanism, and it is one function:

```js
const { resolveCompany } = require('@omega.js/config');

const company = resolveCompany(brandRoot);
company.file('.env');                                     // the shared secrets, or null
company.file('config/hooks/account/password.js');         // a company-wide hook, or null
company.file('.omega/certificates/apple/certificates/DEVELOPER_ID_APPLICATION_G2.p12');
```

So a NEW kind of inherited file costs zero code (Ian: "I want it organized in a way so we could just add files, and they'll automatically be inherited"). Config and `.env` merge as LAYERS (company under brand, brand wins); everything else resolves by path.

Today's consumers, all of them through that one function:

| What | Where it resolves from | Who reads it |
|---|---|---|
| The config layer | `company/config/omega.json5` | the merge chain: schema defaults, framework defaults, **company**, brand, `targets.<name>`, local ([../shared/config.md](../shared/config.md)) |
| The shared secrets | `company/.env` | the env chain: shell, local `.env`, brand `.env`, **company `.env`** |
| Owner hooks | `company/config/hooks/<point>.js` | the brand's own hook first, then the company's |
| The Apple signing tree | `company/.omega/certificates/apple/` | the certificates walk and every desktop reader: ONE two-tier resolution ([#892](https://github.com/Omega-JS-Stack/omega/issues/892)) that READS the company tree first and the brand's own second, and WRITES every new CSR, `.cer` and `.p12` into the company tree. Nothing COPIES it out ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): the desktop env load derives `CSC_LINK` and `APPLE_API_KEY` as absolute paths INTO the tree |

**Resolved, never copied** (Ian: "RESOLVED at runtime, right? similar with certs"): the child's `.env` never receives company values, and the loaded environment has them.

**The doctrine line:** a brand with a company reuses the company tree first, always.

## Where the company IS: the machine registry

Membership is config; LOCATION is a cache. Every `loadConfig()` writes or refreshes its own brand's line in `~/.omega/brands.json`:

```json5
{
  "itw-creative-works": { "root": "/Users/ian/Developer/.../itw-creative-works-omega", "name": "ITW Creative Works", "url": "https://itwcreativeworks.com", "updatedAt": "2026-09-12T10:00:00.000Z" }
}
```

Nobody maintains it: run any omega verb inside a brand once and its line is there (a line whose root has vanished is pruned on the next write). `OMEGA_HOME` moves the home, which is how the test lanes keep fixtures out of a developer's real registry.

Every manage run states the answer in its header, always: membership is a fact of the brand, and "none" is an answer:

```
  Company:  itw-creative-works (/Users/ian/Developer/.../itw-creative-works-omega)
  Company:  itw-creative-works (not on this machine)
  Company:  none
```

A company that is not on this machine also prints ONE line per run and keeps going with no company layer:

```
Company itw-creative-works is not on this machine: inheritance off. Clone it and run any omega verb inside it once.
```

## Off-laptop: the machine that dispatches resolves, the runner receives

No runner ever reads `company/`. A deploy resolves the company on the developer's machine and writes ONE generated file beside the brand config, which the mirror push carries and then removes:

```
config/company-resolved.json5    // { config: <the company layer>, company: { id, name, url, images } }
```

The loader reads it when the registry has no line, so a runner gets exactly what the dispatching machine resolved (it is `config/company-resolved.json5`, beside the brand config, because every brand ignores `.omega/` whole and git cannot re-include a path under an excluded directory). The env half needs nothing: the deploy precheck's secrets push sends the COMPOSED target env (company, then brand, then target) as that repo's own secrets, so the company's `.env` values are already there.

## Extending it later

The resolver is the only seam (Ian: "is it easily extendible"). Swapping where `root` and `file()` come from (a fetched parent backend, a secret store, multi-level chains) touches no consumer.
