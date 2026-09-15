// The notarization tools' command runner
// ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
//
// notarytool, stapler and spctl write their verdict to the console and exit
// non-zero when they refuse, so the runner must hand back what they SAID no
// matter how they exited. Run 34735658588's DMG assessment failed with only
// `Command failed with exit code 3`: the verdict itself was lost.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { report, toolRunner } = require(path.join(__dirname, '..', '..', '..', 'hooks', 'lib', 'notarize-tools.js'));

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'notarize-tools: the runner reports a refusing tool\'s own words (#891)',
  tests: [
    {
      name: 'a command that exits non-zero still reports its stdout and stderr',
      run: async (ctx) => {
        const output = await report(toolRunner(), 'echo "App.dmg: rejected"; echo "source=Insufficient Context" 1>&2; exit 3');

        ctx.expect(output).toContain('App.dmg: rejected');
        ctx.expect(output).toContain('source=Insufficient Context');
      },
    },
    {
      name: 'a command that exits zero reports its output the same way',
      run: async (ctx) => {
        const output = await report(toolRunner(), 'echo "App.dmg: accepted"; echo "source=Notarized Developer ID" 1>&2');

        ctx.expect(output).toContain('App.dmg: accepted');
        ctx.expect(output).toContain('source=Notarized Developer ID');
      },
    },
  ],
});
