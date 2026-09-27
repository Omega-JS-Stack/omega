/**
 * migrateTarget inside a brand: the brand root's config/omega.json5 is the one
 * home of the conversion: it merges into the root, an existing root value
 * winning, and the web-only sections land under `targets.<folder name>`. A
 * target's own config/omega.json5 is its override layer: never read or written.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const JSON5 = require('json5');
const { loadConfig } = require('@omega.js/config');
const { migrateTarget } = require('../src/migrate/index.js');
const { LEGACY_JEKYLL, LEGACY_UJM, stageLegacyConsumer } = require('./lib/migrate-fixtures.js');

const ROOT_CONFIG = [
  '{',
  '  // The real brand: every target resolves this id',
  "  brand: { id: 'realbrand', name: 'Real Brand', url: 'https://realbrand.test' },",
  '',
  '  targets: {',
  "    site: { type: 'web' },",
  "    api: { type: 'backend' },",
  '  },',
  '}',
  '',
].join('\n');

/** A brand root carrying ROOT_CONFIG, with the legacy UJM consumer at targets/site. */
function stageBrandSite() {
  const brand = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-brand-')));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), ROOT_CONFIG);
  fs.mkdirSync(path.join(brand, 'targets', 'api'), { recursive: true });

  const site = path.join(brand, 'targets', 'site');
  fs.renameSync(stageLegacyConsumer(), site);
  return { brand, site, rootFile: path.join(brand, 'config', 'omega.json5'), ownFile: path.join(site, 'config', 'omega.json5') };
}

const readRoot = (brand) => JSON5.parse(fs.readFileSync(path.join(brand, 'config', 'omega.json5'), 'utf8'));

test('migrateTarget in a brand: report mode lists the merge into the root, key by key, and writes nothing', () => {
  const { brand, site, rootFile, ownFile } = stageBrandSite();
  try {
    const result = migrateTarget(site, { brandRoot: brand, name: 'site' });

    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.changed, [], 'report mode changes nothing');
    const due = result.due.join('\n');
    assert.match(due, /^convert src\/_config\.yml \+ config\/ultimate-jekyll-manager\.json into the brand root config\/omega\.json5$/m);
    assert.match(due, /^add socials to the brand root config\/omega\.json5 \(from src\/_config\.yml/m, 'a missing shared section is added');
    assert.match(due, /^add targets\.site\.client to the brand root config\/omega\.json5/m, 'the web-only sections go under the real folder name');
    assert.match(due, /^keep brand\.id = "realbrand" in the brand root config\/omega\.json5 over "sample"/m, 'the root value wins and is named');
    assert.doesNotMatch(due, /targets\.web\b/, 'never a hard-coded web key');
    assert.match(due, /^rewrite the brand root config\/omega\.json5: config-reads/m, 'the config-value rewrite names the root file one way');
    assert.doesNotMatch(due, /\.\.\//, 'never as a path relative to the target');

    assert.strictEqual(fs.readFileSync(rootFile, 'utf8'), ROOT_CONFIG, 'the root config untouched');
    assert.ok(!fs.existsSync(ownFile), 'no target-level config written');
  } finally {
    fs.rmSync(brand, { recursive: true, force: true });
  }
});

test('migrateTarget in a brand --execute: the root gains the missing keys and targets.site, the target gets no config', () => {
  const { brand, site, rootFile, ownFile } = stageBrandSite();
  try {
    const result = migrateTarget(site, { execute: true, brandRoot: brand, name: 'site' });

    assert.deepStrictEqual(result.errors, []);
    assert.ok(!fs.existsSync(ownFile), 'nothing written under the target');

    const root = readRoot(brand);
    assert.strictEqual(root.brand.id, 'realbrand', 'an existing root value wins');
    assert.strictEqual(root.brand.name, 'Real Brand');
    assert.deepStrictEqual(root.socials, LEGACY_JEKYLL.socials, 'a missing shared section is added');
    assert.strictEqual(root.cloud.config.projectId, 'sample-test');
    assert.strictEqual(root.targets.site.type, 'web');
    assert.strictEqual(root.targets.site.client.auth.enabled, true, 'the web-only client blob lands under targets.site');
    assert.deepStrictEqual(root.targets.site.purgecss, LEGACY_UJM.sass.purgecss);
    assert.strictEqual(root.targets.web, undefined, 'no phantom web target');
    assert.strictEqual(root.targets.api.type, 'backend', 'the other targets survive');
    assert.ok(fs.readFileSync(rootFile, 'utf8').includes('// The real brand: every target resolves this id'), 'the root keeps its comments');

    const changed = result.changed.join('\n');
    assert.match(changed, /^converted src\/_config\.yml \+ config\/ultimate-jekyll-manager\.json into the brand root config\/omega\.json5$/m);
    assert.match(changed, /^added targets\.site\.client to the brand root config\/omega\.json5/m);
    assert.match(result.due.join('\n'), /^kept brand\.id = "realbrand" in the brand root config\/omega\.json5 over "sample"/m, 'a kept key stays a line to confirm');

    const web = loadConfig(site, 'web');
    assert.deepStrictEqual(web.errors, [], 'the merged root loads clean for the site target');
    assert.strictEqual(web.config.brand.id, 'realbrand');
    assert.strictEqual(web.config.client.auth.enabled, true, 'the web-only sections reach the site target');
    assert.strictEqual(loadConfig(path.join(brand, 'targets', 'api'), 'backend').config.brand.id, 'realbrand', 'one brand id on every target');

    const second = migrateTarget(site, { execute: true, brandRoot: brand, name: 'site' });
    assert.deepStrictEqual(second.changed, [], 'a converted target has nothing left to write');
  } finally {
    fs.rmSync(brand, { recursive: true, force: true });
  }
});

test('migrateTarget in a brand: a hand-written target-level config is that target\'s override layer, left byte for byte', () => {
  const { brand, site, ownFile } = stageBrandSite();
  try {
    const own = "{\n  // Overrides the brand layer for this app only\n  brand: { url: 'https://site-only.test' },\n  socials: { twitter: 'site-handle' },\n}\n";
    fs.writeFileSync(ownFile, own);

    const result = migrateTarget(site, { execute: true, brandRoot: brand, name: 'site' });

    assert.deepStrictEqual(result.errors, []);
    assert.doesNotMatch([...result.due, ...result.changed].join('\n'), /site-only|site-handle/, 'the leg never reads it');
    assert.strictEqual(fs.readFileSync(ownFile, 'utf8'), own, 'the override file survives byte for byte');
    assert.strictEqual(readRoot(brand).socials.twitter, 'sample', 'the conversion still lands in the root');

    const web = loadConfig(site, 'web').config;
    const backend = loadConfig(path.join(brand, 'targets', 'api'), 'backend').config;
    assert.strictEqual(web.socials.twitter, 'site-handle', 'it still overrides for site');
    assert.strictEqual(web.brand.url, 'https://site-only.test');
    assert.strictEqual(backend.socials.twitter, 'sample', 'the backend never sees the site override');
    assert.strictEqual(backend.brand.url, 'https://realbrand.test');
    assert.strictEqual(web.brand.id, 'realbrand', 'and both still resolve one brand id');
  } finally {
    fs.rmSync(brand, { recursive: true, force: true });
  }
});

test('migrateTarget outside a brand (no brandRoot) still writes its own config/omega.json5', () => {
  const root = stageLegacyConsumer();
  try {
    const result = migrateTarget(root, { execute: true });

    assert.match(result.changed.join('\n'), /^converted src\/_config\.yml \+ config\/ultimate-jekyll-manager\.json into config\/omega\.json5$/m);
    const own = JSON5.parse(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8'));
    assert.strictEqual(own.brand.id, 'sample');
    assert.strictEqual(own.targets.web.type, 'web', 'a standalone project is its own web target');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
