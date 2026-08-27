/**
 * resolved parity repair — COLLECTIONS lane (found by content pass A, cp225;
 * rescoped 2026-07-19 when consumer PAGE frontmatter went meta-only): a
 * content ENTRY (_alternatives/_posts/_team doc) owns its keys against its
 * layout's defaults, and Eleventy's cascade merge breaks that contract — it
 * CONCATS a doc array onto a layout-default array and lets a layout-default
 * object beat a doc scalar. The engine re-applies the doc's own frontmatter
 * over the cascade with the shared deepMerge. Pinned against the real classy
 * alternative layout (arrays, object kill switch, partial-object override)
 * through a real build. The PAGE side of frontmatter is enforcement, not
 * merge — frontmatter-guard.test.js owns that.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

test('collection doc beats layout defaults: arrays replace, false kills, partials keep siblings', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-resolved-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, '_alternatives'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, '_alternatives', 'competitorx.md'), [
    '---',
    'layout: blueprint/alternatives/alternative',
    'alternative:',
    '',
    '  # Partial object override — the layout hero defaults must survive as',
    '  # siblings and liquify against the doc-owned competitor name.',
    '  competitor:',
    '    name: "CompetitorX"',
    '',
    '  # Array override — these TWO items must be the whole why-switch list.',
    '  why_switch:',
    '    items:',
    '      - title: "Doc reason one for {{ resolved.config.brand.name }}"',
    '        description: "First"',
    '      - title: "Doc reason two"',
    '        description: "Second"',
    '',
    '  # Scalar kill switch over an object default.',
    '  testimonials: false',
    '---',
  ].join('\n'));

  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'resolved-wins');
    const page = pages.get('/alternatives/competitorx');
    assert.ok(page, 'alternative doc built (guard never touches collection entries)');

    // Partial object override keeps layout siblings + liquifies with doc data
    assert.ok(page.includes(`Looking for a CompetitorX alternative? See why thousands of users choose ${bareData.brand.name}`),
      'layout hero.description default survives the partial competitor override and liquifies with the doc name');
    assert.ok(page.includes('CompetitorX'), 'doc competitor name wins');

    // Arrays REPLACE — the doc's two reasons, and NONE of the layout's three
    assert.ok(page.includes('Doc reason two'), 'doc why-switch items render');
    assert.ok(page.includes(`Doc reason one for ${bareData.brand.name}`), 'doc items liquify against the config scope');
    assert.ok(!page.includes('10x faster performance'), 'layout default why-switch items are GONE (no concat)');
    assert.ok(!page.includes('AI that actually works'), 'no concatenated leftovers');

    // Scalar false kills the layout's object default
    assert.ok(!page.includes('night and day'), 'testimonials: false kills the testimonial band');

    // Untouched keys keep full layout defaults (comparison/video self-skip on
    // their empty defaults — the FAQ band is the always-on default surface)
    assert.ok(page.includes(`Everything you need to know about switching from CompetitorX to ${bareData.brand.name}`),
      'faq subheadline untouched by the doc keeps layout defaults and liquifies');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
