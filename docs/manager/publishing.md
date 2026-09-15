# The publishing service, every ship credential in one ask

The `publishing` service ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)) owns
what a brand needs before it can SHIP: the developer keys a store or a signing job cannot
publish without, and the per-listing ids a store assigns when a human creates the listing. It
provisions nothing, because nothing here has an API that could: no store creates a listing
for us and no signing vendor mints a credential. What it owns is the ASK, at setup time,
instead of a release that dies on a runner months later.

It runs right after [certificates](certificates.md), which keeps the APPLE material: one
Apple identity signs every mac format a company ships, so that belongs to the account, not to
a format.

## The ask list is derived, never typed

Nothing in this service names a key. The brand's own declaration says what it ships:

```json5
targets: {
  extension: { type: 'extension', platforms: { edge: false } },
  desktop:   { type: 'desktop',   platforms: { linux: { formats: { snap: {} } } } },
}
```

@omega.js/config's format table ([platforms.js](../shared/config.md#the-shipping-declaration))
says what each of those formats requires, and devkit's `ship-plan` narrows it to this brand:
the Chrome and Firefox store keys (Edge is dropped, so its two keys are never asked for), and
`SNAPCRAFT_STORE_CREDENTIALS`, which a desktop brand owes only where it DECLARES the snap. The
Windows signing set narrows the same way, to the keys the configured
`platforms.windows.signing.strategy` uses. Add a store to the table and the walk asks for its
keys the same day, with no edit here.

The human half of each ask (what the key is, the page that mints it, what to make there) is
the env schema's, its one home, reached through `describeServiceInputs()`. The walk opens that
page Enter-gated and takes the paste.

## What it reconciles

| Operation | What it does |
|---|---|
| `keys` | Every developer key the declared formats need, asked through the shared setup contract and written to the brand `.env`. What is still missing FAILS, naming the key, the declaration that requires it, and this walk |
| `listings` | The per-listing store ids (`targets.<name>.listings.<browser>.id`), asked through the config flow and written to `config/omega.json5`. A missing one is WARNED with the manual step |

A listing id is CONFIG, never `.env` ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)):
it is the id in the listing URL every user sees, so it is public by design.
`CHROME_EXTENSION_ID`, `FIREFOX_EXTENSION_ID` and `EDGE_PRODUCT_ID` are retired env keys and a
`.env` that declares one fails the load. Firefox is never asked at all: its id IS the
manifest's gecko id, derived from the brand facts, and the extension's local scaffold pins it
into `config/omega.json5` on its own.

## The three outcomes

- **Interactive**: the uniform Provide / Skip for now / Disable permanently gate, then a paste
  per key. "Skip for now" on a listing id is the sanctioned "not yet" (Ian 2026-09-10): the
  listing does not exist until somebody makes one.
- **Headless** (CI, a dry run, a piped boot): nothing is ever asked. A missing developer key
  for a shipped format is an ERROR naming the key and `omega manage --service publishing`,
  because a store with half its credentials is a publish that dies on a runner. A missing
  listing id is a WARNING carrying the same manual step the publish prints.
- **Idempotent**: a key already in the `.env` cascade and an id already in config are never
  asked for again, and a converged brand's files are byte-identical after a run.

## Config and credentials

- `publishing.enabled: false` is the tri-state opt-out the gate's Disable lands. It silences
  the whole service.
- Dropping ONE store is the DECLARATION's job, not this switch:
  `platforms.<store>.formats.store: false` stops the ask, the refusal, and the publish
  together.

The keys themselves live in the brand `.env` and are all OPTIONAL in the registry
(`gates: false`): a brand mid-setup is never gated out of a whole manage run by a store it has
not registered yet. The service is what refuses, at the moment a shipped format has nothing to
ship with.

## The other end of the same story

The publish verbs read the same table and print the same lines:
`omega publish` (desktop) refuses before it builds, and the extension publish refuses per
store, attaches the zips to the brand's releases repo either way, and prints the manual step
for a store whose listing does not exist yet. The contract is
[deploys.md](../shared/deploys.md#publish-assets-stores-and-the-manual-step).
