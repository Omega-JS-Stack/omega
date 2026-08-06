// Build-layer test for the verb log lane (#197): `omega test` tees its whole
// run to <projectRoot>/logs/test.log, ANSI-stripped.
//
// This is the integration pin, and it needs no fixture: THIS process IS the
// `omega test` run, so a line written from here must already be in the file the
// verb opened. That also guards the regression the isolated-tee fix was for —
// a suite that clobbers the singleton mid-run would leave the marker (written
// after those suites) out of the file.

const path = require('path');
const fs   = require('fs');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'verb logs — the live run is teed to logs/test.log',
  tests: [
    {
      name: 'the running `omega test` writes this line to logs/test.log, ANSI stripped',
      run: (ctx) => {
        // The tee deliberately declines under a runner (the runner captures its
        // own output and wants no logs/ left in the workspace).
        if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
          ctx.skip('the tee is a no-op in CI by design');
          return;
        }

        const logPath = path.join(process.cwd(), 'logs', 'test.log');
        ctx.expect(fs.existsSync(logPath)).toBe(true);

        // Colored on the terminal; the file must hold the bare text.
        const marker = `verb-log marker ${process.pid}`;
        console.log(`\x1B[36m${marker}\x1B[0m`);

        const line = fs.readFileSync(logPath, 'utf8')
          .split('\n')
          .find((entry) => entry.includes(marker));
        ctx.expect(line).toBe(marker);
      },
    },
  ],
};
