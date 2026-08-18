# The directory service — a brand's entry in its parent's directory

The `directory` service ([#246](https://github.com/Omega-JS-Stack/omega/issues/246)) is
how a brand keeps its own listing current in the project ABOVE it. During the manage
walk the brand PUSHES an entry into the parent project's Firestore `brands` collection at
`brands/{brand.id}` — identity plus whatever opt-in blocks it declares — and whatever the
parent runs on top of that collection reads a directory that is never stale.

**The boundary.** The framework owes the fresh ENTRY. It owes nothing else. The
marketplace, hub or admin surface that CONSUMES the directory is brand code and never
enters the framework — ITW's guest-post sponsorship marketplace is the first consumer, and
its routes, pricing UI and moderation stay in the ITW brand. That split is why the write is
a merge, not a replace: the framework owns its own sections of the entry and the hub owns
everything else it keeps on the same document.

Legacy omega-manager wrote this collection centrally, from the brand configs it held in
`.brands/*/config.json`. A brand migrated onto OMEGA has no central config to be written
FROM, so the direction inverts: each brand pushes for itself, from its own omega.json5.

## The config a brand writes

Opt in at the shared (brand) level of `config/omega.json5`:

```json5
{
  // Which project's directory this brand belongs in. Required — no parent
  // relationship, no directory to push into.
  parent: 'https://itwcreativeworks.com',

  // Opt in. Absent, `false`, or an empty block all mean "do not push": the
  // parent publishes the collection for anyone to read, so participation is
  // never implicit.
  directory: {
    enabled: true,
  },

  // The first BLOCK. Declared → published; absent → the block is removed from
  // the entry on the next walk.
  sponsorships: {
    acceptable: ['productivity', 'business', 'social media'],
    unacceptable: ['link-in-bio services', 'social media link services'],
    prices: {
      'guest-post': 20,
      'link-insertion': 10,
    },
  },
}
```

Both keys are schema-known in `@omega.js/config`. **Public facts only**: the entry lands in
a collection the parent declares world-readable (the one operator step below), and the
validator's secret-shape guard is the hard floor on what can go in them. Credentials never
appear here — the service authenticates with
`DIRECTORY_SERVICE_ACCOUNT` in the brand `.env`, a path to the PARENT project's Firebase
service-account JSON (absolute, or relative to the brand root), the `server` service's
mechanism exactly. The service account names the target project.

## What lands in the entry

```json5
// brands/{brand.id} in the parent project
{
  brand:  { id, name, url },                 // identity — `url` only when configured
  github: { owner, name, repo },             // repo slugs, omitted unless BOTH halves resolve
  sponsorships: { … },                       // the declared block, verbatim
}
```

`github` is `@omega.js/config`'s ONE repo derivation
([#290](https://github.com/Omega-JS-Stack/omega/issues/290)) — the same `{ owner, name,
repo }` a backend app reads as `config.resolved.github`. The service never re-derives it,
and a half-resolved repo (an owner with no name, or the reverse) is omitted rather than
pushed broken.

## The read rule the parent adds (the one operator step)

Nothing in the framework grants the public read. A compiled-rules project is admin-only by
default — the framework half's `match /{document=**}` is the floor — so the PARENT, the
project the entries land in, declares the collection public itself. Once, by hand, in its
own `firestore.rules` source (the brand half, under "Your rules"):

```
    // The brand directory: every brand's own entry, readable by anyone.
    // Writes stay closed — the pushing brand authenticates with a service
    // account and bypasses rules.
    match /brands/{id} {
      allow read: if true;
      allow write: if false;
    }
```

`omega build` compiles that into the parent's `dist/firestore.rules` and `omega deploy`
ships it. Skipping the step costs the push nothing (a service account writes past rules
either way) — it costs every CLIENT that tries to read the directory, which is the whole
point of the collection.

## The gates and the diff

Three gates, each a clean skip, in order: `directory.enabled: true`, a `parent` to push
into, and not a `demo-*` (emulator-only) brand — the cloud service's gate, for the same
reason: an offline fixture must never reach a live project. A missing
`DIRECTORY_SERVICE_ACCOUNT` skips too.

The push reads first and writes only on drift, so an unchanged config performs **zero
writes** on every subsequent walk. Drift is compared against the framework-owned slice of
the document only, so a hub-owned field appearing beside the entry is not drift and is
never rewritten. The write is a `patchDoc` whose updateMask names every owned section —
including the ones with no value this run, which is how a block the brand drops from config
disappears from the directory instead of lingering.

## Legacy → doc field mapping

Legacy source: omega-manager `.brands/<brand-id>/config.json` (read-only reference).
Target: `brands/{brand.id}` in the parent project.

| Legacy `.brands/<id>/config.json` | Directory entry field | Note |
|---|---|---|
| `brand.id` | document id `brands/{brand.id}`, and `brand.id` | Unchanged; denormalized into the entry as legacy did |
| `brand.name` | `brand.name` | Unchanged — the ITW routes read `brand.brand.name` |
| `brand.url` | `brand.url` | Unchanged — the ITW routes derive the brand's API host from it |
| `github.orgMain` / `github.orgWebsite` + `github.templates.website.{useOrgWebsite,suffix}` | `github.owner` | **Derived, not carried.** Legacy pushed the raw org pair and the CONSUMER picked between them; the entry now carries the already-resolved owner from `repo.providers.github` ([#290](https://github.com/Omega-JS-Stack/omega/issues/290)) |
| `brand.id` + `github.templates.website.suffix` (`'-website'` default), composed by the consumer | `github.name` | **Derived, not carried.** One repo per brand now (the brand monorepo), so the `<id><suffix>` composition retires with the split-repo era |
| — | `github.repo` | New: the `owner/name` slug the GitHub API takes, so no consumer composes it |
| `sponsorships.acceptable` | `sponsorships.acceptable` | Verbatim |
| `sponsorships.unacceptable` | `sponsorships.unacceptable` | Verbatim |
| `sponsorships.prices['guest-post']` | `sponsorships.prices['guest-post']` | Verbatim (USD) |
| `sponsorships.prices['link-insertion']` | `sponsorships.prices['link-insertion']` | Verbatim (USD) |
| `parent` | — | Not published: it names WHERE the entry goes, it is not part of the entry |

The two placement keys are the only ones the 23 legacy brands with a `sponsorships` block
ever used. `prices` is an open map, not an enum — a new placement type is a config line, not
a framework change. `marketing.newsletter.*.sponsorships` in the legacy configs is a
different thing entirely (newsletter ad slots) and never entered this collection.

## Adding the next block

One entry in `packages/manager/src/services/directory/lib/blocks.js` naming the brand-config
section it reads, plus its schema line in `@omega.js/config`. A block crosses only when the
brand declares its section, and `OWNED_SECTIONS` picks it up automatically, so removal
converges for free.
