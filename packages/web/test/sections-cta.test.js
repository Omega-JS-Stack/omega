/**
 * marketing/cta — the family `enabled` gate (#473).
 *
 * Every other band in the family gained a gate; the ink CTA never did, and the
 * base index layout composed it unconditionally. A page with no CTA of its own
 * therefore had two options: ship the framework's default words, or blank the
 * copy and ship an empty ink panel. Pins: `enabled: false` removes the band
 * entirely (section level AND through the index layout that composes it), and
 * an absent `enabled` keeps today's default exactly.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit');
const { resolveFontAwesomeRoots } = require('@omega.js/devkit/icons');

const { registerSectionTags } = require('../src/sections.js');
const { buildSite, miniData, BARE } = require('./lib/build.js');

const PKG = path.resolve(__dirname, '..');
const BASE = path.join(PKG, 'themes', 'base');
const CORE_ICONS = path.join(PKG, 'core', 'icons');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

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

const COPY = 'headline: "Ready to ship"\nsubheadline: "Start free today."\nprimary_button:\n  text: "Start free"\n  href: "/signup"\n';

test('#473: enabled: false removes the band entirely', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(`{% section "marketing/cta" %}\nenabled: false\n${COPY}{% endsection %}`, {});

  assert.strictEqual(html.trim(), '', 'no band, no panel, no empty section shell');
  assert.deepEqual(warnings, [], 'the gate is a declared arg, not an unknown one');
});

test('#473: an absent enabled keeps today\'s default — the band renders whole', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(`{% section "marketing/cta" %}\n${COPY}{% endsection %}`, {});

  assert.ok(html.includes('class="omega-cta omega-ink-panel"'), 'the ink panel renders as before');
  assert.ok(html.includes('Ready to ship'), 'with its copy');
  assert.ok(html.includes('href="/signup"'), 'and its button');
  assert.deepEqual(warnings, []);
});

test('#473: the base index layout composes the band through the gate', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-cta-gate-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'src.11tydata.json'), JSON.stringify({ cta: { enabled: false } }));
  fs.writeFileSync(
    path.join(consumerDir, 'pages', 'index.md'),
    ['---', 'layout: blueprint/index', 'permalink: /', '---', ''].join('\n'),
  );

  try {
    const pages = await buildSite(consumerDir, { ...bareData, ...miniData }, {}, 'cta-gate');
    const html = pages.get('/');
    assert.ok(!html.includes('omega-cta omega-ink-panel'), 'the composed band is gone, not blanked');
    assert.ok(!html.includes('Ready to build something people remember?'), 'and so are the framework default words');
    assert.ok(html.includes('omega-bento'), 'the rest of the composition is untouched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
