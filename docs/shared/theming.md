# Theming — the OMEGA design system contract

> classy v2 (the flagship skin) + the shared machinery every theme and, at C4,
> every target rides. Visual spec: [docs/web/classy-v2/DIRECTION.md](../web/classy-v2/DIRECTION.md).

The one-hex/one-token half of this contract is checkable per edit: the plugin's `omega:brandcheck` skill,
[agent-plugins/claude/skills/brandcheck/SKILL.md](../../agent-plugins/claude/skills/brandcheck/SKILL.md), and
its quality hook fires on every stylesheet edit (contrast, focus, and reduced-motion checks ride `omega:accessibility`).

## The three layers

1. **Tokens** — `packages/web/core/css/tokens/_index.scss` emits the
   `--omega-*` custom-property contract: neutrals (`ground`, `surface`,
   `surface-2`, `ink`, `ink-muted`, `ink-faint`, `line`, `line-strong`), the
   accent family (`accent`, `-hover`, `-active`, `-subtle`, `-ink`, `-ring`),
   status (`ok`/`warn`/`danger`, each with an `-rgb` channel twin — see
   "One status hue site-wide" below), the categorical ramp (`chart-1`…`chart-6` —
   series-1 rides the accent, the rest are CVD-validated muted hues, cool half
   before warm), shadows
   (`shadow-1`/`shadow-2`), shape (`radius-xs/s/m/l/xl`), motion (`speed`,
   `speed-slow`, `speed-first-paint`, `ease`), and the type slots (`font-ui`, `font-serif`,
   `font-mono`, plus the pairing slots `font-marketing` and `font-display`).
   Light + dark values ship together: OS preference carries via
   `@media (prefers-color-scheme: dark)`, and the `data-bs-theme` stamp
   (core/js/core/appearance.js) beats it in both directions. **Names are the
   stable API; values are the skin.**
2. **Mechanics** — `core/css/shell/_index.scss` (the `.omega-shell` app
   chrome: 264px sidebar / 68px rail / 60px topbar, drawer under 1200px; the
   rail clips nothing — its nav scrolls inside the `__sidebar-scroll` region
   so rail popovers can escape, [#319](https://github.com/Omega-JS-Stack/omega/issues/319);
   main claims the `1fr` row explicitly, so a page that turns the topbar off
   still scrolls inside main instead of handing the scroll back to the
   document, [#741](https://github.com/Omega-JS-Stack/omega/issues/741)),
   `core/css/motion/_index.scss` (below), and `core/css/components/_index.scss`
   (the shared component vocabulary: `omega-chip` and its `--accent`/`--ink`
   modifiers, plus the app-chrome pair the base topbar/sidebar renders —
   `.btn-icon`, the square ghost icon button, and `.omega-search`, the ⌘K field
   with its input and its `kbd` shortcut badge). All three paint exclusively through tokens so a skin restyles
   them without touching structure, and all three emit BEFORE the theme so a
   skin's own rules win. **Promotion rule
   ([#242](https://github.com/Omega-JS-Stack/omega/issues/242))**: a component
   the BASE layer renders belongs in the component sheet, never in one theme's
   partials — the icon-CSS ruling (presentation SSOT in the shared sheet).
   Theme-only components (classy's marketing vocabulary) stay in their theme.
3. **Theme** — `themes/<id>/`, a skin over `themes/base` (the structural
   `omega-*` markup layer every theme chain terminates at; classy is the
   flagship and the default skin). classy v2's `css/base/_root.scss` bridges Bootstrap's CSS
   variables onto the tokens, so every Bootstrap component follows the theme,
   the brand ramp, and consumer overrides with zero recompilation.

## The three surface tiers (and which way elevation runs)

`--omega-ground` is the page, `--omega-surface` is a card lifted off it, and
`--omega-surface-2` is the second tier: table heads, chips, code blocks, hover
fills, receipt panels, segmented tracks. The tiers move in OPPOSITE directions
per mode, and a component may not assume one of them: dark elevates by getting
LIGHTER (`#0d0d0e` ground → `#151516` surface → `#1d1d1f` surface-2), light
elevates with white plus a shadow and recesses by getting DARKER (`#f5f5f4`
ground → `#ffffff` surface → `#ececeb` surface-2, the well).

Light surface-2 shipped at `#f6f6f5`, one point off the ground, so every
component that painted it directly on the page was invisible in light mode and
correct in dark ([#152](https://github.com/Omega-JS-Stack/omega/issues/152)).
The value is now a real well: readable on the ground AND inside a white card,
still lighter than `--omega-line`. Its Bootstrap twins move with it:
`$classy-surface-2-light` (compile-time `$body-secondary-bg`) and
`--bs-secondary-bg-rgb` in classy's root bridge.

Two readings of a segmented control are both sanctioned, and both work in both
modes: a RAISED track (surface + `--omega-line-strong` + `shadow-1`, selected
segment recessed to surface-2, the billing toggle) or a RECESSED track
(surface-2 straight on the ground, selected segment raised to white, the
platform rail).

## brand.color → the accent ramps

`omega.json5 → brand.color` is an optional hex string (`#RGB` / `#RRGGBB`,
schema-validated since [#272](https://github.com/Omega-JS-Stack/omega/issues/272);
unset leaves the token sheet's neutral placeholder standing) and it drives
`composeBrandTokens()` (`packages/web/src/brand-tokens.js`): a light ramp plus a **dark-mode variant**
(darker brands lift into a legible lightness band for the charcoal ground;
already-light brands pass through). `core/_includes/core/head.html` emits both
as inline `:root` blocks AFTER the css bundles — same three-stamp plumbing as
the token sheet — so the ramp wins the cascade everywhere, including
`.btn-primary`, links, focus rings, `.form-check-input:checked`,
`.progress-bar`, and `.text-primary`/`.bg-primary` (classy re-points those at
the tokens).

## Consumer customization (tier 1 — main.scss)

- **Discovery**: `omega customize --list` prints the layered override map —
  every shadowable file (sections, includes, css, pages), its owning layer
  (framework / `theme:<id>` / consumer), and whether you already shadow it.
  `omega customize <path>` materializes ONE of them at that path with a
  provenance header; reading the theme source tree to guess a path is over.
  The css lane lists only what sass actually layers by — `main.scss` and the
  page sheets — because a bare relative `@use`/`@import` inside a theme sheet
  resolves against the importing file, so a consumer copy of a partial would
  never load.
- **Recolor**: set `brand.color` in omega.json5. No CSS.
- **Sass knobs**: every variable in `themes/classy/_config.scss` is `!default`
  — `@use 'omega:main' with ($primary: …, $font-family-sans-serif: …,
  $border-radius: …)` from the consumer main.scss.
- **Token overrides**: redefine any `--omega-*` property in `:root` /
  `[data-bs-theme='dark']` for surgical re-vibing (grays, radii, speeds,
  shadows, type).
- **Type presets**: stamp `data-omega-type="sans|serif|mono"` on `<html>`
  (via `theme.html.attributes`) or re-point `--omega-font-marketing`
  / `--omega-font-display` directly. Default is the mix pairing — serif
  marketing display over sans UI.
- **Fonts (D5, shipped)**: classy vendors **Inter** (UI grotesk) and
  **Newsreader** (marketing serif); newsflash vendors **Schibsted Grotesk**
  and **Fraunces** the same way (cp187 — its Google Fonts CDN link is dead) —
  variable woff2, latin + latin-ext, OFL —
  in `themes/<theme>/fonts/`; the asset pipeline copies every layer's `fonts/`
  dir to `/assets/fonts` (first layer wins, and a consumer-local theme is
  followed by the packaged theme it SHADOWS — inheriting that skin's sheet
  through the hatch inherits the files its `@font-face` rules point at,
  [#773](https://github.com/Omega-JS-Stack/omega/issues/773)), `css/base/_fonts.scss` carries
  the `@font-face` blocks (`font-display: swap`), and `css/base/_root.scss`
  re-points `--omega-font-ui` / `--omega-font-serif` at them. The core token
  sheet keeps system stacks as the framework default AND the fallback tail —
  swapping faces stays a values-only change (two custom properties + the
  files). Ordering note: core main.scss MUST load the token sheet before the
  theme `@forward` (Sass emits a module's CSS at its first load), or theme
  token overrides lose the cascade. The head PRELOADS the first-paint faces,
  and the list is read off those `@font-face` rules in the compiled sheet
  ([#765](https://github.com/Omega-JS-Stack/omega/issues/765)) — a face with no
  `unicode-range`, or one whose range reaches basic latin (U+0000-00FF), is a
  first-paint face; the `-latin-ext` subsets stay out. So a theme naming its
  files its own way, or vendoring ONE variable face, preloads correctly with
  nothing to declare: the declaration IS the `@font-face`
  ([docs/web/index.md](../web/index.md)).
  And the face that paints BEFORE it lands is metric-matched
  ([#768](https://github.com/Omega-JS-Stack/omega/issues/768)): the css lane
  measures each vendored family's own font file, measures the system family the
  theme's stack already names next, and generates
  `@font-face { font-family: '<Family> Fallback'; src: local('<system family>'), ...;
  size-adjust; ascent-override; descent-override; line-gap-override }` (one
  `local()` per measured family the stack names, so the face resolves on macOS
  and Windows alike; the overrides follow the first), then
  names that face right after the web family in the `--omega-font-*` stack. The
  system font occupies the same lines the webfont will, so `font-display: swap`
  moves nothing (classy: Inter over `Helvetica Neue` at size-adjust 105.508%,
  Newsreader over `georgia` at 91.224%). A theme gets this for FREE: the
  transform reads the compiled sheet, so a theme's own faces and its own stacks
  are all it has to declare, and no scss file names a fallback family. What a
  theme owes is the tail: a stack that reaches none of the measured system
  families (Arial, Helvetica, Helvetica Neue, Georgia, Times New Roman,
  Verdana) gets no fallback face and one build warning naming the family.

Tier 2 stays: fork `themes/_template` for a full theme; `themes/base` remains
the fall-through layer for anything the theme doesn't cover, and base's
`_theme.scss` forwards classy's theme as the default skin css. The tier is
PROVEN in a real build by the brand-shape corpus's `shape-theme-override` cell
([#773](https://github.com/Omega-JS-Stack/omega/issues/773)): a consumer-local
theme shadows the packaged one of the same id, and every file kind the cascade
resolves — layout, include, the scss entry, a section's html, its own section
js, and a lane left to the chain with `inherit: ['js']` — is read back out of
`dist/` ([testing.md](testing.md)).

### CSS fall-through — the two lanes (cp190, closes the audit's asymmetry)

Layouts/includes fall through per-file, but a theme's `_theme.scss` never
did — a non-classy theme rendered the shared `omega-*` vocabulary
unstyled on fall-through pages. Two blessed lanes now cover it, both
proven:

- **Partial/consumer themes** (no Bootstrap of their own): put
  `@forward 'omega:theme';` at the top of the theme's `_theme.scss` — the
  importer resolves through the layer roots and SELF-SKIPS the requesting
  file, so the forward lands on base's `_theme.scss` (a bridge forwarding
  classy's theme as the default skin css) and emits classy's whole
  chain (Bootstrap included, configured through the forward); the theme's
  own rules land after and win the cascade. Pinned in
  `test/themes.test.js` ("inheritance hatch").
- **Full sibling themes** (own Bootstrap config — newsflash): do NOT
  inherit wholesale (two Bootstraps); import classy's app/auth partials
  directly as the vocabulary FLOOR — they are deliberately TOKEN-PURE
  (zero Sass config coupling), so they paint through the importing theme's
  token re-values. The set: `layout/shell` (+ `.page-header`),
  `layout/footer` (the shared footer include speaks `omega-footer`
  vocabulary on every page — the floor supplies structure, the theme
  re-inks it), `app/panels` (table/statgrid/iconbtn/count), `pages/auth`,
  `components/receipt`, `components/badges` (dot-status; the chip left for the
  core component sheet in #242, so every theme gets it with no floor at all). Import
  EARLY (the floor sits UNDER the theme's voice, so later theme rules win
  collisions like classy's `.badge` base). Live models:
  `themes/newsflash/_theme.scss`, `themes/neobrutalism/_theme.scss`.
  NOT in the floor and never needed there: `components/buttons` and
  `components/forms` are Sass-config coupled, so the two app-chrome pieces they
  used to hide — `.btn-icon` and `.omega-search` — moved to the core component
  sheet in [#303](https://github.com/Omega-JS-Stack/omega/issues/303). A sibling
  theme that skipped them rendered a native UA button box beside the breadcrumb
  and a native search field with reboot's inverted `kbd` (a solid cream slab on
  a dark skin). Anything else a base surface renders takes the same route: the
  core sheet, never a widened floor.

**The guard ([#98](https://github.com/Omega-JS-Stack/omega/issues/98))**: the web
asset lane reads the COMPILED main bundle for three sentinels the two lanes both
guarantee — `.omega-auth`, `.omega-statgrid`, `.omega-footer`, one per
fall-through surface (the other floor partials ride along unsentineled) — and a
non-classy theme missing ANY of them gets one loud build WARNING (never a failure)
naming the theme, the missing piece (hatch vs floor — decided by whether the
bundle defines `--bs-body-bg`, i.e. whether the theme ships its own Bootstrap),
and the exact line to add. `packages/web/src/theme-vocabulary.js`; every bundled
theme is silent, pinned in `test/themes.test.js` ("fall-through guard").

Rule for classy authors: app/auth vocabulary partials MUST stay token-pure
— a Sass config dependency there breaks every sibling theme's floor.

## Content-page vocabulary (default pages + blueprints)

Every classy frontend default page composes from one shared set
(`themes/classy/css/marketing/_content.scss` + the existing section/bento
vocab): `omega-page-hero` (+ `omega-display--page`) opener, `omega-prose`
long-form (blog posts, legal md, bios), `omega-timeline`, `omega-post-card`
(the ONE blog card — `_includes/frontend/components/post-card.html`, shared
by index/related/category/tag grids), `omega-person`, `omega-facts`
(hairline-divided columns; `__value--num` serif numerals, `__sub` footnote),
`omega-chip-cloud`, `omega-blog-search`, and token-driven `.pagination`.
Consumer frontmatter keys are unchanged — pages re-rendered, data contracts
kept.

**Compositional set (cp147 — pages are COMPOSED, not centered)**:
`omega-hero-split` (asymmetric opener: statement + side rail),
`omega-duo` (label/head column + body column, sticky aside; column split
overridable via `--omega-duo-cols`), `omega-statement` (editorial letter
text — big serif with italic `<em>`), `omega-numbered` (principles list
with serif italic indices), `omega-channel` (contact/support rows),
`omega-band` (one wide hairline row — enterprise, platform strips),
`omega-form-panel` (the hairline container every long form sits in), and
the `.omega-quiet` fine-print voice.

**Post media + author contracts** (post-card AND the post page honor them):
`post.image: false` → designed no-media panel (serif italic category
monogram on dotgrid), never a 404 `<img>`; `post.image: "<path>"` → that
image lazy-loaded; absent → the legacy `/assets/images/blog/post-<id>/`
convention. An author that resolves to no team member renders a neutral
pen-nib mark + the brand name (no broken avatar rows).

**Footer pattern** (`frontend/sections/footer.html` + `css/layout/_footer.scss`,
draft-2): brand block (lockup + one-liner + social icon row) beside auto-fit
link columns; ONE hairline base row where copyright, legal links, the
language dropup pill, and the segmented appearance control all share the
same 1.75rem scale. The appearance segments are plain `data-appearance-set`
buttons — core appearance.js stamps `.active`/`aria-pressed`. The brand
lockup class (`.omega-nav__brand`) is root-scoped and shared by nav +
footer.

**Per-page theme css slot**: `themes/<theme>/css/pages/<page>/index.scss`
compiles to its own bundle and loads after main css AND core's page sheet — one
rule, every layer's sheet in layer order ([#624](https://github.com/Omega-JS-Stack/omega/issues/624)). That's where a theme outranks core page
rules; classy's `status` and `feedback` entries repaint the JS-toggled `bg-*`
state classes (a class contract — never rename them) into the hairline
language there.

## App panels (App DNA — dashboard/admin content)

`themes/classy/css/app/_panels.scss`: `omega-statgrid` (the DIRECTION
merged stat card — ONE card, hairline column dividers, micro-label +
tabular value + delta chip per cell; it sizes off ITS OWN width, never the
viewport — `--omega-statgrid-cols` sets the column CEILING and cells reflow
below a 10rem floor, so a statgrid nested in a half-width card wraps instead
of overflowing), `omega-panel-title` (the 14/650 card-title voice), and
`omega-activity` (hairline-divided feed rows with neutral icon chips).
The backend dashboard layout and the admin dashboard/users blueprints
render on these; every JS-populated id (`stat-*`, tables, charts) is a
contract and stays.

## Categorical tones + the interactive affordance (#72)

Two shared utility sets in `core/css` — core, not classy, so every theme
inherits them:

- **Tones** (`core/css/core/_tones.scss`): `.omega-tone-1`…`.omega-tone-6` set
  `--omega-tone` to the matching `--omega-chart-*` slot, and
  `.omega-badge-tone` paints a chip with it (`color-mix` tint, no
  uppercasing — a tone label is an identifier, not a word). ONE ramp for two
  surfaces: a chart series and the badge naming the same thing are the same
  color. Which name falls in which slot is the page's business. The sheet
  loads after the theme forward, so it outranks a theme's own chip rules.
- **`.omega-interactive`** (`core/css/motion/_index.scss`): the whole-surface
  click affordance — the surface warms on hover AND `:focus-visible`, an
  accent ring on focus, an accent-subtle tint on press. `--lift` adds the
  card lift (2px up, shadow-2) that presses back down; a row takes the base
  class alone. `prefers-reduced-motion` drops the transition and the lift, and
  classy drops the lift outright (see "classy never raises on hover" below).

Charts read the same ramp: `core/js/libs/charts.js` (`chartColors()`) resolves
`--omega-chart-1…6` off `:root` and hands them to the chart definition as its
theme palette, so a chart follows the brand ramp and dark mode without knowing
either exists. A surface that means a STATUS passes the
status tokens explicitly instead (`colors: ['var(--omega-ok)', …]` — the
helper's `resolveColor` reads them off the live sheet); the admin dashboard's
plan doughnut is the reference case ([#74](https://github.com/Omega-JS-Stack/omega/issues/74)).

Graphs read the same ramp again: `core/js/libs/graph.js` (`graphTheme()`) maps
`--omega-chart-1…6` onto mermaid's per-item slots (`cScale0…5` and `pie1…6`),
and the rest of a diagram off `--omega-ink`, `--omega-surface`/`--omega-surface-2`,
`--omega-line` and `--omega-accent` — the accent is the node outline, the one
place the brand color lands in a diagram
([#169](https://github.com/Omega-JS-Stack/omega/issues/169)). Mermaid paints
with literal colors, so every token is resolved before it is handed over, and
the read happens at draw time: like charts, a light/dark flip lands on the next
redraw and nothing listens for it.

## One status hue site-wide

`--omega-ok` / `--omega-warn` / `--omega-danger` are the ONLY greens, ambers
and reds on a site. Each ships with an `-rgb` channel twin (`--omega-ok-rgb:
18, 146, 92`) because Bootstrap's translucency utilities paint from
`rgba(var(--bs-success-rgb), …)`, which no `var()` can feed a hex to. Every
theme's root bridge points `--bs-success`/`-warning`/`-danger` and their `-rgb`
companions at the tokens, AFTER Bootstrap compiles, so `bg-success`,
`.text-success` and a token-painted glyph are the same color in both modes —
the /status page's "all systems operational" and the uptime bars beneath it
were two different greens in dark mode until this landed
([#13](https://github.com/Omega-JS-Stack/omega/issues/13)).

Affirmation ticks ride that same bridge: every "you get this" check (plan
features, benefit lists, hero meta, comparison "yes" cells, signup benefits)
wears Bootstrap's `.text-success` on the icon or its wrapper, and nothing else.
There is no framework class for it: the `.omega-check`/`--omega-check` seam
was deleted (Ian's ruling 2026-07-31, #44) because it computed exactly
`.text-success`: a concept Bootstrap already names is expressed through
Bootstrap's hook, and `omega-*` is only for concepts Bootstrap has no name for.
A call site NEVER paints a check its own color (#11's call-site rule stands).

**A theme that re-values a status hue MUST re-value its `-rgb` twin** (only
newsflash does today) or the two drift apart again. `test/tokens.test.js` pins
both halves: the twins exist in every stamp, and the bridge is the LAST
`--bs-success` in every theme's compiled css.

## Motion library

CSS: `core/css/motion/_index.scss`. Engine: `@omega.js/client/modules/motion.js`
(`createMotion()`), started by `core/js/first-paint.js` and registered on the
omega library by `core/js/core/motion.js` — shared with desktop/extension at C4
exactly like icon-renderer.

| Surface | Use |
|---|---|
| `data-omega-reveal="up\|fade\|left\|right\|scale"` | reveal once on scroll-in |
| `data-omega-reveal-stagger="60"` (parent) | staggers child reveals (ms step) |
| `data-omega-first-paint` (band) | the band IS the first viewport: its reveals are started at PARSE time by head.html's inline starter (no fetch), and a rotator inside it opens on its first word (css) |
| `data-omega-countup` | counts to the number already in the markup |
| `data-omega-rotate="2600"` | children cycle (hero word rotator, quotes) |
| `data-omega-marquee` + `.omega-marquee__track/__item` | seamless loop — the set is cloned until half the track covers the container (never runs dry), constant px/s (attr value overrides); clones are `aria-hidden` with focusables detabbed (`tabindex=-1`, still mouse-clickable) so interactive sets (newsflash ticker headlines) stay accessible |
| `data-omega-scroll-watch="24"` | stamps `data-omega-scrolled` (glassy nav) |
| `data-omega-segmented` | gliding-thumb segmented control: engine injects `.omega-segmented__thumb` and tracks the checked/`.active` segment (billing toggle, platform rails, footer appearance) |
| `data-omega-dotfield="22"` | canvas dot grid (value = px spacing): slow traveling wave, dots tint along ONE drifting rainbow gradient, pointer glow (tracked window-level so the fixed nav can't blind it); the loop starts only once first paint has settled and repaints at 30fps (below), reduced motion gets ONE still grid, and static CSS dots remain for no-JS |
| `.omega-hover-lift/-raise/-dim`, `.omega-pressable`, `.omega-hover-nudge .omega-nudge` | pure-CSS hover/press effects |
| `.omega-interactive` (+ `--lift`) | whole-surface click affordance: warm on hover/focus-visible, ring on focus, tint on press |
| `.omega-float`, `.omega-caret` | ambient float, terminal caret |

Resilience rules (load-bearing):

- Reveal styles only hide content under the inline `html[data-omega-motion]`
  stamp (head.html) — **no JS means a fully visible page**.
- **A reveal never waits for the big bundle**
  ([#585](https://github.com/Omega-JS-Stack/omega/issues/585)). The stamp lands
  before first paint, so a hidden reveal that waited on the engine's
  IntersectionObserver was blank text for the whole JS download on a cold cache
  — LCP measured on an empty band. The cause was never the animation but WHERE
  the starter lived: `core/js/main.js`, behind firebase/auth/analytics init. The
  fix is `core/js/first-paint.js` — its own asset entry, loaded from `head.html`
  as a deferred `type="module"` script, so it runs the moment the DOM is parsed:
  ahead of the main bundle's module in the foot, and independent of images,
  fonts and firebase. Same engine, same CSS transition, same feel; it just
  starts when the DOM is ready instead of when the app is.
- **The band in the FIRST viewport starts its reveals at PARSE time**
  ([#763](https://github.com/Omega-JS-Stack/omega/issues/763), Ian's ruling
  2026-09-02). Booting the engine early made the gate cheap, not free: the
  reveal lane is a SCROLL lane, and the opening band is never scrolled to.
  Holding it at opacity 0 until the observer fires cost the playground homepage
  ~2.0s of a 2,588ms mobile LCP, measured on `p.omega-hero__sub`
  ([#749](https://github.com/Omega-JS-Stack/omega/issues/749)). #749 answered
  that by taking the hero copy out of the lane entirely; the above-the-fold fade
  is part of the design, so the attributes came back and the ATTRIBUTE changed
  meaning instead. A band that declares `data-omega-first-paint` is run by an
  inline starter in `head.html`, right after the motion stamp: a plain script,
  no module and no fetch. A MutationObserver on `document.documentElement`
  collects the reveals in each batch of added nodes, and **the guard is per
  ELEMENT, never per band** — the parser hands a band over at its OPEN tag, when
  it holds no copy yet, so a band-level "handled" flag stamps nothing and leaves
  the work to `DOMContentLoaded`, which waits for the deferred bundles: the very
  wait this removes. Each batch coalesces TWO animation frames — the first
  paints what was collected at opacity 0, which is the transition's starting
  state, the second stamps it — then re-applies the stagger across the whole
  container (`--omega-reveal-delay` per child, same 60ms default; parse order is
  document order, so an index never changes and re-setting a value restarts
  nothing) and sets `data-omega-inview`. `DOMContentLoaded` disconnects the
  observer after one last pass, as a backstop. The engine's `observeReveal`
  returns early on a stamped element, so its later boot changes nothing inside
  the band, and the starter needs no reduced-motion guard of its own: the reveal
  lane hides only under `(prefers-reduced-motion: no-preference)`, so a visitor
  who asked for less motion gets the final state either way, JS or no JS.
  **The inline critical block has to carry the reveal lane** for any of that to
  be visible: every reveal rule is scoped `html[data-omega-motion] …`, a token
  no markup scan can see, so PurgeCSS purged the lane out of the block and a
  built page painted its copy VISIBLE, stamped it, and met the deferred sheet
  with the element already resolved — no fade at all. The critical extractor
  safelists that one lane (`src/assets.js`, ~1.1 KB), pinned by
  `test/critical-css.test.js`. So the marketing
  hero's copy stack (badge, headline, sub, CTAs, meta, frame) is back on the
  lane behind its `data-omega-reveal-stagger="40"` container, and so is any
  markup the template never sees (an authored `demo_html` slot, a custom hero
  animation folder). The headline's word rotator is the one above-the-fold gate
  the starter does NOT resolve — the engine owns the cycle — so its css rule
  stays: inside a first-paint band the FIRST word paints with the document and
  yields the moment the engine stamps `data-omega-active`, which it does on that
  same child. Below-the-fold bands keep the one lane, untouched.

  **A first-paint band fades on its own, shorter token.** Chrome reports the
  largest element painted only when its fade ENDS, so the first viewport's
  transition and the stagger ahead of it land on LCP in full; the proof on the
  playground home (mobile, slow 4G) put the 550ms reveal behind a 90ms stagger
  750ms past first paint. `motion/_index.scss` therefore times
  `[data-omega-first-paint] [data-omega-reveal]` with `--omega-speed-first-paint`
  (300ms in core) and the hero's stagger is 40ms a step: the same fade, the same
  lane, 400ms past first paint. Below the fold nothing changed, because no
  metric watches a scroll-in reveal. A theme re-times the first viewport by
  setting the token, exactly as it sets `--omega-speed-slow` for the rest.

  **Every first-viewport band declares the attribute, not just the hero**
  ([#467](https://github.com/Omega-JS-Stack/omega/issues/467) Phase 2). The
  five the #749 worker found still gated took the identical treatment:
  `about/hero` (both its layouts, photo-lead and split), the document masthead
  in `_layouts/frontend/core/minimal.html`, and the opening bands of
  `download.html`, `contact.html` and `pricing.html`. Four of them compose
  their copy through the shared `heading/masthead` component, which emits the
  reveal attributes itself, so the component takes a `first_paint: true`
  switch rather than losing them. The follow-up pass then walked the REST of
  that component's callers, and every one of them proved to be its page's
  opening band too: `status.html`, `feedback.html`, `blog/index.html` and the
  four blog taxonomy layouts, `team/index.html`, `legal/document.html` (whose
  band wears `omega-legal__head`, not a dotgrid), `alternatives/index.html`
  and `alternatives/alternative.html`, the three `collection/` layouts,
  `extension/index.html` and `updates/index.html`. The switch stays on the
  component because a MID-page caller (a consumer's own composition, the
  component gallery) still belongs on the reveal lane. Those masthead clusters
  therefore carry no reveal attributes at all, which #763 left exactly as it
  found them: the starter animates whatever a first-paint band carries, and
  these bands carry nothing. Below the fold on every one of these pages,
  nothing changed. Pinned by
  `packages/web/test/first-paint-bands.test.js`.
- **The first-paint script is the one early seam, and it stays small.** Anything
  that must beat the big bundle belongs there (brand custom hero animations,
  [#441](https://github.com/Omega-JS-Stack/omega/issues/441), ride the same
  engine and get the same early start) — weighed against that budget. It must
  never import `@omega.js/client`: the singleton drags the whole runtime into
  the bundle and rebuilds the very problem it exists to solve. The motion
  module's subpath is standalone by design, and `core/js/core/motion.js` adopts
  the running instance rather than starting a second one.
- **One lane, not two** (Ian's ruling 2026-08-26). An earlier round answered
  #585 with a second, pure-CSS entrance lane (paint-time keyframes, a 120ms
  lead-in, an `:nth-child` stagger cap, a 1s auto-resolve net, `will-change`
  staging). It put the text on screen but at a different rhythm and a different
  start moment than the reveal everywhere else — a visibly worse animation. It
  is deleted: no `omega-reveal-in` keyframe, no `--omega-reveal-wait`, no
  `html[data-omega-motion-ready]` gate, no `data-omega-reveal-lead` hook. A
  band's stagger is again the engine's job alone, from the one number its author
  writes on the cluster (`data-omega-reveal-stagger="70"` → `--omega-reveal-delay`
  per child).
- **Ambient motion waits for first paint; a mutation never reads geometry
  behind itself** ([#752](https://github.com/Omega-JS-Stack/omega/issues/752)).
  The homepage hero carries `data-omega-dotfield`, and the engine used to start
  its loop the moment it scanned: a full canvas grid repainted on every one of
  the display's frames, on the page's own thread, through the whole LCP window.
  The rules below answer it, and they are the pattern for anything ambient
  this engine grows next:
  - **The settle signal.** No measure, no style read and no paint until the
    first `requestIdleCallback` AFTER the load event (a 2s timeout, so a
    permanently busy page still gets its field), or the load event itself where
    idle callbacks do not exist. The `whenSettled(doc, fn)` helper in
    `motion.js` is the one implementation.
  - **The handoff stamp rides the first painted grid.** classy fades its CSS
    fallback dots out on `.omega-dotgrid[data-omega-dotfield-ready]::before`,
    so `data-omega-dotfield-ready` lands with the grid that replaces them and
    never at scan: stamped early it left the hero backdrop blank for the whole
    wait. The engine keeps its own re-entry set, so a rescan before the stamp
    exists still installs exactly one field.
  - **A capped cadence.** The field then repaints at 30fps, not at whatever the
    display offers: the wave crawls (~900px crest, a 20s rainbow cycle), so 30
    reads exactly like 60 and costs half the main thread, and a 120Hz display
    pays the same 30, not double. The pointer trail still eases on every frame
    (cheap), so its feel is unchanged. Under `prefers-reduced-motion` the field
    paints ONE grid, held at the start of the wave, with no loop and no pointer
    tracking; it repaints only on a resize or a `data-bs-theme` flip, and
    re-reads `--omega-line-strong` there, because the once-a-second color poll
    lives inside the loop that path does not have.
  - **The marquee measures in a later frame.** `build()` replaces the track's
    children and reads the set width one `requestAnimationFrame` later, never
    in the tick that just mutated it: that read was a forced synchronous
    reflow on every build, and a build runs on resize, on `fonts.ready` and on
    every image load in the set. A burst of those collapses to ONE measure, so
    the second never sizes the loop from a track the first just cloned.
- `prefers-reduced-motion` renders final states: reveals resolve instantly,
  count-ups show their target, rotators hold the first word, marquees park.
  EVERY continuous loop in `core/css` and in the theme sheets this package
  authors parks with them (vendored Bootstrap keeps upstream's own behavior):
  the `.animation-*` utilities (spin, pulse, pulse-right, bounce, wiggle, flex,
  shimmer), the motion library's float, marquee, and caret blink, the lazy-load
  and binding shimmers, the exit-popup wave, the studio record pulse, the
  download/extension walkthrough pointers, and the theme loops (the typing
  dots, the org-chart flow lines, the ticker pulse, the CTA rings, the
  infinite-scroll track). The one-shot fades, slides, and popups already end on
  their final state. `test/animations.test.js` derives its roster from every
  core and theme sheet that declares `infinite`, so a new unparked loop fails
  the suite.
- **Autoplaying video parks in JS, because CSS cannot pause one**
  ([#499](https://github.com/Omega-JS-Stack/omega/issues/499)). The motion
  engine's scan is the ONE lane: under `prefers-reduced-motion` it strips
  `autoplay` from every `video[autoplay]`, pauses it, and turns its controls
  on, so the poster holds and the visitor decides. It applies to every
  autoplaying band at once (the hero's video demo, `marketing/product-demo`) —
  a section never forks its own pause. Once parked, a rescan leaves a video
  the visitor started alone.
- The PurgeCSS safelist keeps every `omega-`-namespaced selector plus
  Bootstrap's own JS-toggled transition classes (`collapse`/`collapsing`/
  `show`/`showing`/`fade` — `src/assets.js`) because that state is
  runtime-stamped and never visible to the content scan. **New
  runtime-stamped classes must live in the `omega-` namespace** (or join the
  safelist explicitly).

**Classy never raises on hover** (Ian 2026-08-29,
[#686](https://github.com/Omega-JS-Stack/omega/issues/686)). Nothing travels
upward under the pointer in classy — not a button, not a card, not a tile.
Everything else a hover does stays: the warm, the ring, the shadow, the line,
the press, and the hero frame's tilt. The raise itself is SHARED css (core's
motion library serves every skin, and newsflash/neobrutalism import classy's
floor partials), so classy OPTS OUT in `themes/classy/css/base/_no-raise.scss`
— loaded last by its `_theme.scss` — and every other theme keeps its lifts.
Raises classy owns alone are gone from their own files instead. The legacy
`.hover-up` utility needs one specificity step (`html .hover-up:hover`) because
`core/css/core/_animations.scss` lands AFTER every theme, and a re-declared
hover transform carries its `prefers-reduced-motion` park with it, since a
media query adds no specificity. `test/hover-raise.test.js` compiles both the
classy and a sibling bundle, so a new raise reaching classy fails the suite.

**Every loading state carries a visible animation** (Ian 2026-08-15). Any
surface that WAITS — a poll, a fetch, a build, a webhook that has not landed —
shows an animated waiting indicator: the Bootstrap `spinner-border` idiom
(`role="status"` plus a `visually-hidden` label; `spinner-border-lg` for a
full-panel wait) for a spinner, the binding skeleton's shimmer for
placeholder content. Bare text alone is never a waiting state: with nothing
moving, a page that is working looks broken. Under `prefers-reduced-motion`
the indicator swaps to a STATIC state that still says what is happening —
park the loop (`animation: none`) and keep visible copy naming the wait
beside it, because vendored Bootstrap only slows its own spinner, so the page
rendering one owns the park (the confirmation page's
`core/css/pages/payment/confirmation/index.scss` is the reference).

## Copy register

Product copy — every string a visitor reads: layout and section copy,
section-defaults `json5`, and the JS string literals that render into the
page — **never uses em dashes**. Use a comma, a semicolon, a period, or
parentheses instead, whichever the sentence actually wants (Ian 2026-08-15).
The rule is about COPY, not about code: comments, `docs/`, frontmatter
headers, and `logger.*` messages are not rendered and are untouched, and a
bare `—` standing in as a placeholder glyph or a range separator is
typography rather than a sentence.

## classy v2 (the flagship skin)

Warm-paper light / de-blued charcoal dark; zero gradients (the only permitted
fades are alpha masks and monotone chart fills); ink primary buttons
(`.btn-adaptive` — built from `$dark`/`$light` by the shared overrides layer);
accent reserved for links, active states, focus, meters, chart series-1, and
small signals. Marketing display voice is the serif `--omega-font-marketing`
(`.omega-display`); app surfaces stay on the grotesk. The app chrome rides
`.omega-shell` with the content area drawn as one big rounded surface card
(matching margins/radii on topbar + main — the markup contract is untouched).

Structure: `_config.scss` (consumer knobs + Bootstrap forward) → `css/base`
(root bridge, typography, utilities) → `css/components`
(buttons/cards/forms/badges/dropdowns) → `css/layout`
(general/nav/footer/shell) → `css/marketing` (hero/bento/sections) →
`css/pages` (auth) → shared `../bootstrap/overrides`.

Section chrome is data-driven: `_includes/frontend/sections/{nav,footer}.html`
and the shared app chrome `_includes/global/sections/{app-sidebar,app-topbar,
page-header}.html` render JSON section data (`core/_includes/**.json`,
consumer-overridable per file). The sidebar supports an optional project
selector module (`selector:`), nested collapsible groups, badges, an ad slot
(`bottom.ad.enabled`), and the auth-bound user row; the topbar carries the
drawer/rail toggles, the breadcrumb trail (from `theme.header.breadcrumbs`),
the ⌘K search pill (`search:`), custom actions, and the account dropdown. Each
region rides its own page switch: `theme.sidebar.enabled: false` drops the rail
AND the two topbar toggles that drive it (dead buttons otherwise, naming an id
the page no longer carries,
[#740](https://github.com/Omega-JS-Stack/omega/issues/740)), and
`theme.topbar.enabled: false` drops the topbar.

## Stable-API line (don't churn once consumers exist)

Token NAMES · `_config.scss` variable names · `.omega-shell` markup contract
(which since [#319](https://github.com/Omega-JS-Stack/omega/issues/319) includes
the `__sidebar-scroll` region — hand-rolled shell markup without it gets a rail
that no longer scrolls its nav) · `_includes` section names + their JSON data
shapes · the motion attribute contract. Everything behind that line — values, partial internals, page
markup — iterates freely with the skin arc.
