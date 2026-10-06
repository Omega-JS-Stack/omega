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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

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
  targets: { web: { type: 'web' } },
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

module.exports = defineCases({
  type: 'group',
  description: 'build-dev-lock',
  tests: [
    {
      name: '#617: a build refuses while this target\'s dev server is serving dist/',
      run: async (ctx) => {
        const root = consumer(ctx);
        publishPorts(root, process.pid); // live — this very process stands in for the dev run

        const previous = process.cwd();
        process.chdir(root);
        ctx.after(() => process.chdir(previous));

        await ctx.expect(build({ logFile: false }), 'the refusal names the running dev server, in one line').rejects.toThrow(/omega dev is serving this target on :4300/);

        ctx.expect(fs.existsSync(path.join(root, 'dist')), 'a refused build writes nothing into the served folder').toBe(false);
        ctx.expect(fs.existsSync(path.join(root, 'logs', 'build.log')), 'refusing costs the target nothing — not even a truncated log').toBe(false);
      },
    },

    {
      name: '#617: a crash-stale ports file never wedges a build — the dead pid is ignored',
      run: async (ctx) => {
        const root = consumer(ctx);
        publishPorts(root, DEAD_PID); // the leftover of a dev server that crashed

        const previous = process.cwd();
        process.chdir(root);
        ctx.after(() => process.chdir(previous));

        // Past the guard, into the real work: this fixture's config is fatal, so the
        // build fails on THAT — the proof it never stopped at the stale lock.
        await ctx.expect(build({ logFile: false }), 'the build proceeded; the only thing that stopped it is the config').rejects.toThrow(/payment\.processors\.stripe is not a key the schema declares/);
      },
    },
  ],
});
