/**
 * Unit tests for src/preludes/: the boot prelude list every verb passes
 * through, right after the freshness guard
 * ([#890](https://github.com/Omega-JS-Stack/omega/issues/890)).
 *
 * Two things are under test, and they are separate on purpose: the RUNNER
 * (which preludes a verb selects, in what order, and what a prelude that stops
 * the run does) and the first PRELUDE's decision (when a redirected `origin` is
 * rewritten and when it is left alone). The prelude's git calls and its one
 * network call are injected, except in the integration case at the bottom,
 * which boots a REAL CLI against a REAL git repo with only the GitHub read
 * stubbed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

const { runPreludes, PRELUDES } = require('../src/preludes/index.js');
const originHeal = require('../src/preludes/origin-heal.js');

const RUNNER = require.resolve('../src/preludes/index.js');
const MONOREPO = path.join(__dirname, '..', '..', '..');
const CLI_ENTRIES = [
  ['@omega.js/web', path.join(MONOREPO, 'packages', 'web', 'src', 'cli-run.js')],
  ['@omega.js/backend', path.join(MONOREPO, 'packages', 'backend', 'src', 'cli', 'run.js')],
  ['@omega.js/desktop', path.join(MONOREPO, 'packages', 'desktop', 'src', 'cli-run.js')],
  ['@omega.js/extension', path.join(MONOREPO, 'packages', 'extension', 'src', 'cli-run.js')],
  ['@omega.js/manager', path.join(MONOREPO, 'packages', 'manager', 'src', 'cli-run.js')],
];

/** A recording prelude: `{ name, verbs, run }` plus the calls it saw. */
function spy(name, verbs, calls) {
  return { name, verbs, run: (context) => calls.push({ name, context }) };
}

/** A scratch dir, removed when the test ends. */
function scratch(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- The runner: which preludes a verb selects

test('`all` runs on every verb, and on a boot with no verb at all', () => {
  const calls = [];
  const list = [spy('everywhere', 'all', calls)];

  assert.deepEqual(runPreludes({ verb: 'deploy', preludes: list }).ran, ['everywhere']);
  assert.deepEqual(runPreludes({ verb: 'test', preludes: list }).ran, ['everywhere']);
  assert.deepEqual(runPreludes({ preludes: list }).ran, ['everywhere'], 'a bare `omega` boots the same preludes');
  assert.equal(calls.length, 3);
});

test('one verb runs on that verb alone', () => {
  const calls = [];
  const list = [spy('deploy-only', 'deploy', calls)];

  assert.deepEqual(runPreludes({ verb: 'deploy', preludes: list }).ran, ['deploy-only']);
  assert.deepEqual(runPreludes({ verb: 'build', preludes: list }).ran, []);
  assert.deepEqual(runPreludes({ preludes: list }).ran, [], 'a targeted prelude never runs on a verb-less boot');
  assert.equal(calls.length, 1);
});

test('a list of verbs runs on each of them and nothing else', () => {
  const calls = [];
  const list = [spy('shipping', ['deploy', 'release'], calls)];

  assert.deepEqual(runPreludes({ verb: 'deploy', preludes: list }).ran, ['shipping']);
  assert.deepEqual(runPreludes({ verb: 'release', preludes: list }).ran, ['shipping']);
  assert.deepEqual(runPreludes({ verb: 'dev', preludes: list }).ran, []);
});

test('a flag where the verb goes is no verb: `all` runs, a targeted prelude does not', () => {
  const calls = [];
  const list = [spy('everywhere', 'all', calls), spy('version-only', 'version', calls)];

  assert.deepEqual(runPreludes({ verb: '--version', preludes: list }).ran, ['everywhere']);
});

test('the matches run in LIST order, whatever order the verb names them', () => {
  const calls = [];
  const list = [spy('first', 'all', calls), spy('second', ['build'], calls), spy('third', 'all', calls)];

  assert.deepEqual(runPreludes({ verb: 'build', preludes: list }).ran, ['first', 'second', 'third']);
  assert.deepEqual(calls.map((c) => c.name), ['first', 'second', 'third']);
});

test('every prelude gets the same context: the verb, the brand root, the target dir, the config', () => {
  const calls = [];
  const config = { brand: { id: 'acme' } };

  runPreludes({ verb: 'build', brandRoot: '/brands/acme', targetDir: '/brands/acme/targets/web', config, preludes: [spy('probe', 'all', calls)] });

  assert.deepEqual(calls[0].context, { verb: 'build', brandRoot: '/brands/acme', targetDir: '/brands/acme/targets/web', config });
});

test('the brand root defaults to the one resolved from the target dir', (t) => {
  const dir = scratch(t, 'omega-prelude-root-');
  jetpack.write(path.join(dir, 'config', 'omega.json5'), '{ brand: { id: \'acme\' } }\n');
  jetpack.write(path.join(dir, 'package.json'), '{ "name": "acme" }\n');
  const calls = [];

  runPreludes({ verb: 'build', targetDir: dir, preludes: [spy('probe', 'all', calls)] });

  assert.equal(calls[0].context.brandRoot, dir);
});

test('a prelude declaring a bogus `verbs` fails loudly, naming itself', () => {
  assert.throws(
    () => runPreludes({ verb: 'build', preludes: [{ name: 'broken', run: () => {} }] }),
    /broken/,
  );
});

test('the shipped list is verb-targeted preludes of one shape', () => {
  assert.ok(PRELUDES.length >= 1, 'the list ships at least the origin heal');
  for (const prelude of PRELUDES) {
    assert.equal(typeof prelude.name, 'string');
    assert.equal(typeof prelude.run, 'function');
    assert.ok(prelude.verbs === 'all' || typeof prelude.verbs === 'string' || Array.isArray(prelude.verbs));
  }
  assert.ok(PRELUDES.some((prelude) => prelude.name === originHeal.name), 'the origin heal is wired into the list');
});

test('a prelude that stops the run prints one line and exits 1', (t) => {
  const dir = scratch(t, 'omega-prelude-stop-');
  const script = path.join(dir, 'boot.js');
  jetpack.write(script, [
    `const { runPreludes } = require(${JSON.stringify(RUNNER)});`,
    'runPreludes({ verb: \'build\', preludes: [{ name: \'gate\', verbs: \'all\', run: () => { throw new Error(\'the brand config is unreadable\'); } }] });',
    'console.log(\'THE VERB RAN\');',
  ].join('\n'));

  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });

  assert.equal(result.status, 1, 'the boot exits 1');
  assert.doesNotMatch(result.stdout, /THE VERB RAN/, 'the verb never runs');
  assert.match(result.stderr, /the brand config is unreadable/);
  assert.equal(result.stderr.trim().split('\n').length, 1, 'one line of why, no stack');
});

// ---- Parity: the same call, at the same point, in all five CLI entries

test('all five CLI entries run the preludes right after the freshness boot, the same way', () => {
  for (const [name, file] of CLI_ENTRIES) {
    const source = fs.readFileSync(file, 'utf8');
    const freshness = source.indexOf('freshnessBoot(');
    const preludes = source.indexOf('runPreludes(');

    assert.ok(freshness !== -1, `${name} boots the freshness guard`);
    assert.ok(preludes !== -1, `${name} runs the boot preludes`);
    assert.ok(preludes > freshness, `${name} runs the preludes AFTER the freshness guard`);
    assert.match(
      source,
      /require\('@omega\.js\/devkit\/preludes'\)\.runPreludes\(\{ verb: process\.argv\[2\], targetDir: process\.cwd\(\) \}\);/,
      `${name} uses the one call shape`,
    );
  }
});

// ---- The origin heal: the decision

const CONFIG = { brand: { id: 'acme' }, repo: { provider: 'github', org: 'Acme-Org' } };
// Where the repo lives NOW (what GitHub answers), and the stale slug a clone
// made before the move still carries.
const CURRENT = 'Acme-Org/acme-omega';
const STALE = 'Old-Org/acme-omega';

/**
 * The prelude's seams: a git that answers a remote url and records every call,
 * and a GitHub read that answers what the case is about (the redirect GitHub
 * follows, recorded with the slug it was asked about).
 * @param {object} input
 * @param {string|Error} [input.origin] - What `git remote get-url origin` answers (an Error throws).
 * @param {object|null|Error} [input.resolved] - What the GitHub read answers.
 * @returns {object} `{ calls, lines, seams }`.
 */
function seams({ origin, resolved }) {
  const calls = [];
  const lines = [];

  return {
    calls,
    lines,
    seams: {
      log: (line) => lines.push(line),
      execFn: (file, args) => {
        calls.push([file, ...args]);
        if (args.includes('get-url')) {
          if (origin instanceof Error) throw origin;
          return origin;
        }
        return '';
      },
      resolveRepo: (owner, name) => {
        calls.push(['resolve', owner, name]);
        if (resolved instanceof Error) throw resolved;
        return resolved;
      },
    },
  };
}

/** A brand root that carries a `.git`, the shape the heal requires. */
function brandRoot(t) {
  const dir = scratch(t, 'omega-prelude-heal-');
  jetpack.dir(path.join(dir, '.git'));
  return dir;
}

test('a redirected origin is rewritten to the repo GitHub redirects to, and says so in words', (t) => {
  const root = brandRoot(t);
  const { calls, lines, seams: injected } = seams({
    origin: `https://github.com/${STALE}.git\n`,
    resolved: { full_name: CURRENT },
  });

  const result = originHeal.run({ brandRoot: root, config: CONFIG, ...injected });

  assert.deepEqual(
    calls.find((call) => call[0] === 'resolve'),
    ['resolve', 'Old-Org', 'acme-omega'],
    'GitHub is asked about the slug the CHECKOUT carries, and follows its own redirect',
  );
  assert.deepEqual(
    calls.find((call) => call.includes('set-url')),
    ['git', '-C', root, 'remote', 'set-url', 'origin', `https://github.com/${CURRENT}.git`],
  );
  assert.equal(lines.length, 1, 'the heal line, and no drift line: the config org is where GitHub says it lives');
  assert.match(lines[0], /origin healed from Old-Org\/acme-omega to Acme-Org\/acme-omega/);
  assert.deepEqual(result, { healed: true, from: STALE, to: CURRENT });
});

test('the heal keeps the remote\'s own form: an ssh remote stays ssh', (t) => {
  const root = brandRoot(t);
  const { calls, seams: injected } = seams({
    origin: `git@github.com:${STALE}.git\n`,
    resolved: { full_name: CURRENT },
  });

  originHeal.run({ brandRoot: root, config: CONFIG, ...injected });

  assert.equal(calls.find((call) => call.includes('set-url')).at(-1), `git@github.com:${CURRENT}.git`);
});

test('a converged origin is a silent no-op: GitHub answers the slug it was asked about', (t) => {
  const { calls, lines, seams: injected } = seams({
    origin: `https://github.com/${CURRENT}.git\n`,
    // GitHub's own comparison is case-insensitive, and so is this one.
    resolved: { full_name: 'acme-org/Acme-Omega' },
  });

  const result = originHeal.run({ brandRoot: brandRoot(t), config: CONFIG, ...injected });

  assert.deepEqual(lines, [], 'nothing is printed');
  assert.deepEqual(calls.filter((call) => call.includes('set-url')), [], 'the remote is left alone');
  assert.deepEqual(result, { healed: false, reason: 'converged' });
});

test('no config at all: the heal is GitHub\'s answer, config or no config', (t) => {
  // A brand root with a `.git` and no `config/omega.json5` anywhere: the lazy
  // load fails, which costs the drift check and nothing else.
  const root = brandRoot(t);
  const { calls, lines, seams: injected } = seams({
    origin: `https://github.com/${STALE}.git\n`,
    resolved: { full_name: CURRENT },
  });

  const result = originHeal.run({ brandRoot: root, ...injected });

  assert.equal(calls.find((call) => call.includes('set-url')).at(-1), `https://github.com/${CURRENT}.git`);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /origin healed from/);
  assert.deepEqual(result, { healed: true, from: STALE, to: CURRENT });
});

test('no repo block: the heal still runs, and nothing can drift from an org nobody typed', (t) => {
  const { calls, lines, seams: injected } = seams({
    origin: `https://github.com/${STALE}.git\n`,
    resolved: { full_name: CURRENT },
  });

  originHeal.run({ brandRoot: brandRoot(t), config: { brand: { id: 'acme' } }, ...injected });

  assert.equal(calls.find((call) => call.includes('set-url')).at(-1), `https://github.com/${CURRENT}.git`);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /origin healed from/);
});

test('drift: an origin GitHub serves under another owner than the derived source repo is stated, never rewritten', (t) => {
  const { calls, lines, seams: injected } = seams({
    origin: `https://github.com/${CURRENT}.git\n`,
    resolved: { full_name: CURRENT },
  });

  const result = originHeal.run({
    brandRoot: brandRoot(t),
    config: { brand: { id: 'acme' }, repo: { provider: 'github', org: 'Other-Org' } },
    ...injected,
  });

  assert.deepEqual(calls.filter((call) => call.includes('set-url')), [], 'the remote is right: it is the config that is wrong');
  assert.deepEqual(lines, ['omega: origin is Acme-Org/acme-omega but config derives Other-Org/acme-omega: fix repo.org in config/omega.json5 or move the repo']);
  assert.deepEqual(result, { healed: false, reason: 'converged', drift: { origin: CURRENT, derived: 'Other-Org/acme-omega' } });
});

test('drift: a RENAME is drift too, the whole slug compared, not the owner alone (#934)', (t) => {
  // GitHub redirects the old name to the new one under the SAME owner: the
  // heal follows it, and every reader still derives `<brand.id>-omega`.
  const { lines, seams: injected } = seams({
    origin: `https://github.com/${CURRENT}.git\n`,
    resolved: { full_name: 'Acme-Org/acme-site' },
  });

  const result = originHeal.run({ brandRoot: brandRoot(t), config: CONFIG, ...injected });

  assert.equal(lines.length, 2);
  assert.match(lines[0], /origin healed from Acme-Org\/acme-omega to Acme-Org\/acme-site/);
  assert.equal(lines[1], 'omega: origin is Acme-Org/acme-site but config derives Acme-Org/acme-omega: fix repo.org in config/omega.json5 or move the repo');
  assert.deepEqual(result.drift, { origin: 'Acme-Org/acme-site', derived: CURRENT });
});

test('a heal and a drift are two lines, the heal first', (t) => {
  const { lines, seams: injected } = seams({
    origin: `https://github.com/${STALE}.git\n`,
    resolved: { full_name: CURRENT },
  });

  const result = originHeal.run({
    brandRoot: brandRoot(t),
    config: { brand: { id: 'acme' }, repo: { provider: 'github', org: 'Other-Org' } },
    ...injected,
  });

  assert.equal(lines.length, 2);
  assert.match(lines[0], /origin healed from Old-Org\/acme-omega to Acme-Org\/acme-omega/);
  assert.match(lines[1], /origin is Acme-Org\/acme-omega but config derives Other-Org\/acme-omega/);
  assert.deepEqual(result, { healed: true, from: STALE, to: CURRENT, drift: { origin: CURRENT, derived: 'Other-Org/acme-omega' } });
});

test('a repo GitHub does not have is left alone, silently', (t) => {
  const { calls, lines, seams: injected } = seams({
    origin: `https://github.com/${STALE}.git\n`,
    resolved: null,
  });

  originHeal.run({ brandRoot: brandRoot(t), config: CONFIG, ...injected });

  assert.deepEqual(lines, []);
  assert.deepEqual(calls.filter((call) => call.includes('set-url')), [], 'a slug that resolves to nothing is not a heal');
});

test('offline is a no-op: a failing GitHub read never stops a verb', (t) => {
  const { calls, lines, seams: injected } = seams({
    origin: `https://github.com/${STALE}.git\n`,
    resolved: new Error('gh api repos/Old-Org/acme-omega failed: network is unreachable'),
  });

  originHeal.run({ brandRoot: brandRoot(t), config: CONFIG, ...injected });

  assert.deepEqual(lines, []);
  assert.deepEqual(calls.filter((call) => call.includes('set-url')), []);
});

test('no `.git` at the brand root: no git call, so the heal can never reach an enclosing repo', (t) => {
  const dir = scratch(t, 'omega-prelude-nogit-');
  const { calls, lines, seams: injected } = seams({ origin: `https://github.com/${STALE}.git\n` });

  originHeal.run({ brandRoot: dir, config: CONFIG, ...injected });

  assert.deepEqual(calls, [], 'a brand nested in someone else\'s repo is never touched, and GitHub is never asked');
  assert.deepEqual(lines, []);
});

test('no brand root at all is a no-op', () => {
  const { calls, seams: injected } = seams({ origin: `https://github.com/${STALE}.git\n` });

  originHeal.run({ brandRoot: null, config: CONFIG, ...injected });

  assert.deepEqual(calls, []);
});

test('a repo with no origin remote is a no-op', (t) => {
  const { calls, lines, seams: injected } = seams({ origin: new Error('error: No such remote \'origin\'') });

  originHeal.run({ brandRoot: brandRoot(t), config: CONFIG, ...injected });

  assert.deepEqual(lines, []);
  assert.deepEqual(calls.filter((call) => call[0] === 'resolve'), [], 'no remote, nothing to resolve');
});

test('a non-GitHub origin is left alone', (t) => {
  const { calls, lines, seams: injected } = seams({ origin: `git@gitlab.com:${STALE}.git\n` });

  originHeal.run({ brandRoot: brandRoot(t), config: CONFIG, ...injected });

  assert.deepEqual(lines, []);
  assert.deepEqual(calls.filter((call) => call.includes('set-url')), []);
});

// ---- Integration: one real CLI boot, one real git repo

test('a real CLI boot heals a redirected origin before the verb runs', (t) => {
  // The fixture is the sandbox brand's own config, copied into a scratch dir
  // with the `repo` block it does not declare, and git-init'd THERE: the
  // checked-in fixture lives inside this monorepo, so a `.git` and a remote of
  // its own would be a repo inside a repo and a real remote to rewrite.
  const dir = scratch(t, 'omega-prelude-boot-');
  const config = JSON5.parse(fs.readFileSync(path.join(MONOREPO, 'brands', 'sandbox-brand', 'config', 'omega.json5'), 'utf8'));
  config.repo = { provider: 'github', org: 'Omega-JS-Stack' };
  jetpack.write(path.join(dir, 'config', 'omega.json5'), `${JSON5.stringify(config, null, 2)}\n`);
  jetpack.write(path.join(dir, 'package.json'), '{ "name": "sandbox-brand", "private": true }\n');

  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'https://github.com/Old-Org/sandbox-brand-omega.git');

  // The one thing a test cannot have: GitHub following its own 301 and naming
  // where the repo lives now. The stale slug redirects to the transferred one;
  // every other slug, the transferred one included, answers as itself. Patched
  // on the module the prelude calls through.
  const stub = path.join(dir, 'stub-github.js');
  jetpack.write(stub, [
    `const github = require(${JSON.stringify(fs.realpathSync(path.join(__dirname, '..', 'src', 'github-repo.js')))});`,
    "const REDIRECTS = { 'Old-Org/sandbox-brand-omega': 'Omega-JS-Stack/sandbox-brand-omega' };",
    // A read with no bound would hang the boot on a stuck network: the stub refuses it.
    'github.getRepo = (owner, name, options) => {',
    "  if (!options || !(options.timeout > 0)) throw new Error('the boot read must carry a timeout');",
    '  return { full_name: REDIRECTS[`${owner}/${name}`] || `${owner}/${name}` };',
    '};',
  ].join('\n'));

  const boot = () => spawnSync(process.execPath, [path.join(MONOREPO, 'packages', 'manager', 'src', 'cli-run.js'), 'version'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      OMEGA_SKIP_FRESHNESS: '1',       // the sibling boot step, not this one's business
      OMEGA_HOME: path.join(dir, '.omega-home'),
      NODE_OPTIONS: `--require ${stub}`,
    },
  });

  const first = boot();

  assert.equal(first.status, 0, `the verb ran: ${first.stderr}`);
  assert.match(first.stdout, /origin healed from Old-Org\/sandbox-brand-omega to Omega-JS-Stack\/sandbox-brand-omega/);
  assert.match(first.stdout, /@omega\.js\/manager v/, 'the verb itself still ran');
  assert.doesNotMatch(first.stdout, /config derives/, 'the config derives the repo GitHub serves it from');
  assert.equal(git('remote', 'get-url', 'origin'), 'https://github.com/Omega-JS-Stack/sandbox-brand-omega.git');

  // A converged brand: the second boot mutates nothing and says nothing, which
  // is what makes the durable reconciler's walk report zero mutations.
  const second = boot();

  assert.equal(second.status, 0);
  assert.doesNotMatch(second.stdout, /origin healed/);
  assert.doesNotMatch(second.stdout, /config derives/);
  assert.equal(git('remote', 'get-url', 'origin'), 'https://github.com/Omega-JS-Stack/sandbox-brand-omega.git');
});
