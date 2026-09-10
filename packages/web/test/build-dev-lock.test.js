/**
 * `omega dev` and `omega build` write the SAME `dist/`, so a build run while
 * dev is serving that folder silently poisons the running session — the dev
 * server keeps serving production-stamped pages until someone restarts it
 * ([#617](https://github.com/Omega-JS-Stack/omega/issues/617)).
 *
 * The build REFUSES while the target's dev run is live. The dev run is known by
 * the ports file it publishes (`.temp/ports.json`, pid-stamped, cleared on
 * shutdown) — the same file every sibling tool already reads, so there is no
 * second lock to keep in sync. A crash leaves that file behind with a dead pid:
 * that one is ignored, because a stale lock must never wedge a build.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const build = require('../src/commands/build.js');

// A dead pid — the crash leftover a build has to see through. Above the
// platform's pid ceiling, so it can never belong to a live process.
const DEAD_PID = 4194305;

/**
 * A temp web consumer. Its config carries the retired `payment.processors` key
 * (fatal since #426), so a build that gets PAST the dev-lock guard fails fast
 * on the config instead of running a real 11ty build in a test.
 */
function consumer(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-dev-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const files = {
    'config/omega.json5': `{
  brand: { id: 'fixture', name: 'Fixture', url: 'https://fixture.example.com' },
  payment: { processors: { stripe: {} } },
  targets: { web: {} },
}`,
    'package.json': JSON.stringify({
      name: 'fixture-website',
      private: true,
      dependencies: { '@omega.js/web': '*' },
    }),
    'src/index.md': '# home',
  };

  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

/** Publish a ports file the way the dev server does, owned by `pid`. */
function publishPorts(root, pid) {
  fs.mkdirSync(path.join(root, '.temp'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.temp', 'ports.json'),
    JSON.stringify({ ports: { website: 4300 }, origin: 'https://localhost:4300', pid, startedAt: new Date().toISOString() }),
  );
}

test('#617: a build refuses while this target\'s dev server is serving dist/', async (t) => {
  const root = consumer(t);
  publishPorts(root, process.pid); // live — this very process stands in for the dev run

  const previous = process.cwd();
  process.chdir(root);
  t.after(() => process.chdir(previous));

  await assert.rejects(
    build({ logFile: false }),
    /omega dev is serving this target on :4300/,
    'the refusal names the running dev server, in one line',
  );

  assert.strictEqual(fs.existsSync(path.join(root, 'dist')), false, 'a refused build writes nothing into the served folder');
  assert.strictEqual(fs.existsSync(path.join(root, 'logs', 'build.log')), false, 'refusing costs the target nothing — not even a truncated log');
});

test('#617: a crash-stale ports file never wedges a build — the dead pid is ignored', async (t) => {
  const root = consumer(t);
  publishPorts(root, DEAD_PID); // the leftover of a dev server that crashed

  const previous = process.cwd();
  process.chdir(root);
  t.after(() => process.chdir(previous));

  // Past the guard, into the real work: this fixture's config is fatal, so the
  // build fails on THAT — the proof it never stopped at the stale lock.
  await assert.rejects(
    build({ logFile: false }),
    /payment\.processors is retired/,
    'the build proceeded; the only thing that stopped it is the config',
  );
});
