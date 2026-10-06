/**
 * migrateTarget: the web leg of the brand root's `omega migrate`, the report
 * as `{ due, changed, errors }` lines. Report mode writes nothing, `execute`
 * writes, and what only a human can port stays due either way.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { migrateTarget } = require('../src/migrate/index.js');
const { stageLegacyConsumer } = require('./lib/migrate-fixtures.js');

module.exports = defineCases({
  type: 'group',
  description: 'migrate-target',
  tests: [
    {
      name: 'migrateTarget: report mode lists every pending legacy shape as a due line and writes nothing (#885)',
      run: (ctx) => {
        const root = stageLegacyConsumer();
        try {
          const result = migrateTarget(root);

          ctx.expect(result.changed, 'report mode changes nothing').toEqual([]);
          ctx.expect(result.errors).toEqual([]);
          const due = result.due.join('\n');
          ctx.expect(due, 'the config conversion').toMatch(/convert src\/_config\.yml \+ config\/ultimate-jekyll-manager\.json into config\/omega\.json5/);
          ctx.expect(due, 'a codemod file, with its rules').toMatch(/rewrite src\/pages\/index\.html: /);
          ctx.expect(due, 'a legacy file').toMatch(/^remove Gemfile$/m);
          ctx.expect(due, 'a lint finding, by file and line').toMatch(/src\/_layouts\/custom\.html:6: /);

          ctx.expect(!fs.existsSync(path.join(root, 'config', 'omega.json5')), 'no config written').toBeTruthy();
          ctx.expect(fs.existsSync(path.join(root, 'Gemfile')), 'Gemfile untouched').toBeTruthy();
          ctx.expect(fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8').includes('page.resolved'), 'templates untouched').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'migrateTarget --execute converts and names what it wrote; a second run changes nothing (#885)',
      run: (ctx) => {
        const root = stageLegacyConsumer();
        try {
          const first = migrateTarget(root, { execute: true });

          ctx.expect(first.errors).toEqual([]);
          const changed = first.changed.join('\n');
          ctx.expect(changed).toMatch(/converted src\/_config\.yml \+ config\/ultimate-jekyll-manager\.json into config\/omega\.json5/);
          ctx.expect(changed).toMatch(/rewrote src\/pages\/index\.html: /);
          ctx.expect(changed).toMatch(/^removed Gemfile$/m);
          ctx.expect(fs.existsSync(path.join(root, 'config', 'omega.json5')), 'config written').toBeTruthy();
          ctx.expect(!fs.existsSync(path.join(root, 'Gemfile')), 'Gemfile removed').toBeTruthy();
          ctx.expect(first.due.some((line) => /^src\/_layouts\/custom\.html:\d+: Jekyll-only tag/.test(line)), 'what only a human can port stays due after the write').toBeTruthy();

          const second = migrateTarget(root, { execute: true });
          ctx.expect(second.changed, 'a converted target has nothing left to write').toEqual([]);
          ctx.expect(second.errors).toEqual([]);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'migrateTarget: the by-hand findings are due lines, each naming its file and fix (#885)',
      run: (ctx) => {
        const root = stageLegacyConsumer();
        try {
          fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'legacy-site', dependencies: {} }, null, 2));
          fs.mkdirSync(path.join(root, 'src', 'assets', 'js', 'lib'), { recursive: true });
          fs.writeFileSync(path.join(root, 'src', 'assets', 'js', 'lib', 'prompt.js'), "function build() {\n  const jetpack = require('fs-jetpack');\n  return jetpack;\n}\n");
          fs.mkdirSync(path.join(root, 'test', 'build'), { recursive: true });
          fs.writeFileSync(path.join(root, 'test', 'build', 'xp-curve.js'), 'module.exports = {};\n');
          fs.mkdirSync(path.join(root, 'src', 'pages', 'dashboard'), { recursive: true });
          fs.writeFileSync(path.join(root, 'src', 'pages', 'dashboard', 'new.md'), '---\nlayout: page\nasset_path: dashboard/edit\n---\n');

          const due = migrateTarget(root).due.join('\n');

          ctx.expect(due, 'an undeclared require, with the dependency to add and never an install').toMatch(/^src\/assets\/js\/lib\/prompt\.js:2: `fs-jetpack` .*npm install fs-jetpack/m);
          ctx.expect(due, 'a legacy harness file `omega test` never discovers').toMatch(/^test\/build\/xp-curve\.js: /m);
          ctx.expect(due, 'the conversion note a brand changelog records').toMatch(/sitemap\.xml shrinks/);
          ctx.expect(due, 'the dead frontmatter key, by file and line').toMatch(/^src\/pages\/dashboard\/new\.md:3: `asset_path` is DEAD/m);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'migrateTarget: a tree with nothing to convert from is an error line, never a clean report (#885)',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-target-empty-'));
        try {
          fs.mkdirSync(path.join(root, 'src'), { recursive: true });
          const result = migrateTarget(root);
          ctx.expect(result.errors.some((line) => line.includes('no legacy configs found')), JSON.stringify(result.errors)).toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
  ],
});
