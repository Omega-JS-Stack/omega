// Every file the brand scaffold commits is copied into a consumer's repo, whose
// own guard may refuse an em dash (U+2014) at commit time. The .env and its
// overlays are gitignored, so they never reach that guard.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildScaffoldPlan } = require('../src/lib/scaffold.js');

test('scaffold: no committed file carries an em dash', () => {
  const plan = buildScaffoldPlan({
    id: 'acme',
    name: 'Acme',
    url: 'https://acme.dev',
    email: 'hi@acme.dev',
    accountAdmins: [{ email: 'hi@acme.dev', account: true, marketing: false }],
    targets: [{ name: 'backend', type: 'backend' }, { name: 'web', type: 'web' }],
  });
  const committed = plan.filter((file) => !/^\.env(\.|$)/.test(file.path));
  assert.ok(committed.some((file) => file.path === 'README.md'), 'the plan carries the committed files');

  const dashed = committed.filter((file) => file.contents.includes('\u2014')).map((file) => file.path);
  assert.deepEqual(dashed, []);
});
