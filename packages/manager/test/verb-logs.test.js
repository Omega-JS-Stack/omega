/**
 * Verb log targets (#231) — the two brand-level verbs tee to their OWN file:
 * `omega manage` → logs/manage.log, `omega dev` → logs/dev.log, so booting the
 * dev stack never overwrites the record of the last service walk (both used to
 * truncate manage.log). This file pins the manage half; the dev half lives in
 * dev.test.js, which owns the spawn/runManage stubs the boot needs.
 *
 * The walk is stubbed before the command resolves it — the behavior here is
 * WHERE the tee opens, not what the walk does.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WALK_MARKER = 'walking the fixture brand';

const managePath = require.resolve('../src/manage.js');
require.cache[managePath] = {
  id: managePath,
  filename: managePath,
  path: path.dirname(managePath),
  loaded: true,
  exports: {
    runManage: async () => {
      console.log(WALK_MARKER);
      return { hasErrors: false, results: {}, brand: {} };
    },
  },
};

const manageCommand = require('../src/commands/manage.js');

/** Stage a brand monorepo — a config/omega.json5 root is all the verb needs. */
function stageBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-verb-logs-')));

  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: {} },
}
`);

  return root;
}

test('omega manage tees the service walk to <brandRoot>/logs/manage.log', async () => {
  const root = stageBrand();
  const cwd0 = process.cwd();

  // The tee declines under a runner by design; this asserts what it does when
  // it does not decline, so the signal is lifted for the duration.
  const priorCi = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;

  try {
    process.chdir(root);
    await manageCommand({});
  } finally {
    require('@omega.js/devkit/attach-log-file').detach();
    process.chdir(cwd0);
    for (const [key, value] of Object.entries(priorCi)) {
      if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
    }
  }

  const contents = fs.readFileSync(path.join(root, 'logs', 'manage.log'), 'utf8');
  assert.match(contents, new RegExp(WALK_MARKER), "the walk's output is in the brand's manage log");
  assert.equal(fs.existsSync(path.join(root, 'logs', 'dev.log')), false,
    'dev.log belongs to `omega dev` — a walk never truncates it');
});
