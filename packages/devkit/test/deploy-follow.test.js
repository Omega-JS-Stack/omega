/**
 * The ONE run follower every dispatched deploy uses
 * ([#873](https://github.com/Omega-JS-Stack/omega/issues/873)). Pins: finding
 * the run this dispatch started (never the one before it), the job log arriving
 * 404-then-partial-then-complete with each byte printed once, the banner
 * printing only on a transition, a skipped job rendering as a skip, a poll
 * failure retried rather than turned into a verdict, and a red run failing the
 * verb by name.
 *
 * Offline by construction: `fetchFn` is scripted per URL and `sleepFn` is a
 * no-op, so a follow of a whole run costs no network and no wall clock.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { followRun, jobSymbol, MAX_TRANSIENT_POLLS } = require('../src/deploy-follow.js');

const OWNER = 'acme';
const REPO = 'acme-omega';
const WORKFLOW = 'desktop-build.yml';
const SINCE = new Date('2026-09-13T00:00:00.000Z');

/** A logger that keeps what it was told, in order. */
function recorder() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)), warn: (line) => lines.push(`WARN ${line}`) };
}

const json = (body) => ({ status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const text = (body) => ({ status: 200, json: async () => ({}), text: async () => body });
const missing = () => ({ status: 404, json: async () => ({}), text: async () => '' });

/**
 * A fetch scripted by URL SHAPE: `runs?` (the lookup), `/jobs?` (the job list),
 * `/logs` (one job's log), anything else (the run state). Each entry is an
 * array read one tick at a time, the last value repeating forever.
 *
 * @param {object} script - `{ lookup, run, jobs, logs }`, each an array of responses.
 * @returns {Function} The fetch seam, carrying a `calls` array.
 */
function scriptedFetch(script) {
  const at = { lookup: 0, run: 0, jobs: 0, logs: 0 };
  const next = (key) => {
    const list = script[key];
    const value = list[Math.min(at[key], list.length - 1)];
    at[key] += 1;
    return typeof value === 'function' ? value() : value;
  };

  const fetchFn = async (url) => {
    fetchFn.calls.push(url);
    if (url.includes('/logs')) return next('logs');
    if (url.includes('/jobs')) return next('jobs');
    if (url.includes('/runs?')) return next('lookup');
    return next('run');
  };
  fetchFn.calls = [];

  return fetchFn;
}

/** The argument set every case shares: no network, no waiting. */
const base = (fetchFn, logger) => ({
  owner: OWNER,
  repo: REPO,
  workflow: WORKFLOW,
  since: SINCE,
  token: 'tok',
  logger,
  fetchFn,
  sleepFn: async () => {},
});

test('followRun: the run it follows is the one this dispatch started, never the one before it (#873)', async () => {
  const logger = recorder();
  const fetchFn = scriptedFetch({
    lookup: [json({
      workflow_runs: [
        { id: 1, created_at: '2026-09-12T23:00:00.000Z', html_url: 'https://github.com/acme/acme-omega/actions/runs/1' },
        { id: 2, created_at: '2026-09-13T00:00:04.000Z', html_url: 'https://github.com/acme/acme-omega/actions/runs/2' },
      ],
    })],
    run: [json({ id: 2, status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/acme-omega/actions/runs/2' })],
    jobs: [json({ jobs: [] })],
    logs: [missing()],
  });

  const result = await followRun(base(fetchFn, logger));

  assert.strictEqual(result.run.id, 2, 'the newest run created after the dispatch');
  assert.strictEqual(result.conclusion, 'success');
  assert.ok(fetchFn.calls[1].includes('/actions/runs/2'), `the poll addresses that run (got ${fetchFn.calls[1]})`);
  assert.ok(logger.lines.some((line) => line.includes('Run started: https://github.com/acme/acme-omega/actions/runs/2')));
});

test('followRun: no run at all within the lookup budget fails naming the workflow and the runs page (#873)', async () => {
  const fetchFn = scriptedFetch({
    lookup: [json({ workflow_runs: [{ id: 1, created_at: '2026-09-12T23:00:00.000Z' }] })],
    run: [missing()],
    jobs: [missing()],
    logs: [missing()],
  });

  await assert.rejects(
    followRun({ ...base(fetchFn, recorder()), lookupMs: 0 }),
    (error) => {
      assert.match(error.message, /desktop-build\.yml was dispatched/, 'names the workflow');
      assert.match(error.message, /actions\/workflows\/desktop-build\.yml/, 'and the runs page');
      return true;
    },
  );
});

test('followRun: a job log 404s, then arrives in chunks, and every byte prints exactly once (#873)', async () => {
  const logger = recorder();
  const job = (status, conclusion) => json({ jobs: [{ id: 9, name: 'Build macOS', status, conclusion }] });
  const fetchFn = scriptedFetch({
    lookup: [json({ workflow_runs: [{ id: 2, created_at: '2026-09-13T00:00:04.000Z', html_url: 'https://x/2' }] })],
    run: [
      json({ id: 2, status: 'in_progress', conclusion: null, html_url: 'https://x/2' }),
      json({ id: 2, status: 'in_progress', conclusion: null, html_url: 'https://x/2' }),
      json({ id: 2, status: 'completed', conclusion: 'success', html_url: 'https://x/2' }),
    ],
    jobs: [job('in_progress', null), job('in_progress', null), job('completed', 'success')],
    logs: [missing(), text('first\nsecond\n'), text('first\nsecond\nthird\n')],
  });

  await followRun(base(fetchFn, logger));

  const streamed = logger.lines.filter((line) => line.startsWith('[Build macOS] '));
  assert.deepStrictEqual(
    streamed,
    ['[Build macOS] first', '[Build macOS] second', '[Build macOS] third'],
    'the 404 printed nothing and the second chunk printed only what the first did not carry',
  );
});

test('followRun: the status banner prints on a transition and never twice for one state (#873)', async () => {
  const logger = recorder();
  const job = (status, conclusion) => json({ jobs: [{ id: 9, name: 'Build', status, conclusion }] });
  const fetchFn = scriptedFetch({
    lookup: [json({ workflow_runs: [{ id: 2, created_at: '2026-09-13T00:00:04.000Z', html_url: 'https://x/2' }] })],
    run: [
      json({ id: 2, status: 'in_progress', conclusion: null, html_url: 'https://x/2' }),
      json({ id: 2, status: 'in_progress', conclusion: null, html_url: 'https://x/2' }),
      json({ id: 2, status: 'completed', conclusion: 'success', html_url: 'https://x/2' }),
    ],
    jobs: [job('in_progress', null), job('in_progress', null), job('completed', 'success')],
    logs: [missing()],
  });

  await followRun(base(fetchFn, logger));

  const banners = logger.lines.filter((line) => line.startsWith('--'));
  assert.deepStrictEqual(banners, [
    '-- in_progress -- … Build',
    '-- completed (success) -- ✓ Build',
  ], 'two states, two banners: the repeated poll said nothing');
});

test('followRun: a job GitHub marked skipped renders as a skip, never a failure (#873)', async () => {
  const logger = recorder();
  const jobs = json({
    jobs: [
      { id: 1, name: 'Build mac', status: 'completed', conclusion: 'success' },
      { id: 2, name: 'Sign Windows', status: 'completed', conclusion: 'skipped' },
      { id: 3, name: 'Build linux', status: 'completed', conclusion: 'failure' },
    ],
  });
  const fetchFn = scriptedFetch({
    lookup: [json({ workflow_runs: [{ id: 2, created_at: '2026-09-13T00:00:04.000Z', html_url: 'https://x/2' }] })],
    run: [json({ id: 2, status: 'completed', conclusion: 'failure', html_url: 'https://x/2' })],
    jobs: [jobs],
    logs: [missing()],
  });

  await assert.rejects(followRun(base(fetchFn, logger)), /concluded failure/);

  const banner = logger.lines.find((line) => line.startsWith('--'));
  assert.strictEqual(banner, '-- completed (failure) -- ✓ Build mac  |  ⊘ Sign Windows  |  ✗ Build linux');

  // The symbol table itself, since the banner only ever shows three of it.
  assert.strictEqual(jobSymbol({ status: 'completed', conclusion: 'skipped' }), '⊘');
  assert.strictEqual(jobSymbol({ status: 'completed', conclusion: 'success' }), '✓');
  assert.strictEqual(jobSymbol({ status: 'completed', conclusion: 'cancelled' }), '✗');
  assert.strictEqual(jobSymbol({ status: 'in_progress' }), '…');
  assert.strictEqual(jobSymbol({ status: 'queued' }), '·');
});

test('followRun: a poll failure is retried, and only MAX_TRANSIENT_POLLS in a row give up (#873)', async () => {
  const logger = recorder();
  let runReads = 0;
  const fetchFn = scriptedFetch({
    lookup: [json({ workflow_runs: [{ id: 2, created_at: '2026-09-13T00:00:04.000Z', html_url: 'https://x/2' }] })],
    run: [() => {
      runReads += 1;
      // Two timeouts, one good read that RESETS the count, then timeouts forever.
      if (runReads <= 2 || runReads > 3) {
        throw new Error('Connect Timeout Error (attempted address: api.github.com:443, timeout: 10000ms)');
      }
      return json({ id: 2, status: 'in_progress', conclusion: null, html_url: 'https://x/2' });
    }],
    jobs: [json({ jobs: [{ id: 9, name: 'Build', status: 'queued' }] })],
    logs: [missing()],
  });

  await assert.rejects(followRun(base(fetchFn, logger)), /Connect Timeout Error/);

  const warnings = logger.lines.filter((line) => line.startsWith('WARN Poll failed'));
  assert.strictEqual(warnings.length, 2 + MAX_TRANSIENT_POLLS, 'two tolerated, a good read resets, then twelve more before the throw');
  assert.ok(warnings[0].includes(`(1/${MAX_TRANSIENT_POLLS}`), 'the count is in the warning');
  assert.ok(warnings[2].includes(`(1/${MAX_TRANSIENT_POLLS}`), 'and the successful read reset it');
});

test('followRun: a non-success conclusion throws with the run URL, so the verb exits 1 (#873)', async () => {
  const fetchFn = scriptedFetch({
    lookup: [json({ workflow_runs: [{ id: 2, created_at: '2026-09-13T00:00:04.000Z', html_url: 'https://github.com/acme/acme-omega/actions/runs/2' }] })],
    run: [json({ id: 2, status: 'completed', conclusion: 'failure', html_url: 'https://github.com/acme/acme-omega/actions/runs/2' })],
    jobs: [json({ jobs: [] })],
    logs: [missing()],
  });

  await assert.rejects(
    followRun(base(fetchFn, recorder())),
    (error) => {
      assert.match(error.message, /desktop-build\.yml concluded failure/, 'the workflow and the verdict');
      assert.match(error.message, /https:\/\/github\.com\/acme\/acme-omega\/actions\/runs\/2/, 'and the run to look at');
      return true;
    },
  );
});

test('followRun: a run whose head is NOT this deploy\'s sha is refused before it is followed (#902)', async () => {
  // The live shape (playground, 2026-09-12): the desktop leg pushed d09a5882
  // and GitHub started the run on cf6718cd, the extension's earlier snapshot.
  // It went green and republished the version before this one.
  const fetchFn = scriptedFetch({
    lookup: [json({
      workflow_runs: [
        { id: 2, created_at: '2026-09-13T00:00:04.000Z', head_sha: 'cf6718cdaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', html_url: 'https://github.com/acme/acme-omega/actions/runs/2' },
      ],
    })],
    run: [json({ id: 2, status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/acme-omega/actions/runs/2' })],
    jobs: [json({ jobs: [] })],
    logs: [missing()],
  });

  await assert.rejects(
    followRun({ ...base(fetchFn, recorder()), headSha: 'd09a5882bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
    (error) => {
      assert.match(error.message, /cf6718c/, 'the sha the run is building');
      assert.match(error.message, /d09a588/, 'the sha this deploy pushed');
      assert.match(error.message, /https:\/\/github\.com\/acme\/acme-omega\/actions\/runs\/2/, 'and the run to look at');
      return true;
    },
  );

  assert.strictEqual(fetchFn.calls.length, 1, 'the lookup, and not one poll of a run that is not this deploy\'s');
});

test('followRun: a run whose head IS this deploy\'s sha is followed, and the head is in the line (#902)', async () => {
  const logger = recorder();
  const fetchFn = scriptedFetch({
    lookup: [json({
      workflow_runs: [
        { id: 2, created_at: '2026-09-13T00:00:04.000Z', head_sha: 'd09a5882bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', html_url: 'https://github.com/acme/acme-omega/actions/runs/2' },
      ],
    })],
    run: [json({ id: 2, status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/acme-omega/actions/runs/2' })],
    jobs: [json({ jobs: [] })],
    logs: [missing()],
  });

  const result = await followRun({ ...base(fetchFn, logger), headSha: 'd09a5882bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });

  assert.strictEqual(result.conclusion, 'success');
  assert.ok(
    logger.lines.some((line) => line === 'Run started: https://github.com/acme/acme-omega/actions/runs/2 (head d09a588)'),
    `the line says which tree the run is building (got ${JSON.stringify(logger.lines)})`,
  );
});
