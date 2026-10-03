/**
 * Unit tests for src/deploy-precheck.js — the shared runner behind every
 * framework's `omega deploy` network precheck
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * The STEPS are each framework's; the guarantees tested here are the runner's:
 * the `--no-secrets` opt-out, list order, a soft failure (a throwing step warns
 * and the run continues, because a precheck reports), a FATAL step that stops
 * the run instead ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)),
 * and the `dryRun` every step receives
 * ([#895](https://github.com/Omega-JS-Stack/omega/issues/895)).
 */

const defineCases = require('@omega.js/devkit/test/define-cases');

const { runDeployPrecheck } = require('../src/deploy-precheck');

function recorder() {
  const lines = { log: [], warn: [] };
  return {
    lines,
    logger: { log: (l) => lines.log.push(l), warn: (l) => lines.warn.push(l), error: (l) => lines.warn.push(l) },
  };
}

function steps(names, throwing) {
  const ran = [];
  return {
    ran,
    steps: names.map((name) => ({
      name,
      run: () => {
        if (name === throwing) throw new Error(`${name} exploded`);
        ran.push(name);
      },
    })),
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'deploy-precheck',
  tests: [
    {
      name: '--no-secrets skips every step and returns the opt-out marker',
      run: async (ctx) => {
        const { logger, lines } = recorder();
        const { ran, steps: list } = steps(['a', 'b']);

        const result = await runDeployPrecheck({ projectDir: '/tmp/x', options: { secrets: false }, logger, steps: list });

        ctx.expect(result).toEqual({ skipped: 'opt-out' });
        ctx.expect(ran, 'no step runs').toEqual([]);
        ctx.expect(lines.log.join('\n'), 'the opt-out is announced').toMatch(/--no-secrets/);
      },
    },

    {
      name: 'steps run in list order and `ran` names the ones that finished',
      run: async (ctx) => {
        const { logger } = recorder();
        const { ran, steps: list } = steps(['first', 'second', 'third']);

        const result = await runDeployPrecheck({ projectDir: '/tmp/x', options: {}, logger, steps: list });

        ctx.expect(ran).toEqual(['first', 'second', 'third']);
        ctx.expect(result.ran).toEqual(ran);
      },
    },

    {
      name: 'a throwing step is a warning, not a stop — a precheck reports',
      run: async (ctx) => {
        const { logger, lines } = recorder();
        const { ran, steps: list } = steps(['first', 'boom', 'third'], 'boom');

        const result = await runDeployPrecheck({ projectDir: '/tmp/x', options: {}, logger, steps: list });

        ctx.expect(ran, 'the run continues past the failure').toEqual(['first', 'third']);
        ctx.expect(result.ran, 'a failed step is not reported as run').toEqual(['first', 'third']);
        ctx.expect(lines.warn.join('\n')).toMatch(/boom failed during the deploy precheck \(non-fatal\): boom exploded/);
      },
    },

    {
      name: 'every step gets the projectDir and the two loggers',
      run: async (ctx) => {
        const { logger, lines } = recorder();
        const seen = [];
        const list = [{ name: 'probe', run: (input) => { seen.push(input); input.log('hi'); input.warn('careful'); } }];

        await runDeployPrecheck({ projectDir: '/tmp/target', options: {}, logger, steps: list });

        ctx.expect(seen[0].projectDir).toBe('/tmp/target');
        ctx.expect(lines.log).toEqual(['hi']);
        ctx.expect(lines.warn).toEqual(['careful']);
      },
    },

    {
      name: 'a FATAL step STOPS the run: the deploy never reaches its dispatch (#891)',
      run: async (ctx) => {
        const { logger } = recorder();
        const ran = [];
        const list = [
          { name: 'first', run: () => ran.push('first') },
          { name: 'push-secrets', fatal: true, run: () => { throw new Error('3 secret(s) are empty'); } },
          { name: 'third', run: () => ran.push('third') },
        ];

        await ctx.expect((() => runDeployPrecheck({ projectDir: '/tmp/x', options: {}, logger, steps: list }))()).rejects.toThrow(/push-secrets failed during the deploy precheck: 3 secret\(s\) are empty/);

        ctx.expect(ran, 'nothing after the fatal step runs').toEqual(['first']);
      },
    },

    {
      name: 'dryRun reaches every step, and defaults to false (#895)',
      run: async (ctx) => {
        const { logger } = recorder();
        const seen = [];
        const list = [{ name: 'probe', run: ({ dryRun }) => seen.push(dryRun) }];

        await runDeployPrecheck({ projectDir: '/tmp/x', options: {}, logger, steps: list, dryRun: true });
        await runDeployPrecheck({ projectDir: '/tmp/x', options: {}, logger, steps: list });

        ctx.expect(seen).toEqual([true, false]);
      },
    },
  ],
});
