---
name: theme
description: Use when building or changing a theme or a theme override — packages/web/themes, a brand's own src/themes/<id>, a section folder under src/_sections, or the tier-1 src/assets/css/main.scss — or when the ask names theming, skins, forks, tokens, the cascade, or inherit.
user-invocable: true
---

# Theme (the OMEGA theme cascade)

A theme is a LAYER, not a folder of files you own: resolution picks a winner per file across consumer → active theme → base, and the same markup is meant to survive a theme switch. So most theme work is deciding which layer a change belongs to and which lane carries it — and the docs below already answer that. This skill routes; never re-derive a rule from the file tree.

## Where the mechanism lives

- `docs/web/sections.md` § Resolution — the whole-folder, first-match-wins order (consumer `<src>/_sections/<id>/` → active theme → base), the one `inherit` exception for the `js`/`scss` lanes, and why html and json5 are never inheritable.
- `docs/web/sections.md` § "Markup convention: base, skin, fork" — what base owns, what a skin may not fork, the theme-prefixed BEM rule, and the three-rung theme ladder.
- `docs/shared/theming.md` — the `--omega-*` token contract and the surface tiers, the motion library, the two consumer tiers (tier 1 the consumer `main.scss`, tier 2 a consumer-local full theme at `<src>/themes/<id>` that beats the packaged one), and the two blessed CSS fall-through lanes.
- `docs/web/classy-v2/DIRECTION.md` — the LOCKED classy spec. Where it and a comp disagree, the file wins.
- `docs/web/index.md` — the guide for everything else the theme rides: the asset lanes, the layered `_layouts`, the CLI.
- The code the docs describe: `packages/web/src/layers.js` (`resolveThemeLayers`), `packages/web/src/overrides.js` (`overrideLanes` — the sections/includes/css lanes), `packages/web/themes/`.

## The checklist

1. **The change lands in the LOWEST layer that owns it.** Structure is base's; look is the skin's; identity is a bounded fork. A skin that forks shared markup to restyle it is the finding — `docs/web/sections.md` § Markup convention.
2. **A fork is declared.** Each skin theme's README carries a `## Forks` section whose bullets name its markup files, and the list must equal what is on disk in both directions — pinned by `packages/web/test/theme-convention.test.js`, which also polices the class prefixes.
3. **Classes follow the convention.** `omega-*` BEM everywhere, `<theme>-*` BEM only inside that theme's own forks; a bare class needs the allowlist entry the same test reads.
4. **Color, spacing, radii, and speeds come from the tokens**, never from a literal — `docs/shared/theming.md` names the token families and the light/dark pairing rule.
5. **An override folder is whole.** Taking a section means taking its folder; a lone `section.scss` does nothing. The one exception is a json5 `inherit: ['js']` / `['scss']` declaration, which also makes the inherited js's selectors part of your markup contract — `docs/web/sections.md` § Resolution.
6. **The override map is a command, not a directory read.** `npx omega customize --list` prints every shadowable file with its owning layer and your existing shadows; `npx omega customize <path>` materializes one with its provenance header. Reading the theme source tree to guess a path is not the mechanism.
7. **A consumer's theme work picks its tier deliberately.** Recolor and Sass knobs are tier 1 (`src/assets/css/main.scss`, `omega:main`); a full brand theme is tier 2 (`src/themes/<id>`). A fork of the framework's own themes is neither.
8. **Upstream-first.** A hole found while theming a brand is fixed in the framework, not patched in the consumer — the rule and its limits are in `docs/shared/local-dev.md`.

## Verifying

Read the BUILT output, not the source layer: `omega build` in the app, then check that the winning file is the one you meant (`npx omega customize --list` names the layer it resolved from) and that the compiled sheet carries your rules. The framework's own cascade guards are `packages/web/test/themes.test.js`, `overrides.test.js`, `customize.test.js`, and `theme-convention.test.js` — a theme change that does not keep those green has moved a contract, not a style.
