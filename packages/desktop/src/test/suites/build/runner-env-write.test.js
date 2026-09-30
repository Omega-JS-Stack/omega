// runner-env-write tests: the box .env writer rewrites a key in place, one line
// per key, and every case runs against its own temp home, never the box's.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');
const runnerEnv = require('../../../utils/runner-env.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'runner-env writeRunnerEnvValues',
  tests: [
    {
      name: 'a write replaces every line assigning the key, a placeholder above a set line included',
      run: (ctx) => {
        // dotenv reads a key's LAST line, so a later line left behind would
        // win over the new value and the read-back would refuse the write.
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          jetpack.write(path.join(home, '.env'), '# GH_TOKEN=""\nGH_TOKEN="old"\nSIGNTOOL_PATH="s"\n');
          runnerEnv.writeRunnerEnvValues(home, { GH_TOKEN: 'new' });

          const written = jetpack.read(path.join(home, '.env'));
          ctx.expect((written.match(/^\s*#?\s*GH_TOKEN\s*=/gm) || []).length).toBe(1);
          ctx.expect(written).toContain('SIGNTOOL_PATH="s"');
          const back = {};
          runnerEnv.loadRunnerEnv({ home, env: back });
          ctx.expect(back.GH_TOKEN).toBe('new');
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a write replaces a later export or indented assignment of the key',
      run: (ctx) => {
        for (const later of ['export GH_TOKEN="b"', '  GH_TOKEN="b"']) {
          const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
          try {
            jetpack.write(path.join(home, '.env'), `GH_TOKEN="a"\n${later}\n`);
            runnerEnv.writeRunnerEnvValues(home, { GH_TOKEN: 'new' });

            const written = jetpack.read(path.join(home, '.env'));
            ctx.expect((written.match(/^\s*(?:export\s+)?GH_TOKEN\s*=/gm) || []).length).toBe(1);
            const back = {};
            runnerEnv.loadRunnerEnv({ home, env: back });
            ctx.expect(back.GH_TOKEN).toBe('new');
          } finally {
            jetpack.remove(home);
          }
        }
      },
    },
    {
      name: 'a write replaces a multi-line quoted value whole',
      run: (ctx) => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          jetpack.write(path.join(home, '.env'), 'GH_TOKEN="first\nsecond"\nSIGNTOOL_PATH="s"\n');
          runnerEnv.writeRunnerEnvValues(home, { GH_TOKEN: 'new' });

          const written = jetpack.read(path.join(home, '.env'));
          ctx.expect(written).toBe('GH_TOKEN="new"\nSIGNTOOL_PATH="s"\n');
        } finally {
          jetpack.remove(home);
        }
      },
    },
  ],
});
