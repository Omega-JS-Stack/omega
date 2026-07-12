# Bootstrap JS & Tooltips

@omega.js/desktop ships **Bootstrap's JavaScript** (v5.3, Popper inlined) as a prebuilt bundle
— `assets/js/bootstrap.bundle.js` — loaded by the renderer
bootstrap. Consumers add **zero setup** and never vendor Bootstrap JS
themselves.

## Tooltips (auto-initialized)

Bootstrap makes tooltips opt-in (they need a JS instance per element); @omega.js/desktop does
the opt-in for you. Any element carrying the standard Bootstrap markup gets a
live tooltip:

```html
<button class="btn btn-primary" data-bs-toggle="tooltip" data-bs-title="Saves and continues">
  Save
</button>
```

The renderer bootstrap (`renderer.js _wireTooltips`) initializes every
`[data-bs-toggle="tooltip"]` present at init and watches the DOM:

- elements **inserted later** get their tooltip on arrival,
- **`data-bs-title` / `title` changes** update the live instance in place
  (emptying the title disposes it — no tooltip is a valid state),
- **removed elements** have their instance disposed — no orphaned tips.

Plain-`title` hosts work: Bootstrap's constructor MOVES `title` into
`data-bs-original-title`, and the observer reads that bookkeeping as a live
title source. (It must — reading only `title`/`data-bs-title` made the
observer dispose the instance, dispose restored `title`, re-init removed it
again: an infinite MutationObserver microtask loop that froze the whole
renderer. Found by Somiibo's session-limits boot suite; regression-tested in
the tooltips suite.) One knock-on: a title-only host can't be disposed by
emptying its title — remove `data-bs-toggle` instead (prefer `data-bs-title`
for dynamic tooltips).

All the standard Bootstrap `data-bs-*` options work (`data-bs-placement`,
`data-bs-delay`, …).

### Disabled controls

Bootstrap's own caveat: disabled elements don't fire hover events. Wrap the
control and put the tooltip on the wrapper:

```html
<span data-bs-toggle="tooltip" data-bs-title="Requires the Pro plan">
  <button class="btn btn-primary" disabled>Bulk import</button>
</span>
```

## The rest of Bootstrap's JS

The full namespace is exposed at **`window.bootstrap`** (and
`manager.bootstrap`) — `Tooltip`, `Popover`, `Collapse`, `Dropdown`, `Modal`,
`Offcanvas`, `Tab`, `Toast`, `Alert`, `Button`, `Carousel`, `ScrollSpy`. Only
tooltips are auto-initialized; the other components' standard **data-api**
works out of the box on plain Bootstrap markup (e.g.
`data-bs-toggle="collapse"`), and everything is available for manual control:

```js
const collapse = window.bootstrap.Collapse.getOrCreateInstance(el);
collapse.show();
```

## Rebuilding the bundle

The bundle is built from @omega.js/desktop's vendored Bootstrap source
(`the Bootstrap 5.3 source (vendored themes tree)`, v5.3.x) plus `@popperjs/core` (an @omega.js/desktop
dependency), webpack production mode, UMD output
(`library: { name: 'bootstrap', export: 'default' }`). Rebuild only when the
vendored Bootstrap source is upgraded.

Note: the bundle reads `document.documentElement` at import time — the renderer
bootstrap defers loading it until the document exists (relevant when wiring
runs from a preload, e.g. the test harness).

## Testing

- `src/test/suites/renderer/tooltips.test.js` — bundle loads, auto-init on
  insertion, live retitle, dispose-on-removal, tip cleanup. (The harness wires
  the renderer Manager in the preload world — see the suite header for the
  world-split notes; single-world hover behavior is covered by consumer boot
  suites.)
