/**
 * The workspace service's company operation (#677): the ONE key that joins a
 * brand to its company is asked on the manage walk when the brand's file
 * carries none, in the same words the onboard wizard uses, and the answer
 * lands as the top-level `company: { id }` with the file's comments intact.
 *
 * Real files, real prompts over fake TTY streams — nothing mocked.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');

const companyOp = require('../src/services/workspace/ensure/company.js');
const { validateCompanyId } = require('../src/lib/company-question.js');
const { openTtyPrompt } = require('./lib/interactive.js');

const AUTHORED = `// Fixture Brand — the owner's own file, comments and all.
{
  brand: { id: 'fixture-brand', name: 'Fixture Brand' },
  targets: { web: { type: 'web' } },
}
`;

function stageBrand(config = AUTHORED) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-workspace-company-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), config);
  return root;
}

function readConfig(root) {
  return JSON5.parse(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8'));
}

function opContext(root, overrides = {}) {
  return { brandRoot: root, brandConfig: readConfig(root), options: {}, ...overrides };
}

test('company op: the answer lands as the top-level key, comments intact', async (t) => {
  const root = stageBrand();
  const tty = openTtyPrompt();
  t.after(() => tty.close());

  const run = companyOp(opContext(root));
  await tty.answer('Company brand id', 'itw-creative-works\r');
  const result = await run;

  assert.deepEqual(result.output.company, { id: 'itw-creative-works' });
  assert.deepEqual(readConfig(root).company, { id: 'itw-creative-works' });

  const file = fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8');
  assert.match(file, /^\/\/ Fixture Brand — the owner's own file/, 'the comment-preserving editor wrote it');
});

test('company op: a blank answer is the standalone brand — nothing written', async (t) => {
  const root = stageBrand();
  const before = fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8');
  const tty = openTtyPrompt();
  t.after(() => tty.close());

  const run = companyOp(opContext(root));
  await tty.answer('Company brand id', '\r');

  assert.equal(await run, null);
  assert.equal(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8'), before);
});

test('company op: an authored key is never re-asked, and a headless run never asks at all', async () => {
  const answered = stageBrand(AUTHORED.replace('  brand:', "  company: { id: 'self' },\n  brand:"));
  assert.equal(await companyOp(opContext(answered)), null, 'answered: nothing to do');

  // No TTY here (and none in CI): the question is pending, the walk goes on
  const unanswered = stageBrand();
  const before = fs.readFileSync(path.join(unanswered, 'config', 'omega.json5'), 'utf8');
  assert.equal(await companyOp(opContext(unanswered)), null);
  assert.equal(fs.readFileSync(path.join(unanswered, 'config', 'omega.json5'), 'utf8'), before);

  // A brand with no config at all is the config operation's report, not ours
  assert.equal(await companyOp(opContext(unanswered, { brandRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bare-')) })), null);
});

test('company: the one answer rule — a brand id, "self", or blank', () => {
  assert.equal(validateCompanyId('itw-creative-works'), true);
  assert.equal(validateCompanyId('self'), true);
  assert.equal(validateCompanyId('  '), true, 'blank is the standalone brand');
  assert.match(validateCompanyId('Itw Creative Works'), /Must be a brand id/);
  assert.match(validateCompanyId('9lives'), /"self", or blank/);
});
