/**
 * tee-log.js tests — the monorepo-surface log tee: where a label's file lands,
 * that BOTH sinks get the output, and that a new run truncates the old file.
 * This is also the unit-level pin for watch-all.js's teeing, which shares the
 * helper and cannot be exercised without stopping the live watcher.
 * Run: node --test scripts/tee-log.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.join(__dirname, 'tee-log.js');
const { logFilePath } = require('./tee-log');

const GREEN = '\u001b[32m';
const RESET = '\u001b[0m';

/** Tee inside a child process (the tee patches process-wide writers). */
function runTeed(label, body) {
  const script = `
    const { teeLog } = require(${JSON.stringify(HELPER)});
    teeLog(${JSON.stringify(label)});
    ${body}
  `;
  const run = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '' },
  });
  const file = logFilePath(label);
  return { run, file, contents: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
}

module.exports = defineCases({
  type: 'group',
  description: 'tee-log',
  tests: [
    {
      name: 'tee-log: a lane label maps to a predictable filesystem-safe file',
      run: (ctx) => {
        ctx.expect(logFilePath('test:packages')).toBe(path.join(__dirname, '..', '.temp', 'logs', 'test-packages.log'));
        ctx.expect(logFilePath('watch-all')).toBe(path.join(__dirname, '..', '.temp', 'logs', 'watch-all.log'));
      },
    },

    {
      name: 'tee-log: console keeps its colors, the file gets the ANSI-stripped line',
      run: (ctx) => {
        const label = `probe-colors-${process.pid}`;
        ctx.after(() => fs.rmSync(logFilePath(label), { force: true }));

        const { run, contents } = runTeed(label, `
    console.log(${JSON.stringify(`${GREEN}hi${RESET}`)});
    console.error(${JSON.stringify(`${GREEN}broke${RESET}`)});
  `);

        ctx.expect(run.status).toBe(0);
        ctx.expect(run.stdout).toMatch(/\u001b\[32mhi\u001b\[0m/);
        ctx.expect(run.stderr).toMatch(/\u001b\[32mbroke\u001b\[0m/);
        ctx.expect(contents).toMatch(/^hi$/m);
        ctx.expect(contents).toMatch(/^broke$/m);
        ctx.expect(contents).not.toMatch(/\u001b\[/);
      },
    },

    {
      name: 'tee-log: a new run truncates the previous run\'s file',
      run: (ctx) => {
        const label = `probe-truncate-${process.pid}`;
        ctx.after(() => fs.rmSync(logFilePath(label), { force: true }));

        runTeed(label, `console.log('first run only');`);
        const { contents } = runTeed(label, `console.log('second run');`);

        ctx.expect(contents).not.toMatch(/first run only/);
        ctx.expect(contents).toMatch(/^second run$/m);
      },
    },

    {
      name: 'tee-log: CI writes no file — the runner already captures the output',
      run: (ctx) => {
        const label = `probe-ci-${process.pid}`;
        ctx.after(() => fs.rmSync(logFilePath(label), { force: true }));

        const script = `
    const { teeLog } = require(${JSON.stringify(HELPER)});
    teeLog(${JSON.stringify(label)});
    console.log('ci run');
  `;
        const run = spawnSync(process.execPath, ['-e', script], {
          encoding: 'utf8',
          env: { ...process.env, CI: 'true' },
        });

        ctx.expect(run.stdout).toMatch(/ci run/);
        ctx.expect(fs.existsSync(logFilePath(label))).toBe(false);
      },
    },
  ],
});
