---
name: accessibility
description: Use before finishing any markup, theme, section, or stylesheet change in a website app, packages/web, or a desktop/extension UI surface — or when the ask names accessibility, a11y, aria, alt text, keyboard navigation, focus, contrast, reduced motion, or WCAG.
user-invocable: true
---

# Accessibility (OMEGA front-end surfaces)

Most of this is already built into the layers — tokens carry contrast, the motion library carries the reduced-motion branch, the theme partials carry the alt attributes. New markup breaks it by hand-rolling around them, so the review is mostly checking that the mechanism was used.

## Where the mechanism lives

- `docs/shared/theming.md` — the `--omega-*` token contract (light + dark values ship together), the one-status-hue rule, the motion library and its resilience rules.
- `docs/web/sections.md` — the section/component contract: what a section owns and how its markup composes.
- `docs/shared/icons.md` — the one icon mechanism (`fa-*` markup, `omega_icon` inlining).
- `packages/web/core/css/motion/_index.scss` and `packages/web/core/css/tokens/_index.scss` — the two sheets the checks below refer to.

## The checklist

1. **Landmarks and heading order.** The document shell and blueprint layouts own `header`/`nav`/`main`/`footer` — a section never opens a second `main`. Sections start at h2 beneath the page's single h1, and levels do not skip.
2. **Every image has an `alt`.** Content images describe; decorative ones take `alt=""`. Lazy images keep it too — the theme idiom is `src="{{ site.omega.placeholder.src }}" data-lazy="@src …" alt="…"`, and the `alt` is not optional in the copy.
3. **Every control has a name.** Inputs get a real `<label>` (or `aria-label` where the design has no visible label); an icon-only button gets an `aria-label`, because an `fa-*` glyph contributes no text. Links say where they go — no bare "here".
4. **Color comes from tokens, never raw hex.** `var(--omega-*)` in markup and scss. Status meaning uses only `--omega-ok` / `--omega-warn` / `--omega-danger` (with their `-rgb` twins when a translucency utility needs them). A raw hex is both a theming break and an untested contrast.
5. **Contrast holds in BOTH modes.** Token values ship as light/dark pairs and `data-bs-theme` flips them, so a pairing checked in one mode is half-checked. Ink-on-surface and accent-on-surface are the two that bite.
6. **Focus stays visible.** Keyboard focus shows a ring — `.omega-interactive` (and `--lift`) already gives hover, `:focus-visible`, and press states. Never remove an outline without shipping a replacement, and never make a `div` the click target without a `button`/`a` or explicit role plus key handling.
7. **`prefers-reduced-motion` renders final states.** Reveals resolve instantly, count-ups show their target, rotators hold the first word, marquees park. A new animated section adds its reduced-motion branch in the same commit. The no-JS twin: reveal styles hide content only under the `html[data-omega-motion]` stamp, so a page without JS is fully visible.
8. **Copied idioms carry their accessibility.** The marquee's cloned set is `aria-hidden` with focusables detabbed (`tabindex="-1"`); a duplicated pattern that drops those halves ships duplicate content to a screen reader.

## Verifying

Check the rendered page, not the template — the `omega:browser` skill drives the running dev server: tab through the surface, read the accessibility tree, and screenshot both `data-bs-theme` values. For a whole-page pass, the same upstream runs Lighthouse.
