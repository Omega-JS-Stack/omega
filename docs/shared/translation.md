# Translation

AI translation for OMEGA consumers — one engine, config-driven, with a
**committed** per-string cache. Shipped cp96 (Ian directive 2026-07-11),
replacing both legacy systems: UJM's OpenAI-only gulp task with the
`cache-uj-translation` GitHub-branch cache, and BXM's Claude-only task with a
gitignored `.cache/` (which re-translated everything on any change and on
every fresh clone).

## Config (shared `translation` section of omega.json5)

```json5
translation: {
  enabled: true,          // optional master switch (default true)
  default: 'en',          // source language (default 'en')
  languages: ['es', 'fr'],// target codes — EMPTY/ABSENT = translation off
  provider: 'claude',     // 'claude' (default) | 'chatgpt'
  model: null,            // optional override (claude → 'sonnet' alias, chatgpt → 'gpt-5.4-nano')
  exclude: [],            // web only: extra page routes/folders to skip
}
```

Shared section (typically brand-level; `SHARED_SECTIONS` includes it, so
disperse copies it and every app inherits through the cascade). Language codes
validate against the SSOT in `@omega.js/devkit/translate` (`LANGUAGE_NAMES`,
~32 codes) — an unknown code is a hard config error naming the supported set.
The same SSOT carries `LANGUAGE_LOCALES` + `ogLocale(code)`, the one code →
Open Graph `language_TERRITORY` map (`es` → `es_ES`).

## Providers

| Provider | Rides | Credentials |
|----------|-------|-------------|
| `claude` (default) | the locally-installed Claude Code via `@anthropic-ai/claude-agent-sdk` | **none** — local auth |
| `chatgpt` | OpenAI Responses API (native fetch) | `OPENAI_API_KEY` via the .env cascade |

The claude provider runs **hermetic** sessions: `settingSources: []` (no user
CLAUDE.md/hooks — they pollute mechanical output; a stop-hook reply actually
leaked into a canary before this was locked down), a custom translator system
prompt instead of the CLI persona, and NO `maxTurns` cap (a plain reply
already counts as the final turn — `maxTurns: 1` reports `error_max_turns`
even though the text arrived).

**Enabling translation on web means installing the SDK (#37).** `@omega.js/web`
does NOT ship `@anthropic-ai/claude-agent-sdk`: translation is opt-in and the
SDK is heavy, so a web brand that turns it on installs it in the app itself
(`npm install @anthropic-ai/claude-agent-sdk`); `@omega.js/extension` still
declares it. The SDK is lazy-required at the first claude call, so a brand
without translation never pays for it, and a brand that enabled translation
without the SDK gets a hard error naming the package and that install command,
never a silent skip. The `chatgpt` provider needs no SDK at all (native fetch
plus `OPENAI_API_KEY`).

**The manage cycle provisions it (#168).** Nobody types that install in a
managed brand: the manager's workspace service reconciles it like every other
brand file. A web app whose RESOLVED config translates with the `claude`
provider gets `@anthropic-ai/claude-agent-sdk` written into its package.json
`dependencies` (at the range `@omega.js/web` declares as its optional peer,
read from the installed web package), followed by one `npm install` at the
brand root. Converge-to-config, so: already declared (in `dependencies` or
`devDependencies`) = zero-mutation no-op that never overwrites a
consumer-chosen spec, `--dry-run` plans without writing, translation off or
provider `chatgpt` leaves the app untouched, and turning translation back OFF
never REMOVES the dep (uninstalling on a config flip is riskier than leaving
it). Only web apps are provisioned, since backend and extension declare the
SDK as a real dependency of the framework. The loud error above stays the backstop
for hand-managed brands (`packages/manager/src/services/workspace/ensure/translation-sdk.js`,
pinned by `packages/manager/test/workspace-translation-sdk.test.js`).

## Engine protocol (`@omega.js/devkit/translate`)

`translateStrings({ strings, language, languageName, brand, extraRules, send })`
→ positionally-aligned translations:

- **JSON array in → same-length JSON array out**, batches of 25.
- The `OMEGA-TRANSLATION-CONTROL` sentinel is appended to EVERY batch and must
  return unchanged at its exact position — alignment proof per batch.
- Validation failures (parse, length, sentinel) retry up to 2× then throw.
- Original leading/trailing whitespace is re-applied to every translation.
- Rules baked into the system prompt: preserve HTML/URLs/placeholders
  (`$1`, `{name}`, `{{ value }}`), never translate the brand name.

## The committed cache (`<app>/translations/`)

`translations/{lang}/{namespace}.json` maps `sha256(source)[:12]` → translated
string. Committed to git — that's the whole point:

- **Incremental**: editing one source string changes one hash → exactly one
  re-translation. Everything else is a cache hit (zero provider calls).
- **Survives clones/CI**: a warm cache builds a fully-translated site with NO
  AI credentials (kills the BXM parked finding where fresh clones burned live
  Claude calls).
- **Human-overridable**: hand-edit a translation VALUE in the cache file and
  it sticks for as long as the source is unchanged (the value is the
  translation; the key only changes when the SOURCE changes).
- Maps are pruned to the current source set on save — no stale entries.

## Web (`@omega.js/web`)

`omega build` translates everything by default (Ian's #24 final call): warm
strings come from the committed cache instantly, cold strings translate live
through the provider — a build ships the COMPLETE translated site whenever
the provider delivers, and a warm cache means zero provider calls. A provider
FAILURE skips that page-language pair whole, warning loudly with the page and
the language (the build still exits 0): no half-translated copy ever ships
behind full language chrome.
`omega build --cached-only` skips cold page-language pairs WHOLE instead (no
mixed-language copies, hreflang stays honest; the warning lists them) for
provider-free builds.
`omega translate` still runs the live pass standalone against an existing
dist/ and exits 1 on failures. `OMEGA_TRANSLATE_ONLY=<route>` limits any of
these to one page (canary/debug).

Per page × language: text nodes/`<title>`/meta/attribute copy translate
(cache-first), then the copy lands at `dist/{lang}/...` with `<html lang dir>`
(RTL-aware), canonical + `og:url` + `og:locale` localized, internal links
rewritten to `/{lang}/...`, and hreflang + `og:locale:alternate` tags
stitched into BOTH the copy and the original — naming only the languages
actually PRODUCED for that page (a pair skipped cold or failed is never
advertised, on the copies as on the originals), so hreflang never lies.
`og:locale` carries Open Graph's `language_TERRITORY` form (`en_US`,
`es_ES`) from the devkit language SSOT's locale map — on translated copies
and on the source pages the head include renders. Cache namespace:
`pages/{route}` (`pages/home` for `/`).

On a site served under a base path ([#355](https://github.com/Omega-JS-Stack/omega/issues/355)),
link rewriting composes **prefix, then language**: the pass reads the mount
point off the `<html data-omega-path-prefix>` stamp the build wrote (so
`omega translate` standalone sees it too), takes the route from underneath it,
and mounts the language segment after it — `/workkit/es/pricing`, never
`/es/workkit/pricing` ([#359](https://github.com/Omega-JS-Stack/omega/issues/359)).
Exclusions are matched on that same underneath-the-prefix route. ABSOLUTE URLs
(canonical, `og:url`, hreflang alternates, the sitemap entries) are built from
`brand.url`, which for a mounted site already carries the path — nothing
prefixes them twice.

Never translated: auth flows (`oauth2`, `authentication-*`), `checkout*`,
`submission/confirmation`, legal (`terms`/`privacy`/`cookies`), `404`,
socials redirects (config `socials` keys), `admin`/`test`/`team`/`updates`
folders, every known language-code folder, plus config `translation.exclude`.
Element opt-out: `data-omega-no-translate`. Collector fixes vs UJM:
`aria-describedby`/`aria-labelledby` are NOT collected (ID refs), `value`
only on button-type inputs (hidden-input tokens stay intact).

`dist/sitemap.xml` (emitted by the build in the source language only) is
rewritten afterwards so it tells the same story: every PRODUCED copy joins it
as its own `<url>`, and each entry of a translated set — source and copies
alike — carries the full `xhtml:link rel="alternate"` list (`x-default` at the
source language) plus the source entry's `lastmod`/`changefreq`/`priority`.
Entries stay in loc byte order. The language-prefixed entries are owned by that
pass: each run drops them all and re-emits only what it produced, so a skipped
or failed pair is listed nowhere.

The visitor-facing **language switcher** is the footer dropup in the shared
base footer include (`_includes/frontend/sections/footer.html`, the base layer
every theme inherits). It renders CLIENT-SIDE from the page's own
`link[rel="alternate"][hreflang]` tags — the produced-only SSOT above — so the
menu can never offer a copy that was not written: `core/js/core/language-switcher.js`
drops `x-default`, labels each row with its native name (`Intl.DisplayNames` in
that language's own locale, upper-cased code as the fallback), marks
`documentElement.lang` as current, and leaves the mount empty and hidden when
fewer than two languages exist. Selecting a language is a plain link to that
alternate's href — never a redirect or a negotiation.

Not here yet: no default homepage exists in the D8 set, so brand sites
translate their own `index` when they add one.

## Extension (`@omega.js/extension`)

Build-mode gulp `translate` task (setup/dev builds only deploy):

- **messages**: per-KEY incremental — unique `message` values without a cache
  entry translate (CWS limits ride the prompt as extra rules; violations warn
  with the file path to shorten). `dist/_locales/{lang}/messages.json` is
  COMPOSED from the EN source + cache (English fallback per missing key, so
  the file is always complete; developer `description` fields stay English).
- **description**: whole-document per language →
  `translations/{lang}/description.md`, first line
  `<!-- omega:source <hash> -->` (stripped on read; source edit →
  re-translate). The package task ships them as store assets
  (`packaged/assets/description/{lang}.md`).

Languages/provider come from resolved config — the old hardcoded 16-language
list in `gulp/config/locales.js` is gone (only the CWS `limits` remain there).

## Testing

- devkit `test/translate.test.js` — engine protocol, providers, cache,
  language SSOT, settings reader (fake `send`).
- web `test/translate.test.js` — handcrafted dist through the real pipeline:
  copies/chrome/links/exclusions/alternates/cache/override/only-filter, the
  produced-languages-only alternates, and the loud failure skip.
- web `test/language-switcher.test.js` — the switcher's DOM read (x-default
  dropped, duplicates collapsed, current marked, escaping) and the built footer
  mount in classy and newsflash.
- extension `build/translate.test.js` — compose + description marker glue.
- Live canary (cp96, local Claude): omega-brand `/about` → es (102 strings,
  rerun 0 calls) and the extension's 4 messages (2 unique) + 2,703-char
  description → es, both idempotent; artifacts committed under each app's
  `translations/`.
