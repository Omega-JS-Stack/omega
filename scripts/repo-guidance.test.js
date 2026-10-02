/**
 * repo-guidance tests: the ONE "set repo.owner and brand.id" line.
 *
 * `@omega.js/config`'s `repoMissing(role)` is the only home of the guidance a
 * refusal gives when a repo cannot be addressed. Every refusal keeps its own
 * lead and quotes that line, so no package types the guidance by hand again.
 *
 * Two scans over packages/<pkg>/src: no file but repo.js spells the guidance,
 * and each of the nine refusals calls `repoMissing` with its repo's role.
 *
 * Run: node --test scripts/repo-guidance.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOME = 'packages/config/src/repo.js';

// Every spelling the hand-typed copies used: "set repo.owner and brand.id",
// "Set repo.owner (and brand.id)", "needs repo.owner and brand.id".
const HAND_TYPED = /repo\.owner.{0,6}and.{0,3}brand\.id/i;

// Tests and fixtures assert the line; they are not refusals that type it.
const EXEMPT_PATH = /(^|\/)(test|tests|fixtures)(\/|$)/;

// Each refusal and the role of the repo it could not address.
const REFUSALS = {
  'packages/backend/src/omega/helpers/web-target.js': 'source',
  'packages/desktop/src/commands/finalize-release.js': 'releases',
  'packages/desktop/src/commands/lib/deploy-precheck.js': 'releases',
  'packages/desktop/src/gulp/tasks/audit.js': 'releases',
  'packages/desktop/src/gulp/tasks/build-config.js': 'releases',
  'packages/devkit/src/deploy.js': 'source',
  'packages/devkit/src/target-secrets.js': 'source',
  'packages/extension/src/gulp/tasks/publish.js': 'releases',
  'packages/web/src/commands/deploy.js': 'website',
};

function sourceFiles() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)packages/*/src/**'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && !EXEMPT_PATH.test(file.split('/src/')[1]) && fs.existsSync(path.join(ROOT, file)));
}

test('the hand-typed guidance pattern catches every spelling the copies used', () => {
  assert.match('GitHub repo not configured (set repo.owner and brand.id in config/omega.json5)', HAND_TYPED);
  assert.match('Set repo.owner (and brand.id) in config/omega.json5', HAND_TYPED);
  assert.match('Direct deploy needs repo.owner and brand.id in config/omega.json5', HAND_TYPED);
  assert.doesNotMatch('fix repo.owner in config/omega.json5 or move the repo', HAND_TYPED, 'the drift line says something else');
});

test('no file under packages/*/src but repo.js types the repo.owner and brand.id guidance', () => {
  const hits = sourceFiles().filter((file) => HAND_TYPED.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));

  // repo.js must be a hit itself, so a scan that finds nothing never passes.
  assert.deepEqual(hits, [HOME]);
});

test('each of the nine refusals quotes repoMissing for its repo\'s role', () => {
  const missing = Object.entries(REFUSALS).flatMap(([file, role]) => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return new RegExp(`\\brepoMissing\\(\\s*['"\`]${role}['"\`]\\s*\\)`).test(source) ? [] : [`${file} (${role})`];
  });

  assert.deepEqual(missing, []);
});
