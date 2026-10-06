/**
 * migrateTarget inside a brand: the brand root's config/omega.json5 is the one
 * home of the conversion: it merges into the root, an existing root value
 * winning, and the web-only sections land under `targets.<folder name>`. A
 * target's own config/omega.json5 is its override layer: never read or written.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const JSON5 = require('json5');
const { loadConfig } = require('@omega.js/config');
const { migrateTarget } = require('../src/migrate/index.js');
const { convertConfig } = require('../src/migrate/config-convert.js');
const { mergeIntoBrand } = require('../src/migrate/brand-config.js');
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

module.exports = defineCases({
  type: 'group',
  description: 'migrate-brand',
  tests: [
    {
      name: 'migrateTarget in a brand: report mode lists the merge into the root, key by key, and writes nothing',
      run: (ctx) => {
        const { brand, site, rootFile, ownFile } = stageBrandSite();
        try {
          const result = migrateTarget(site, { brandRoot: brand, name: 'site' });

          ctx.expect(result.errors).toEqual([]);
          ctx.expect(result.changed, 'report mode changes nothing').toEqual([]);
          const due = result.due.join('\n');
          ctx.expect(due).toMatch(/^convert src\/_config\.yml \+ config\/ultimate-jekyll-manager\.json into the brand root config\/omega\.json5$/m);
          ctx.expect(due, 'a missing shared section is added').toMatch(/^add socials to the brand root config\/omega\.json5 \(from src\/_config\.yml/m);
          ctx.expect(due, 'the web-only sections go under the real folder name').toMatch(/^add targets\.site\.client to the brand root config\/omega\.json5/m);
          ctx.expect(due, 'the root value wins and is named').toMatch(/^keep brand\.id = "realbrand" in the brand root config\/omega\.json5 over "sample"/m);
          ctx.expect(due, 'never a hard-coded web key').not.toMatch(/targets\.web\b/);
          ctx.expect(due, 'the config-value rewrite names the root file one way').toMatch(/^rewrite the brand root config\/omega\.json5: config-reads/m);
          ctx.expect(due, 'never as a path relative to the target').not.toMatch(/\.\.\//);

          ctx.expect(fs.readFileSync(rootFile, 'utf8'), 'the root config untouched').toBe(ROOT_CONFIG);
          ctx.expect(!fs.existsSync(ownFile), 'no target-level config written').toBeTruthy();
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'migrateTarget in a brand --execute: the root gains the missing keys and targets.site, the target gets no config',
      run: (ctx) => {
        const { brand, site, rootFile, ownFile } = stageBrandSite();
        try {
          const result = migrateTarget(site, { execute: true, brandRoot: brand, name: 'site' });

          ctx.expect(result.errors).toEqual([]);
          ctx.expect(!fs.existsSync(ownFile), 'nothing written under the target').toBeTruthy();

          const root = readRoot(brand);
          ctx.expect(root.brand.id, 'an existing root value wins').toBe('realbrand');
          ctx.expect(root.brand.name).toBe('Real Brand');
          ctx.expect(root.socials, 'a missing shared section is added').toEqual(LEGACY_JEKYLL.socials);
          ctx.expect(root.cloud.config.projectId).toBe('sample-test');
          ctx.expect(root.targets.site.type).toBe('web');
          ctx.expect(root.targets.site.client.auth.enabled, 'the web-only client blob lands under targets.site').toBe(true);
          ctx.expect(root.targets.site.purgecss).toEqual(LEGACY_UJM.sass.purgecss);
          ctx.expect(root.targets.web, 'no phantom web target').toBe(undefined);
          ctx.expect(root.targets.api.type, 'the other targets survive').toBe('backend');
          ctx.expect(fs.readFileSync(rootFile, 'utf8').includes('// The real brand: every target resolves this id'), 'the root keeps its comments').toBeTruthy();

          const changed = result.changed.join('\n');
          ctx.expect(changed).toMatch(/^converted src\/_config\.yml \+ config\/ultimate-jekyll-manager\.json into the brand root config\/omega\.json5$/m);
          ctx.expect(changed).toMatch(/^added targets\.site\.client to the brand root config\/omega\.json5/m);
          ctx.expect(result.due.join('\n'), 'a kept key stays a line to confirm').toMatch(/^kept brand\.id = "realbrand" in the brand root config\/omega\.json5 over "sample"/m);

          const web = loadConfig(site, 'web');
          ctx.expect(web.errors, 'the merged root loads clean for the site target').toEqual([]);
          ctx.expect(web.config.brand.id).toBe('realbrand');
          ctx.expect(web.config.client.auth.enabled, 'the web-only sections reach the site target').toBe(true);
          ctx.expect(loadConfig(path.join(brand, 'targets', 'api'), 'backend').config.brand.id, 'one brand id on every target').toBe('realbrand');

          const second = migrateTarget(site, { execute: true, brandRoot: brand, name: 'site' });
          ctx.expect(second.changed, 'a converted target has nothing left to write').toEqual([]);
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'migrateTarget in a brand: a hand-written target-level config is that target\'s override layer, left byte for byte',
      run: (ctx) => {
        const { brand, site, ownFile } = stageBrandSite();
        try {
          const own = "{\n  // Overrides the brand layer for this app only\n  brand: { url: 'https://site-only.test' },\n  socials: { twitter: 'site-handle' },\n}\n";
          fs.writeFileSync(ownFile, own);

          const result = migrateTarget(site, { execute: true, brandRoot: brand, name: 'site' });

          ctx.expect(result.errors).toEqual([]);
          ctx.expect([...result.due, ...result.changed].join('\n'), 'the leg never reads it').not.toMatch(/site-only|site-handle/);
          ctx.expect(fs.readFileSync(ownFile, 'utf8'), 'the override file survives byte for byte').toBe(own);
          ctx.expect(readRoot(brand).socials.twitter, 'the conversion still lands in the root').toBe('sample');

          const web = loadConfig(site, 'web').config;
          const backend = loadConfig(path.join(brand, 'targets', 'api'), 'backend').config;
          ctx.expect(web.socials.twitter, 'it still overrides for site').toBe('site-handle');
          ctx.expect(web.brand.url).toBe('https://site-only.test');
          ctx.expect(backend.socials.twitter, 'the backend never sees the site override').toBe('sample');
          ctx.expect(backend.brand.url).toBe('https://realbrand.test');
          ctx.expect(web.brand.id, 'and both still resolve one brand id').toBe('realbrand');
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'migrateTarget outside a brand (no brandRoot) still writes its own config/omega.json5',
      run: (ctx) => {
        const root = stageLegacyConsumer();
        try {
          const result = migrateTarget(root, { execute: true });

          ctx.expect(result.changed.join('\n')).toMatch(/^converted src\/_config\.yml \+ config\/ultimate-jekyll-manager\.json into config\/omega\.json5$/m);
          const own = JSON5.parse(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8'));
          ctx.expect(own.brand.id).toBe('sample');
          ctx.expect(own.targets.web.type, 'a standalone project is its own web target').toBe('web');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'convertConfig drops an undeclared key inside a list item from that item, every item kept (#1056)',
      run: (ctx) => {
        const jekyll = structuredClone(LEGACY_JEKYLL);
        jekyll.seo = { github: { content: [{ name: 'tool', org: 'Acme-Org' }, { name: 'other' }] } };

        const { omega, notes } = convertConfig({ jekyll, ujm: null });

        ctx.expect(omega.targets.web.seo.github.content).toEqual([{ name: 'tool' }, { name: 'other' }]);
        ctx.expect(notes.includes('`targets.web.seo.github.content[0].org` dropped: no omega.json5 key reads it; carry the setting by hand if it still matters'), notes.join(' | ')).toBeTruthy();
      },
    },

    {
      name: 'mergeIntoBrand refuses a shared path inside a list item by name, since part of an item cannot move under the target (#1056)',
      run: (ctx) => {
        const { brand, rootFile } = stageBrandSite();
        try {
          const converted = { brand: { id: 'realbrand', name: 'Real Brand' }, seo: { github: { content: [{ name: 'tool', org: 'Acme-Org' }] } }, targets: { site: { type: 'web' } } };

          ctx.expect(() => mergeIntoBrand(rootFile, { name: 'site', converted, execute: false })).toThrow(/^seo\.github\.content\[0\]\.org sits inside a list item/);
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
  ],
});
