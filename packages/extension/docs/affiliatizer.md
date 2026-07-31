# Affiliatizer — affiliate-link redirects on matched sites

The content script rewrites a visit to a partner site into an affiliate URL for
that partner, so purchases made after the redirect carry a referral credit. It is
part of the extension framework's monetization surface, alongside the
house/company verts lane ([docs/verts.md](verts.md)).

**Whose credit:** the partner map is a fixed module constant in the framework
source — it is not brand config, and every consumer brand ships the identical
list of referral links, which are the FRAMEWORK AUTHOR's. A brand cannot
currently substitute its own codes; per-brand configurability is tracked as
[#147](https://github.com/Omega-JS-Stack/omega/issues/147). The store-listing
disclosure (below) is written in the brand's voice, while the commission it
discloses is the framework author's.

Source: [src/lib/affiliatizer.js](../src/lib/affiliatizer.js), initialized by the
content-script Manager ([src/content.js](../src/content.js)).

## Mechanism

1. The content script runs on the visited page and hands the Manager to
   `Affiliatizer.initialize(Manager)`.
2. The page's `window.location.hostname` is tested against each entry's `match`
   regex in the module's `map` — a hardcoded constant, identical in every build.
3. On a match, the entry's `replace` is applied to a copy of the current URL —
   `href` (replace the whole URL, what every shipped entry uses), `pathname`, or
   `query` (set individual search params).
4. The visit timestamp is recorded per partner id in `chrome.storage.local`, and
   the tab is redirected to the built URL (`window.location.href = …`).

The shipped map covers Amazon, Factor, Honeygain, JumpTask, Pawns, Capital One
Shopping, Coupert, Honey, Lolli, PayPal, Rakuten, Upside, and NordVPN. `Affiliatizer.get()`
returns it; the build-layer suite
([src/test/suites/build/affiliatizer.test.js](../src/test/suites/build/affiliatizer.test.js))
pins the map's shape — unique ids, a RegExp `match`, and a parseable URL on every
entry that carries a `replace.href` (entries without one are not checked).

## Default-on, and the storage flag

There is nothing to enable: the content script initializes the Affiliatizer on
every page it runs on, and the resolved status defaults to `allow` when
`chrome.storage.local`'s `affiliatizer` key holds no status. The same key doubles
as the per-partner visit ledger:

| Value of `affiliatizer` in `chrome.storage.local` | Meaning |
|---|---|
| absent / `null` | Default — redirects are active, no partner visited yet |
| `'block'` | Redirects are off for this browser profile |
| `'allow'` | Redirects are active (the explicit form of the default) |
| `{ <partnerId>: { timestamp } }` | The per-partner ledger of the last redirect |

## The 24-hour per-site dedupe

Before redirecting, the entry's recorded `timestamp` is compared against now: if
the last redirect for THAT partner was under 24 hours ago, the visit is left
alone. So a partner site redirects at most once a day per browser profile, and a
user who navigates back into the site keeps browsing normally.

## The query-string control

Append `?affiliatizerStatus=<value>` to any URL the content script runs on:

| Value | Effect |
|---|---|
| `block` | Writes `affiliatizer: 'block'` — no further redirects |
| `allow` | Writes `affiliatizer: 'allow'` — redirects active again |
| `reset` | Clears the key, dropping both the status and the 24-hour ledger |

Each control also logs through the content Manager's logger, so the state change
is visible in the page console.

## Store-listing disclosure

The scaffolded store description carries the affiliate disclosure — the closing
lines of [src/defaults/config/description.md](../src/defaults/config/description.md)
name the partners and say "we may earn an affiliate commission" in the brand's
voice — while the links are the framework's and the commission is the framework
author's ([#147](https://github.com/Omega-JS-Stack/omega/issues/147)). A consumer
editing its `config/description.md` keeps that disclosure: Chrome Web Store and
Firefox AMO both require monetization to be disclosed in the listing. Publishing
details: [docs/publishing.md](publishing.md).
