/**
 * Test: the shipped scaffold templates
 * ([#278](https://github.com/Omega-JS-Stack/omega/issues/278),
 * [#279](https://github.com/Omega-JS-Stack/omega/issues/279)).
 *
 * `templates/` is what setup writes into a consumer that carries no file of
 * its own, so a template's default IS the brand's default until someone edits
 * it. Two defaults are pinned here: storage denies everything (a brand that
 * serves files opts in deliberately, per-path), and the internal welcome page
 * carries its own title instead of 404.html's.
 *
 * Pure file reads — no project, no emulator.
 *
 * Run: npx omega test backend:cli/templates
 */
const fs = require('fs');
const path = require('path');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

function readTemplate(...segments) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, ...segments), 'utf8');
}

function readTitle(html) {
  const match = html.match(/<title>([^<]*)<\/title>/);

  return match ? match[1] : null;
}

module.exports = defineCases({
  description: 'Shipped templates: storage denies by default, the welcome page owns its title',
  type: 'group',
  timeout: 10000,

  tests: [
    {
      name: 'storage-rules-template-denies-by-default',
      auth: 'none',

      async run({ expect }) {
        const rules = readTemplate('storage.rules');
        const allows = rules.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('allow '));

        expect(allows.length, `the template must carry exactly one allow rule (found ${allows.length})`).toBe(1);
        expect(allows[0], `the shipped default must deny everything (found "${allows[0]}")`).toMatch(/^allow read, write:\s*if false;$/);
        expect(rules.includes('request.auth'), 'the scaffold default must not grant on authentication alone').toBe(false);
      },
    },

    {
      name: 'welcome-page-template-titles-itself',
      auth: 'none',

      async run({ expect }) {
        const index = readTemplate('public', 'index.html');
        const notFound = readTemplate('public', '404.html');

        expect(readTitle(index), 'index.html must title itself, not carry 404.html\'s title').toBe('Welcome');
        expect(index.includes('Welcome!'), 'index.html is still the internal welcome page').toBe(true);
        expect(readTitle(notFound), '404.html keeps its own title').toBe('404 Error Page');
      },
    },
  ],
});
