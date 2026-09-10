// The syntax floor the three bundles compile to, read from the PINNED Electron
// binary ([#737](https://github.com/Omega-JS-Stack/omega/issues/737)).
//
// The interesting half is the FAILURE: a CI job with ELECTRON_SKIP_BINARY_DOWNLOAD
// has an electron package and no executable, and a build there must still build.
// So an unrunnable binary answers nulls and says why — it never invents a
// version, and it never throws the build away.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const electronTargets = require(path.join(__dirname, '..', '..', '..', 'utils', 'electron-targets.js'));

// A path that cannot be a binary, unique per case so the module-level memo of a
// previous case is never the thing under test.
function bogusBinary(name) {
  return path.join(__dirname, '..', '..', '..', '..', '.temp', `no-such-electron-${name}-${process.pid}`);
}

// A logger that also records its own `this`: the devkit Logger reads its
// `[@omega.js/<package>:<module>]` tag off `this`, so a warn called as a
// detached function prints `[undefined:undefined]`.
function collectWarnings() {
  const lines = [];
  const receivers = [];
  const logger = {
    warn(line) {
      receivers.push(this);
      lines.push(line);
    },
  };
  return { logger, lines, receivers };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'electron-targets — the syntax floor comes from the pinned Electron, or from nothing',
  timeout: 60000,
  tests: [
    {
      name: 'the installed Electron answers a real node and chrome target',
      run: (ctx) => {
        const binary = require(require.resolve('electron', { paths: [path.join(__dirname, '..', '..', '..', '..')] }));
        const targets = electronTargets(binary);

        ctx.expect(/^node\d+\.\d+\.\d+$/.test(targets.node)).toBe(true);
        ctx.expect(/^chrome\d+$/.test(targets.chrome)).toBe(true);
        ctx.expect(/^\d+\./.test(targets.electron)).toBe(true);
      },
    },

    {
      name: 'a binary that cannot be run answers nulls and warns once — the build keeps going with no floor',
      run: (ctx) => {
        const binary = bogusBinary('warns');
        const { logger, lines, receivers } = collectWarnings();

        ctx.expect(electronTargets(binary, { logger })).toEqual({ node: null, chrome: null, electron: null });
        ctx.expect(lines.length).toBe(1);
        ctx.expect(lines[0]).toContain(binary);
        ctx.expect(lines[0]).toContain('no syntax floor');
        // The warn is called ON the logger, so a real Logger keeps its tag.
        ctx.expect(receivers[0]).toBe(logger);
      },
    },

    {
      name: 'the answer is memoized per binary — one probe (and one warn) per build, not one per bundle',
      run: (ctx) => {
        const binary = bogusBinary('memo');
        const first = collectWarnings();
        const second = collectWarnings();

        const a = electronTargets(binary, { logger: first.logger });
        const b = electronTargets(binary, { logger: second.logger });

        ctx.expect(first.lines.length).toBe(1);
        // The second call never reached the probe, so it never warned either.
        ctx.expect(second.lines.length).toBe(0);
        ctx.expect(b).toBe(a);
      },
    },

    {
      name: 'a failed probe with no logger is silent, not a crash',
      run: (ctx) => {
        ctx.expect(electronTargets(bogusBinary('silent'))).toEqual({ node: null, chrome: null, electron: null });
      },
    },
  ],
});
