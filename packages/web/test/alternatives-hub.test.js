/**
 * The alternatives hub prints each competitor's authored description (#563).
 *
 * Found by the optiic blind verify: every `_alternatives/*.md` authors
 * `alternative.competitor.description`, the UJM hub printed it under each row
 * title, and the OMEGA hub emitted only "<brand> vs <competitor>" plus the
 * "View comparison" link — brand-authored copy with no destination, silently,
 * on every brand with an alternatives collection.
 *
 * Built from a BARE consumer carrying two alternatives, one with a description
 * and one without, so the assertions read the framework's own markup and both
 * shapes come off ONE build.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

/** One alternative doc's source. */
const alternative = (name, description) => [
  '---',
  'layout: blueprint/alternatives/alternative',
  'alternative:',
  '  competitor:',
  `    name: "${name}"`,
  ...(description ? [`    description: "${description}"`] : []),
  '---',
].join('\n');

let hub;
before(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-alternatives-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, '_alternatives'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, '_alternatives', 'described.md'), alternative('Described', 'The incumbent everyone starts on.'));
  fs.writeFileSync(path.join(consumerDir, '_alternatives', 'nodesc.md'), alternative('Nodesc'));

  try {
    const pages = await buildSite(consumerDir, bareData, {}, 'alternatives-hub');
    hub = pages.get('/alternatives');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#563: the row prints the competitor description under its title', () => {
  assert.ok(hub, 'the hub built');
  assert.ok(hub.includes(`${bareData.brand.name} vs Described`), 'the row title is unchanged');
  assert.ok(hub.includes('The incumbent everyone starts on.'), 'and the authored description has somewhere to land');

  // Under the TITLE, inside the row's first cell — not in the meta cell that
  // carries the "View comparison" link.
  const row = hub.slice(hub.indexOf(`${bareData.brand.name} vs Described`));
  assert.ok(/vs Described<\/span>\s*<span class="omega-rowlist__desc">\s*The incumbent everyone starts on\.\s*<\/span>/.test(row),
    'the description follows the title in its own element');
  assert.ok(row.indexOf('The incumbent everyone starts on.') < row.indexOf('omega-rowlist__meta'), 'and precedes the comparison link');
});

test('#563: a competitor with no description renders the row exactly as before', () => {
  // The description is BRAND copy, not framework copy: absent, nothing is
  // invented and no empty element ships.
  const row = hub.slice(hub.indexOf(`${bareData.brand.name} vs Nodesc`));

  assert.ok(hub.includes(`${bareData.brand.name} vs Nodesc`), 'the row still renders');
  assert.ok(row.indexOf('omega-rowlist__desc') === -1 || row.indexOf('omega-rowlist__desc') > row.indexOf('omega-rowlist__meta'),
    'no empty description element between the title and the comparison link');
});
