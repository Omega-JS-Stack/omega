/**
 * marketing/bento — the closing CTA and the two superheadline shapes (#439).
 *
 * Migrating a legacy "features" band onto the bento found two contract gaps:
 * the band's closing CTA had no home (it warned as unknown), and the eyebrow
 * took a plain string only, so a legacy `{ icon, text }` lost its icon in the
 * flatten. Pins: cta_button renders in the sibling button idiom and honors
 * the same `enabled` gate hero's secondary button uses, the string eyebrow is
 * untouched, and the object shape renders icon + text.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit');
const { resolveFontAwesomeRoots } = require('@omega.js/devkit/icons');

const { registerSectionTags } = require('../src/sections.js');

const PKG = path.resolve(__dirname, '..');
const BASE = path.join(PKG, 'themes', 'base');
const CORE_ICONS = path.join(PKG, 'core', 'icons');

/** Fresh engine over the real base layer, wired like src/engine.js does. */
function makeEngine() {
  const warnings = [];
  const engine = new Liquid();
  const fa = resolveFontAwesomeRoots();
  registerSectionTags(engine, { baseDirs: [BASE], warn: (message) => warnings.push(message) });
  registerLiquid(engine, {
    icons: {
      fontAwesomeDirs: [CORE_ICONS, ...fa.svgsDirs],
      aliasFile: fa.aliasFile,
      flagsDir: path.join(CORE_ICONS, 'flags'),
      style: 'solid',
    },
  });
  return { engine, warnings };
}

const ITEMS = 'items:\n  - type: default\n    icon: bolt\n    title: "Fast by default"\n    description: "Static output, tuned assets."\n';

test('#439: cta_button renders the closing CTA in the sibling button idiom, warn-free', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    `{% section "marketing/bento" %}\n${ITEMS}cta_button:\n  text: "See every feature"\n  href: "/features"\n{% endsection %}`,
    {},
  );

  assert.ok(html.includes('<a href="/features" class="btn btn-adaptive btn-lg omega-hover-nudge">'), 'the shared closing-CTA button idiom');
  assert.ok(html.includes('See every feature'), 'the button is named by its own copy');
  assert.ok(html.includes('<span class="omega-nudge ms-2"><i class="fa fa-sm" data-icon="arrow-right">'), 'the arrow nudge rides along');
  assert.deepEqual(warnings, [], 'the ported CTA no longer warns as unknown');
});

test('#439: cta_button honors the enabled gate, and absence renders no button at all', async () => {
  const { engine, warnings } = makeEngine();

  const disabled = await engine.parseAndRender(
    `{% section "marketing/bento" %}\n${ITEMS}cta_button:\n  enabled: false\n  text: "See every feature"\n  href: "/features"\n{% endsection %}`,
    {},
  );
  assert.ok(!disabled.includes('See every feature'), 'enabled: false suppresses the CTA');
  assert.ok(!disabled.includes('omega-hover-nudge'), 'no orphan button shell');

  const none = await engine.parseAndRender(`{% section "marketing/bento" %}\n${ITEMS}{% endsection %}`, {});
  assert.ok(!none.includes('omega-hover-nudge'), 'no cta_button → no closing CTA');
  assert.deepEqual(warnings, []);
});

test('#439: superheadline takes BOTH shapes — the string unchanged, { icon, text } renders the icon', async () => {
  const { engine, warnings } = makeEngine();

  const plain = await engine.parseAndRender(
    `{% section "marketing/bento" %}\nsuperheadline: "Why ACME"\n${ITEMS}{% endsection %}`,
    {},
  );
  assert.ok(plain.includes('<span class="omega-micro">Why ACME</span>'), 'the string form renders exactly as before');

  const object = await engine.parseAndRender(
    `{% section "marketing/bento" %}\nsuperheadline:\n  icon: "bolt"\n  text: "Why ACME"\n${ITEMS}{% endsection %}`,
    {},
  );
  assert.ok(object.includes('<i class="fa me-1" data-icon="bolt">'), 'the icon rides the shared omega_icon mechanism');
  assert.ok(/<span class="omega-micro"><i class="fa me-1" data-icon="bolt">[\s\S]*?<\/i>Why ACME<\/span>/.test(object), 'icon then text, one label');
  assert.ok(/<svg[^>]*aria-hidden="true"/.test(object), 'the eyebrow icon is decorative — the label carries the words');
  assert.ok(!object.includes('[object Object]'), 'never the raw object');
  assert.deepEqual(warnings, [], 'the object shape carries no type warning');
});
