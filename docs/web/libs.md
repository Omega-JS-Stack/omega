# Web JS libraries (core/js/libs)

The browser-side modules `@omega.js/web` ships for page code to import:
`packages/web/core/js/libs/`. They are the framework's own runtime helpers,
distinct from `@omega.js/client` (the singleton every page boots with) and from
`core/js/pages/` (a page's own module). Page modules, theme modules, the boot
runtime, and consumer page modules all reach them the same way.

## The import idiom

```js
import { createLogger } from '__main_assets__/js/libs/logger.js';
import { loadCharts, chartSlot, barChart } from '__main_assets__/js/libs/charts.js';
```

`__main_assets__/` is a build-time specifier resolved by the esbuild plugin in
`packages/web/src/assets.js`: `__main_assets__/js/...` points at the CORE layer
root (`packages/web/core/`), `__main_assets__/themes/...` at the packaged themes
dir. It is layer-independent, so a consumer's own page module in
`src/assets/js/pages/` writes exactly the specifier core's own pages write
(`core/js/pages/admin/index.js`, `core/js/layouts/modules/utilities/redirect.js`,
`themes/classy/_theme.js`, `runtime/boot.js`). There are no exceptions: every
bundle the pipeline builds — main, page, layout — carries the alias plugin
([#624](https://github.com/Omega-JS-Stack/omega/issues/624) deleted the
standalone-IIFE `js/modules/` lane that did not).

`js/modules/` is therefore not an asset lane in ANY layer. A directory that
still exists builds nothing, and the build prints one warning naming it rather
than ignoring it in silence ([#249](https://github.com/Omega-JS-Stack/omega/issues/249)).
Shared code goes in `js/libs/`; a script that belongs to one layout goes in
`js/layouts/<layout>.js`.

## Premade consumer JS: `src/assets/js/libs/`

The consumer twin of this directory. A brand's own shared browser modules live
in `src/assets/js/libs/` and are imported **by path** from any page module or
from `js/main.js`:

```js
// src/assets/js/pages/pricing/index.js
import { trackPlanChoice } from '../../libs/pricing-telemetry.js';
```

Nothing declares them and nothing registers them: they are ordinary modules the
bundler follows from whichever entry imports them, so they land in the importing
bundle (or a shared chunk, when more than one entry uses them) and cost nothing
on a page that does not. The framework's own `libs/` below are reached the same
way, through the `__main_assets__` specifier instead of a relative path — one
idiom, two layers.

Two neighbours it is NOT: `js/pages/**` is keyed by URL and loads itself, and
`js/layouts/**` is keyed by layout name and does the same — a lib is only ever
loaded by something that imports it. A `js/pages/` file nothing imports and no
URL claims is dead code, and the orphan guard says so
([#469](https://github.com/Omega-JS-Stack/omega/issues/469)); a `js/libs/` file
nothing imports is simply never built.

## The consumer rule: import the helper, never the library

charts.js and graph.js state it, and it holds for both: @tanstack/charts and
mermaid are dependencies of `@omega.js/web`, never a CDN load at runtime, and a
page reaches either one ONLY through its helper module. Consumers import the helpers and
never name the underlying library, so its version and delivery stay the
framework's to change. The helpers own three things a page would otherwise have
to redo:

- **Lazy loading.** The library import inside `loadCharts` / `loadGraph` is
  dynamic, and the bundle is ESM with splitting, so each library lands in its
  own chunk fetched only when a page asks for it. A page with no chart or
  diagram pays nothing.
- **Theming.** Colors are read off the `--omega-*` token sheet at draw time
  ([docs/shared/theming.md](../shared/theming.md)), so a chart or diagram follows
  the brand ramp and dark mode without knowing either exists.
- **Bundling.** The framework's own installed copy of the library resolves for
  whoever imports it, so it ships once.

The practical consequence for a consumer: do not hand-roll SVG for a chart or a
diagram, and do not add @tanstack/charts or mermaid to a target's dependencies.

## The modules

| Module | What it is | Key exports |
|---|---|---|
| `admin-helpers.js` | Formatting and stat-cell helpers for the admin pages: relative timestamps, capitalization, and writing a settled Firestore count-aggregation result (or an inline error) into a stat element | `formatTimeAgo`, `capitalize`, `setStatValue`, `setStatSubValue` |
| `alert-dismiss.js` | The site alerts' × ([#719](https://github.com/Omega-JS-Stack/omega/issues/719)): one delegated `document` click handler hiding the `.main-alert` a pressed `.main-alert-close` sits in. `core/js/main.js` calls it, so every banner `core/_includes/core/body.html` ships is dismissible on every page, an alert injected after boot included | `setupAlertDismiss` |
| `analytics.js` | The web HOST of the analytics facade ([#328](https://github.com/Omega-JS-Stack/omega/issues/328)): it wires the page's three seams into `@omega.js/analytics` and is the ONE way core code counts anything. Detail below | `event`, `identify`, `reset`, `configureAnalytics`, `readPlatformCookies`, `PLATFORM_COOKIES` |
| `charts.js` | TanStack Charts behind framework helpers: lazy load, token colors, a slot to draw into, four chart builders. Detail below | `loadCharts`, `chartsReady`, `chartColors`, `resolveColor`, `chartSlot`, `chartDefinition`, `barChart`, `stackedBarChart`, `doughnutChart`, `lineChart` |
| `dev.js` | Development-only helpers, imported by `runtime/boot.js` only when `manager.isDevelopment()`: a click logger, a breakpoint logger on resize, and the palette's **Tools** section — "Log opening tags" and "Toggle theme", which were `window.logOpeningTags()` / `window.changeTheme()` until [#342](https://github.com/Omega-JS-Stack/omega/issues/342) made the palette the one home | default export: a function that installs all of it |
| `graph.js` | mermaid behind framework helpers, on the charts contract: a definition in, an SVG out. Detail below | `loadGraph`, `graphReady`, `graphTheme`, `graphSlot`, `drawGraph` |
| `initialize-tooltips.js` | Initializes every `[data-bs-toggle="tooltip"]` element as a Bootstrap tooltip, and exits early when the page has none. The ONE home for the behavior ([#99](https://github.com/Omega-JS-Stack/omega/issues/99)): each theme's `_theme.js` calls it from its DOM-ready handler instead of shipping its own copy | default export: `initializeTooltips()` |
| `logger.js` | The web runtime's tagged console, `[@omega.js/web:<module>]` with no timestamp ([#12](https://github.com/Omega-JS-Stack/omega/issues/12)). The methods are getters returning a bound `console` method, so devtools attributes each line to the real call site and a swapped `console` method is still seen | `createLogger(module)`, also the default export |
| `omega-copy.js` | Declarative copy-to-clipboard ([#709](https://github.com/Omega-JS-Stack/omega/issues/709)): one delegated `document` click handler making any `data-omega-copy` element a copy control, so a page writes no JS. The copied value resolves in order — the `omegaCopyValue` property or `data-omega-copy-value` (display and clipboard may differ: a masked row copies the real credential), a selector in `data-omega-copy` (an input's value, a `<pre>`'s text), then the sibling field in the same `.input-group`. Feedback is `showNotification` ('Copied!' / 'Failed to copy' / 'Nothing to copy'). `core/js/main.js` calls it | `setupCopy` |
| `path-prefix.js` | The browser half of base-path support ([#355](https://github.com/Omega-JS-Stack/omega/issues/355)): reads the mount off `<html data-omega-path-prefix>` (the build's own stamp — never baked into the bundle) and mounts a root-relative site path under it. Every absence — no stamp, no document, a worker scope — means the domain root | `pathPrefix()`, `siteUrl(path)` |
| `payment-config.js` | Reads the payment config (products, providers, prices, feature values, currency) off `omega.config.payment` and the FEATURES CATALOG off `omega.config.features`, both populated by the build, so no page fetches either at runtime. A feature is defined ONCE in the catalog and a product names only its value ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)), so `getProductLimits` is the catalog-aware read: only the counted features a product gives a NUMBER | `getPaymentConfig`, `getProviders`, `getProducts`, `getProductById`, `getFeatureCatalog`, `getFeature`, `getProductFeatures`, `getProductLimits`, `getProductPrices`, `getCurrency` |
| `recaptcha.js` | reCAPTCHA v3 for any public form posting to a recaptcha-gated backend route (checkout payment intent, newsletter capture): lazy script load through `omega.dom().loadScript()`, then a token per action. Site key: `omega.config.captcha.providers.recaptcha.siteKey` | `initializeRecaptcha(siteKey)`, `getRecaptchaToken(action)` |
| `srcset.js` | The srcset candidate parser for the browser ([#367](https://github.com/Omega-JS-Stack/omega/issues/367)): rewrites every candidate URL through a caller's function, reading a comma inside a URL (a `data:` payload, a `?w=100,200` query) as part of the URL. The FORMAT TWIN of the build-time `packages/web/src/srcset.js` — a grammar change lands in both files, and each one says so. Used by the runtime lazy-loader for the `data-srcset` lane the build passes defer | `mapSrcset(value, mapUrl)` |
| `sale-name.js` | Picks the promotion name for a date. Holidays (Black Friday, Cyber Monday, Christmas, Easter) run a window of 7 days before to 3 days after their core date, and a later holiday only takes over once the earlier one's core date has passed; with no holiday active it falls back to the season (`Spring Sale`, and `End of Summer Sale` past 70% of the season), then to a plain `Sale` | `getSaleName(date)`, `getUpcomingSales(startDate, endDate)`, default `{ getSaleName, getUpcomingSales }` |

### analytics.js

The ONE call, and nothing about a provider at the call site:

```js
import { event } from '__main_assets__/js/libs/analytics.js';

event('user_refund_request', { action: 'submit' });
```

The name is a CANONICAL event from `@omega.js/analytics`' catalog, which decides
which providers hear it, under which native name, in which dialect — the whole
contract is [docs/shared/analytics.md](../shared/analytics.md). This module is
the web HOST of that facade: it injects the three seams only a page can supply,
once, and exports the call sites' entry points.

| Seam | What web supplies |
|---|---|
| `transport` | the package's guarded browser transport — `gtag` / `fbq` / `ttq`, each checked with `typeof` before it is called |
| `consent` | a gate over `libs/tracking-consent.js`, read LIVE, so a visitor who accepts mid-session is counted from that moment ([#383](https://github.com/Omega-JS-Stack/omega/issues/383)) |
| `context` | `runtime: 'web'` plus the captured attribution, flattened into what the adapters read ([#384](https://github.com/Omega-JS-Stack/omega/issues/384)) |

`environment` is NOT web's: @omega.js/client injects it from the brand's own
`config.environment`, which is what decides whether an unknown event name throws.

The package is reached THROUGH @omega.js/client (`@omega.js/client/modules/analytics.js`),
never as a bare `@omega.js/analytics`: the analytics package is private and never
publishes, so in a consumer install it exists only as the copy vendored into the
client's dist — and the client is a real runtime dependency of every framework.

**Identity is not an event.** `identify(user)` and `reset()` set what the events
after them inherit — GA4's user properties, the Meta Pixel's advanced-matching
`init`, TikTok's `identify` — so they have no catalog entry, and they live here,
guarded the same way. `core/js/core/auth.js` calls them off the auth state. GA4's
`user_id` is deliberately NOT among them: @omega.js/client's `setUserId` owns
that one key on every runtime and sends the derived `uuidv5(uid, namespace)`
value, so a raw uid written here would only clobber it.

**`readPlatformCookies()`** is exported for the same SSOT reason: the checkout's
intent payload needs the `_fbc`/`_fbp`/`_ttp` read at conversion time
(`pages/payment/checkout/modules/api.js`), and one reader means a separator quirk
cannot be fixed on one path and left on the other.

**Why guarded at all**: `gtag`, `fbq` and `ttq` are page-level snippets, and an
ad blocker does not stub them — it keeps them from ever being defined, so a BARE
call throws a ReferenceError. Every one of these calls sits in front of the thing
the customer just pressed, so the throw takes the action with it. That was the
billing card's dead "Undo cancellation" button
([#283](https://github.com/Omega-JS-Stack/omega/issues/283)), found again in 19
other files ([#306](https://github.com/Omega-JS-Stack/omega/issues/306)). Each
provider is checked on its own, because blockers work per list: a page that lost
Meta still counts Google. The same reasoning covers this module's own storage
reads (consent, attribution): a read that fails is a denial or an absence, never
a raise.

`test/analytics-blocked.test.js` keeps it the SSOT with two static sweeps: no
file under `core/js` or the theme layer calls a provider global bare, and none
names a provider at all — the retired `trackGoogle` / `trackMeta` / `trackTikTok`
wrappers cannot regrow one page module at a time. Two files may name the globals:
this module (the guard itself, plus the identity calls) and
`core/js/core/analytics-loader.js`, which DEFINES them.

### charts.js

The library is [TanStack Charts](https://tanstack.com/charts/latest) — a
grammar (marks, scales, mappings) with a framework-neutral DOM host that
renders SVG ([#772](https://github.com/Omega-JS-Stack/omega/issues/772)). It is
**Alpha**, where 0.x minors move together and may break, so the version is an
EXACT pin in `packages/web/package.json` (`"@tanstack/charts": "0.16.0"`, no
range) and an update is a deliberate read of its release notes.

The lifecycle is load, slot, draw:

1. `await loadCharts()` loads the library once. It is idempotent and safe to
   call on every poll (a failed load clears the cached promise so a later call
   can retry), and it resolves a boolean. The grammar is per-capability, so the
   one call fetches the root (Cartesian marks + the DOM host) alongside the
   polar, tooltip and scale subpaths — several chunks, one lazy load.
2. `chartSlot(id, height = 220, series = [])` returns the markup to render: a
   height-bearing box around a `<div id="…">` host that fills it, because the
   host follows its container's WIDTH on its own and is told its height. It
   stamps `series` onto the box as `data-series` so `@omega.js/client`'s
   write-on-change `swap` (`modules/live-page`) sees a data-only change and
   redraws; a host carries no data of its own, so without the stamp the old
   picture would stand.
3. One of `barChart` (with `horizontal` for ranked rows), `stackedBarChart`,
   `doughnutChart`, `lineChart` draws into that id and returns the chart host,
   or `null` when nothing was drawn.

`chartsReady()` is the synchronous check for a render path. Every draw destroys
the host already mounted on that id first (the module keeps a Map of id → host),
so repainting on each poll replaces rather than stacks, and `svgAnimation` is
off for the same reason: a polled page would otherwise spend most of its life
growing bars back out of the axis.

A value axis is labelled in WHOLE numbers: these charts count things, and the
library's own tick policy is a responsive count that lands on 0.5 on a small
domain. The helper supplies integer candidates on the 1/2/5 ladder and a
configured `[first tick, last tick]` domain, so the axis ends exactly on its
ticks; zero always stays on the axis, and a negative reading widens the span downwards.

A tooltip names the THING being read, never the channel it rode in on
([#800](https://github.com/Omega-JS-Stack/omega/issues/800)): a bar says
`label: value`, a stacked segment and a line reading say `series · label: value`,
and a doughnut slice adds its share of the whole. The unit travels with the
data — `format: { prefix?, suffix?, decimals? }` on any builder's data argument,
plain JSON so a page carrying chart data alone can hold it — and it prints in
the tooltip AND on the value axis, so a money chart says `$` in both places.
Stated `decimals` are exact (`$7.00`); unstated, a count prints as itself and a
fraction gets at most two places. A page with JS may pass
`tooltip: (point) => string` to take the whole line over, where `point.datum` is
the row the mark drew (`{label, value}`, plus `series` on a stacked or line
chart, plus `fraction` on a doughnut).

`chartDefinition(kind, data)` — `'bar'`, `'stacked'`, `'doughnut'`, `'line'` —
returns the definition a builder would draw, without drawing it. A definition is
renderer-neutral and DOM-free, which is what lets the package's own suite
(`test/dataviz.test.js`) compile all four through `createChartScene` and assert
real geometry in node. The PAINT still needs a browser: the sandbox e2e lane's
chart step (`brands/sandbox-brand/test/e2e/run.js` → `window.__omega.drawCharts()`)
fails a chart whose host holds no SVG mark with a non-zero box. An unknown kind
is a programmer error and throws.

Element ids are authored, so `chartSlot` throws on anything that is not a plain
id. When the library did not load, `chartSlot` returns a line saying so in place
of the host instead of leaving a hole, which is why a chart always sits beside
the same figures in a table or statgrid.

Theming: `chartColors()` reads `--omega-ink-muted`, `--omega-line`,
`--omega-accent`, and the categorical ramp `--omega-chart-1` through
`--omega-chart-6` off `:root`, falling back token, then Bootstrap variable, then
a hardcoded color. Those values become the definition's `theme` (axis and
legend ink, gridlines, the categorical palette) and its color scale's `range`.
`resolveColor()` turns a `var(--token)` string into a real color, which is how a
caller passes `colors: ['var(--omega-ok)', …]` to keep STATUS meaning where the
categorical ramp would only say "different". Tokens are read at draw time and
nothing listens for a theme flip, so a light/dark switch lands on the next
redraw.

### graph.js

The same shape, for mermaid diagrams: `await loadGraph()`, then
`graphSlot(id, height = 320, definition = '')`, then
`await drawGraph(id, definition)`, with `graphReady()` as the synchronous check.
`drawGraph` returns the SVG it rendered (also written into the host), or `null`.
The module takes a DEFINITION in and puts an SVG out: composing the mermaid text
is the page's business, because the shapes and words in a diagram are content,
not framework.

`graphSlot`'s height is a FLOOR (`min-height`): the host is empty until the
render lands, so the box reserves the space rather than letting the page jump,
and a taller diagram still grows past it. The definition is stamped as
`data-series` for the same `swap` reason charts stamp their series, and ids are
validated the same way.

`graphTheme()` resolves the live tokens into mermaid `themeVariables` for the
`base` theme: ink, both surfaces, `--omega-line` for edges, `--omega-accent` for
the node outline, and the same `--omega-chart-1` through `--omega-chart-6` ramp
charts read, mapped onto mermaid's `cScale0` through `cScale5` and `pie1` through
`pie6` slots (an unset slot is left out so mermaid derives its own). Mermaid
paints with literal colors, so nothing is ever handed a `var()`. `drawGraph`
initializes per render (`startOnLoad: false`, `securityLevel: 'strict'`,
`suppressErrorRendering: true`) because the tokens are read per render, and it
throws on a definition that does not parse: diagram text is authored, so a syntax
error in it is a programmer error and says so instead of drawing nothing.

## The auth cluster (`libs/auth/`)

The three auth pages (`/signin`, `/signup`, `/reset`) share nearly all of their
logic, so the page modules import one orchestrator and the flows live in focused
modules beside it. `auth/index.js` builds a shared context object
(`{ formManager, useAuthPopup }`) and passes it explicitly to every flow that
needs it.

The boot order is the orchestrator's whole job, and it runs inside
`omega.dom().ready()`: handle `?authSignout`, then `?authCustomToken`, then
`?authPrivateKey` (return if either sign-in took over, the page is navigating),
then build the page's form from the `data-page-path` suffix, disable the fields
while checking for a returning OAuth redirect (return if one was handled), then
check the subdomain policy, call
`formManager.ready()`, and propagate `authReturnUrl` into the page's auth links.

| Module | What it is | Key exports |
|---|---|---|
| `auth/index.js` | The orchestrator: owns the boot order above and picks the form by matching the final segment of `data-page-path`. Imported by the `/signin`, `/signup`, and `/reset` page modules | default export: a function |
| `auth/forms.js` | FormManager wiring for the three forms (built with `autoReady: false`, since the boot sequence calls `ready()` itself), the shared validation that only checks email and password when the pressed button's `data-provider` is `email`, the provider-aware submit handler, and the signup consent UI: both checkboxes are outlined as one unit, and consent is stashed to `omega.storage()` BEFORE any Firebase call so it survives the post-signup redirect for the backend's signup route | `initializeSigninForm`, `initializeSignupForm`, `initializeResetForm` |
| `auth/email.js` | Email and password flows. Signup falls back to signing the user in when the address is already in use; reset reports success even for an unknown address, to avoid email enumeration; and each error lands on the field it belongs to (Firebase collapses wrong-email and wrong-password into one code, so both fields get the shared message) | `handleEmailSignin`, `handleEmailSignup`, `handlePasswordReset` |
| `auth/oauth.js` | Provider flows: redirect by default, popup only inside an iframe or with `?authPopup=true`, with a popup-to-redirect fallback on blockers. Also the returning-redirect provider (a one-shot sessionStorage marker makes a redirect that came home empty loud instead of silent) and the accidental-signup reversal: Google auto-creates an account during a signin attempt, so the reversal deletes it, signs out, and shows an inline error — and marks the uid for `auth/orphan.js` when that delete fails | `shouldUseAuthPopup`, `handleRedirectResult`, `signInWithProvider`, `reverseAccidentalSignup` |
| `auth/orphan.js` | The failed-delete backstop ([#703](https://github.com/Omega-JS-Stack/omega/issues/703)): a reversal whose `.delete()` fails leaves a live account with no consent record, and nothing about the account says so afterwards (a self-read is always allowed, and every account is consent-less until the `/user/signup` post lands), so the browser that failed the delete marks the uid in `omega.storage()`. `core/js/core/auth.js` retries the delete at auth-ready for THAT uid and nothing else — an account with legal consent on record is never touched, and a deliberate signup clears the markers before Firebase is called. A second failure signs the user out, reports it, and keeps the marker for the next visit | `markOrphanedAccount`, `clearOrphanMarkers`, `retryOrphanCleanup` |
| `auth/session-params.js` | The URL-parameter session behaviors: `?authSignout=true` (sign out, then strip the param so reloads do not loop), `?authCustomToken=…` (admin impersonation and custom-token sign-in, which owns its own post-signin navigation), `?authPrivateKey=…` (the durable-URL lane for an OBS dock, a kiosk, or a bookmark: a custom token expires in an hour, so the key buys a fresh one at `POST /omega/user/token` on every load, is stripped from the address bar BEFORE the page moves, and is never logged, notified, or captured), `authReturnUrl` propagation into every auth link on the page, and the apex-domain bounce when `auth.config.allowSubdomainAuth` is false | `handleAuthSignout`, `handleCustomTokenSignin`, `handlePrivateKeySignin`, `updateAuthReturnUrl`, `checkSubdomainAuth` |
| `auth/errors.js` | Pure Firebase error translation, no DOM and no form state: which codes belong on the password field, the short message for each, which codes are user-caused and therefore never worth a Sentry capture, and pulling a `@omega.js/backend` blocking-function message (rate limit, disposable email) back out of the opaque `auth/internal-error` blob | `isPasswordError`, `passwordErrorMessage`, `isUserError`, `extractBlockingFunctionMessage` |
| `auth/tracking.js` | GA4, Facebook Pixel, and TikTok Pixel events for the three auth outcomes | `trackLogin`, `trackSignup`, `trackPasswordReset` |
| `auth/password-toggle.js` | The password eye, registered once as the `password-toggle` click trigger on `@omega.js/client`'s shared trigger registry ([#16](https://github.com/Omega-JS-Stack/omega/issues/16)). `core/js/main.js` calls it, so it is armed on every page before any page module runs, and delegation covers input groups rendered after boot | `setupPasswordToggle` |

## See also

- [docs/web/index.md](index.md) for the framework guide, including the bundler
  aliases and the conventions charts, graphs, and the log tag are pinned by
- [docs/shared/theming.md](../shared/theming.md) for the `--omega-*` tokens the
  chart and graph helpers read
