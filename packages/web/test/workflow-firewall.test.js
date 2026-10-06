/**
 * The firewall step is rendered wherever a workflow is WRITTEN
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * The templates carry `{{ installFirewall }}` instead of a hand-copied
 * `SocketDev/action@vX.Y.Z` step, so the action and its pin live in ONE place
 * (`@omega.js/devkit/ci-workflows`). A brand monorepo's copy is rendered on the
 * way through composeWorkflow; a STANDALONE target's copy is written by the
 * scaffold engine, which is the path this pins: an unrendered token there is
 * not a missing step, it is a workflow file GitHub refuses to parse.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const yaml = require('js-yaml');

const { scaffoldDefaults } = require('../src/scaffold.js');

const quiet = { log() {}, warn() {}, error() {} };

let dir;
let workflow;

module.exports = defineCases({
  type: 'group',
  description: 'workflow-firewall',
  setup: () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-workflow-firewall-'));
    scaffoldDefaults({ outputDir: dir, logger: quiet });
    workflow = fs.readFileSync(path.join(dir, '.github', 'workflows', 'build.yml'), 'utf8');
  },
  cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  tests: [
    {
      name: '#872: a standalone scaffold renders the firewall token, leaving no raw token behind',
      run: (ctx) => {
        ctx.expect(!workflow.includes('{{ installFirewall }}'), 'the token was left unrendered').toBeTruthy();
        ctx.expect(workflow, 'the pinned action step is rendered').toMatch(/uses: SocketDev\/action@v\d+\.\d+\.\d+/);
        ctx.expect(workflow).toMatch(/mode: firewall-free/);
      },
    },

    {
      name: '#872: the rendered workflow is valid YAML, and the firewall precedes the install it wraps',
      run: (ctx) => {
        const steps = yaml.load(workflow).jobs.build.steps;
        const firewall = steps.findIndex((step) => String(step.uses || '').startsWith('SocketDev/action@'));
        const install = steps.findIndex((step) => /\bsfw npm (ci|install)\b/.test(String(step.run || '')));

        ctx.expect(firewall, 'the rendered step parses as a `uses:` step').not.toBe(-1);
        ctx.expect(firewall < install, 'the firewall installs before the install it wraps').toBeTruthy();
      },
    },
  ],
});
