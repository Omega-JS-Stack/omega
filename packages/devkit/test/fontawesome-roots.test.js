/**
 * fontawesome-roots — the brand icon-set supply chain (C4 cp111): a
 * OMEGA_FONTAWESOME_ROOT download dir wins, then a Pro npm install, with
 * the free set always last in the chain so partial brand sets never lose
 * icons. Pro isn't installable here (token-gated), so the pro rung is
 * covered by the env rung sharing its code path + the free fallthrough.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { resolveFontAwesomeRoots } = require('../src/icons.js');

// Pro is token-gated, so its presence depends on the machine — assertions
// adapt so the suite is green before AND after a brand installs it.
let proInstalled = false;
try {
  require.resolve('@fortawesome/fontawesome-pro/package.json');
  proInstalled = true;
} catch (e) { /* free-only machine */ }

test('no env override: Pro npm set when installed, otherwise the free floor alone', () => {
  const fa = resolveFontAwesomeRoots({});
  if (proInstalled) {
    assert.equal(fa.source, 'pro');
    assert.equal(fa.svgsDirs.length, 2);
    assert.match(fa.svgsDirs[0], /fontawesome-pro[\/\\]svgs$/);
  } else {
    assert.equal(fa.source, 'free');
    assert.equal(fa.svgsDirs.length, 1);
  }
  assert.match(fa.svgsDirs[fa.svgsDirs.length - 1], /@fortawesome[\/\\]fontawesome-free[\/\\]svgs$/);
  assert.match(fa.aliasFile, /metadata[\/\\]icon-families\.json$/);
});

test('OMEGA_FONTAWESOME_ROOT with svgs/ wins; every lower rung stays in the chain', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fa-'));
  fs.mkdirSync(path.join(root, 'svgs', 'solid'), { recursive: true });
  fs.mkdirSync(path.join(root, 'metadata'), { recursive: true });
  fs.writeFileSync(path.join(root, 'metadata', 'icon-families.json'), '{}');

  const fa = resolveFontAwesomeRoots({ OMEGA_FONTAWESOME_ROOT: root });
  assert.equal(fa.source, 'env');
  assert.equal(fa.svgsDirs[0], path.join(root, 'svgs'));
  assert.equal(fa.svgsDirs.length, proInstalled ? 3 : 2);
  assert.match(fa.svgsDirs[fa.svgsDirs.length - 1], /fontawesome-free[\/\\]svgs$/);
  assert.equal(fa.aliasFile, path.join(root, 'metadata', 'icon-families.json'));

  fs.rmSync(root, { recursive: true, force: true });
});

test('a brand set without metadata falls back to the next rung\'s alias file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fa-'));
  fs.mkdirSync(path.join(root, 'svgs', 'solid'), { recursive: true });

  const fa = resolveFontAwesomeRoots({ OMEGA_FONTAWESOME_ROOT: root });
  assert.equal(fa.source, 'env');
  assert.ok(!fa.aliasFile.startsWith(root));
  assert.match(fa.aliasFile, /metadata[\/\\]icon-families\.json$/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('a dir without svgs/ is a misconfiguration — ignored, chain falls through', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fa-'));

  const fa = resolveFontAwesomeRoots({ OMEGA_FONTAWESOME_ROOT: root });
  assert.notEqual(fa.source, 'env');
  assert.ok(!fa.svgsDirs.includes(path.join(root, 'svgs')));

  fs.rmSync(root, { recursive: true, force: true });
});
