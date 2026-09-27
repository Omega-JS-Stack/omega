// Every defaults file is copied into a consumer's repo, whose own guard may
// refuse an em dash (U+2014) at commit time. So no defaults file carries one.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { dashedFiles } = require('@omega.js/devkit/test/dashed-files');

const DEFAULTS = path.join(__dirname, '..', '..', '..', 'defaults');

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'defaults tree carries no em dash',
  tests: [
    {
      name: 'no defaults file carries an em dash',
      run: (ctx) => {
        ctx.expect(dashedFiles(DEFAULTS)).toEqual([]);
      },
    },
  ],
});
