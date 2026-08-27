/**
 * The scaffolded CI workflow cannot exhaust the runner's disk (#568, the port
 * of UJM 1.9.33).
 *
 * somiibo-website failed every deploy for four days: the build passed and the
 * `peaceiris/actions-gh-pages` step took the runner down with "No space left
 * on device", invisibly, because a `ls -R *` step had truncated the job log.
 * The math on ubuntu-latest's ~14 GB: a `fetch-depth: 0` checkout of 4.3 GB of
 * packed history, a gh-pages branch that grows by a whole site per deploy and
 * gets cloned again by the deploy action, plus the image cache.
 *
 * Four levers shipped in UJM and are ported here. NOTHING in an omega build
 * reads git history — `service-worker.js` asks `git rev-parse --short HEAD`
 * (present in a depth-1 clone), `devkit/deploy.js` asks `git diff --cached
 * --quiet` (index vs HEAD), and `omega deploy --direct` inits a FRESH repo in
 * dist — so the depth is free to drop.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const { scaffoldDefaults } = require('../src/scaffold.js');

const quiet = { log() {}, warn() {}, error() {} };

let dir;
let workflow;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-workflow-'));
  fs.writeFileSync(path.join(dir, '.env'), 'GH_TOKEN=ghp\n');
  scaffoldDefaults({ outputDir: dir, logger: quiet });
  workflow = fs.readFileSync(path.join(dir, '.github', 'workflows', 'build.yml'), 'utf8');
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('#568: the checkout is shallow — nothing in the build reads history', () => {
  assert.ok(workflow.includes('fetch-depth: 1'), 'depth 1, the biggest lever (~4 GB on somiibo)');
  assert.ok(!workflow.includes('fetch-depth: 0'), 'no full-history checkout anywhere');
});

test('#568: the gh-pages branch stays ONE commit', () => {
  assert.ok(workflow.includes('peaceiris/actions-gh-pages@v4'), 'the deploy action is unchanged');
  assert.ok(/peaceiris\/actions-gh-pages@v4[\s\S]*?force_orphan: true/.test(workflow),
    'force_orphan on the deploy step, so the published branch stops growing by a site per deploy');
});

test('#568: disk is reported before the build AND after it, even when the build dies', () => {
  const before_ = workflow.indexOf('df -h /');
  const after_ = workflow.indexOf('df -h /', before_ + 1);
  assert.ok(before_ > -1 && after_ > -1, 'two df readings');

  const buildStep = workflow.indexOf('name: Build');
  assert.ok(before_ < buildStep, 'one before the build');
  assert.ok(after_ > buildStep, 'one after it');

  // The after-step is the one that matters: it has to run when the build
  // itself is what ran out of room.
  assert.ok(/if: always\(\)[\s\S]{0,200}df -h \//.test(workflow.slice(buildStep)),
    'the after reading runs with if: always()');
});

test('#568: no file-listing step can truncate the job log', () => {
  // Comments are allowed to NAME the retired command; steps are not.
  const steps = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

  assert.ok(!/ls -R/.test(steps), 'no ls -R sweep (45k lines of node_modules) in any step');
  assert.ok(steps.includes('git ls-files'), 'the listing is the tracked-file list instead');
});
