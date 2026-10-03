/**
 * lane.js tests: the closing wall-time line, sequential execution, every
 * command running whatever the others' results, the per-command summary, the
 * first failure's exit code preserved, and the lane's tee to .temp/logs/<lane>.log.
 * Run: node --test scripts/lane.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { logFilePath } = require('./tee-log');

const LANE = path.join(__dirname, 'lane.js');

function runLane(args) {
  return spawnSync(process.execPath, [LANE, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '' },
  });
}

// A duration as the lane prints it: `0s`, `1.2s`, `350ms` or `1m 2s`.
const TIME = String.raw`(?:\d+m )?\d+(?:\.\d+)?m?s`;
const PASS = 'node -e "console.log(\'ok\')"';
const EXIT3 = 'node -e "process.exit(3)"';
const EXIT5 = 'node -e "process.exit(5)"';

function esc(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function passRow(command) {
  return new RegExp(`^  ✓ ${esc(command)} \\(${TIME}\\)$`);
}

function failRow(command, code) {
  return new RegExp(`^  ✗ ${esc(command)} \\(${TIME}, exit ${code}\\)$`);
}

// The summary block's rows: the non-blank lines between `lane <label> summary:` and the closing line.
// `expect` is the calling case's.
function summaryRows(expect, output, label) {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== '');
  const start = lines.indexOf(`lane ${label} summary:`);
  expect(start, `no "lane ${label} summary:" line in:\n${output}`).not.toBe(-1);
  const end = lines.findIndex((line, i) => i > start && new RegExp(`^[✓✗] lane ${esc(label)} `).test(line));
  expect(end, 'the closing line follows the summary').not.toBe(-1);
  return { rows: lines.slice(start + 1, end), closing: lines[end] };
}

module.exports = defineCases({
  type: 'group',
  description: 'lane',
  tests: [
    {
      name: 'lane: runs every command in order and closes with the lane wall time',
      run: (ctx) => {
        const run = runLane(['probe', 'node -e "console.log(\'first\')"', 'node -e "console.log(\'second\')"']);

        ctx.expect(run.status).toBe(0);
        ctx.expect(run.stdout.indexOf('first') < run.stdout.indexOf('second')).toBeTruthy();
        ctx.expect(run.stdout).toMatch(/✓ lane probe done in \d+s/);
      },
    },

    {
      name: 'lane: a failed command does not stop the lane, which exits with its code',
      run: (ctx) => {
        const run = runLane(['probe', PASS, EXIT3, 'node -e "console.log(\'third ran\')"']);

        ctx.expect(run.status).toBe(3);
        ctx.expect(run.stdout).toMatch(/^third ran$/m);
      },
    },

    {
      name: 'lane: two failures exit with the first one\'s code and count both',
      run: (ctx) => {
        const run = runLane(['probe', EXIT3, PASS, EXIT5]);

        ctx.expect(run.status).toBe(3);
        ctx.expect(run.stdout).toMatch(new RegExp(`^✗ lane probe failed in ${TIME} \\(2 of 3 failed, exit 3\\)$`, 'm'));
      },
    },

    {
      name: 'lane: more than one command prints a summary, every command in order, before the closing line',
      run: (ctx) => {
        const last = 'node -e "console.log(\'last\')"';
        const run = runLane(['probe', PASS, EXIT3, last]);
        const { rows, closing } = summaryRows(ctx.expect, run.stdout, 'probe');

        ctx.expect(rows.length, `rows:\n${rows.join('\n')}`).toBe(3);
        ctx.expect(rows[0]).toMatch(passRow(PASS));
        ctx.expect(rows[1]).toMatch(failRow(EXIT3, 3));
        ctx.expect(rows[2]).toMatch(passRow(last));
        ctx.expect(closing).toMatch(new RegExp(`^✗ lane probe failed in ${TIME} \\(1 of 3 failed, exit 3\\)$`));
      },
    },

    {
      name: 'lane: every command passing prints the summary, closes with done and exits 0',
      run: (ctx) => {
        const second = 'node -e "console.log(\'two\')"';
        const run = runLane(['probe', PASS, second]);
        const { rows, closing } = summaryRows(ctx.expect, run.stdout, 'probe');

        ctx.expect(run.status).toBe(0);
        ctx.expect(rows.length, `rows:\n${rows.join('\n')}`).toBe(2);
        ctx.expect(rows[0]).toMatch(passRow(PASS));
        ctx.expect(rows[1]).toMatch(passRow(second));
        ctx.expect(closing).toMatch(new RegExp(`^✓ lane probe done in ${TIME}$`));
      },
    },

    {
      name: 'lane: one command prints no summary, only the closing line',
      run: (ctx) => {
        const passed = runLane(['probe', PASS]);
        const failed = runLane(['probe', EXIT3]);

        ctx.expect(passed.status).toBe(0);
        ctx.expect(passed.stdout).not.toMatch(/summary:/);
        ctx.expect(passed.stdout).toMatch(new RegExp(`^✓ lane probe done in ${TIME}$`, 'm'));
        ctx.expect(failed.status).toBe(3);
        ctx.expect(failed.stdout).not.toMatch(/summary:/);
        ctx.expect(failed.stdout).toMatch(new RegExp(`^✗ lane probe failed in ${TIME} \\(1 of 1 failed, exit 3\\)$`, 'm'));
      },
    },

    {
      name: 'lane: a failed run\'s log file holds the summary and the closing line',
      run: (ctx) => {
        const label = `probe-summary-${process.pid}`;
        ctx.after(() => fs.rmSync(logFilePath(label), { force: true }));

        const run = runLane([label, EXIT3, PASS]);
        const contents = fs.readFileSync(logFilePath(label), 'utf8');
        const { rows, closing } = summaryRows(ctx.expect, contents, label);

        ctx.expect(run.status).toBe(3);
        ctx.expect(rows.length, `rows:\n${rows.join('\n')}`).toBe(2);
        ctx.expect(rows[0]).toMatch(failRow(EXIT3, 3));
        ctx.expect(rows[1]).toMatch(passRow(PASS));
        ctx.expect(closing).toMatch(new RegExp(`^✗ lane ${esc(label)} failed in ${TIME} \\(1 of 2 failed, exit 3\\)$`));
      },
    },

    {
      name: 'lane: a label with no commands is a usage error',
      run: (ctx) => {
        const run = runLane(['probe']);

        ctx.expect(run.status).toBe(1);
        ctx.expect(run.stderr).toMatch(/Usage: node scripts\/lane\.js/);
      },
    },

    {
      name: 'lane: the whole lane tees to .temp/logs/<lane>.log — child output included, ANSI stripped',
      run: (ctx) => {
        const label = `probe:tee-${process.pid}`;
        ctx.after(() => fs.rmSync(logFilePath(label), { force: true }));

        const run = runLane([
          label,
          'node -e "console.log(\'\\u001b[32mgreen child\\u001b[0m\')"',
          'node -e "console.error(\'child stderr\')"',
        ]);
        const contents = fs.readFileSync(logFilePath(label), 'utf8');

        ctx.expect(run.status).toBe(0);
        ctx.expect(run.stdout).toMatch(/\u001b\[32mgreen child\u001b\[0m/);
        ctx.expect(contents).toMatch(/^green child$/m);
        ctx.expect(contents).toMatch(/^child stderr$/m);
        ctx.expect(contents).toMatch(/✓ lane probe:tee/);
        ctx.expect(contents).not.toMatch(/\u001b\[/);
      },
    },

    {
      name: 'lane: a failing lane leaves the failure in the log file',
      run: (ctx) => {
        const label = `probe-fail-${process.pid}`;
        ctx.after(() => fs.rmSync(logFilePath(label), { force: true }));

        const run = runLane([label, 'node -e "console.error(\'the reason\'); process.exit(3)"']);
        const contents = fs.readFileSync(logFilePath(label), 'utf8');

        ctx.expect(run.status).toBe(3);
        ctx.expect(contents).toMatch(/^the reason$/m);
        ctx.expect(contents).toMatch(/✗ lane probe-fail/);
      },
    },

    // #211 — a lane is the LOADED context: its children run against every other
    // package's suite, so the watch-deadline knob the web suites read is exported
    // here. A solo `node --test <file>` never goes through a lane and keeps the
    // tight base deadline.
    {
      name: 'lane: every child runs with the watch-deadline scale exported',
      run: (ctx) => {
        const run = runLane(['probe', 'node -e "console.log(process.env.OMEGA_TEST_DEADLINE_SCALE)"']);

        ctx.expect(run.status).toBe(0);
        ctx.expect(run.stdout, 'the lane default: 30s solo → 90s under load').toMatch(/^3$/m);
      },
    },

    {
      name: 'lane: an explicitly set scale is passed through untouched',
      run: (ctx) => {
        const run = spawnSync(process.execPath, [LANE, 'probe', 'node -e "console.log(process.env.OMEGA_TEST_DEADLINE_SCALE)"'], {
          encoding: 'utf8',
          env: { ...process.env, CI: '', GITHUB_ACTIONS: '', OMEGA_TEST_DEADLINE_SCALE: '5' },
        });

        ctx.expect(run.status).toBe(0);
        ctx.expect(run.stdout, 'the caller (or an outer lane) owns the value once it is set').toMatch(/^5$/m);
      },
    },

    {
      name: 'lane: a new run truncates the previous run\'s log file',
      run: (ctx) => {
        const label = `probe-truncate-${process.pid}`;
        ctx.after(() => fs.rmSync(logFilePath(label), { force: true }));

        runLane([label, 'node -e "console.log(\'first run only\')"']);
        runLane([label, 'node -e "console.log(\'second run\')"']);
        const contents = fs.readFileSync(logFilePath(label), 'utf8');

        ctx.expect(contents).not.toMatch(/first run only/);
        ctx.expect(contents).toMatch(/^second run$/m);
      },
    },
  ],
});
