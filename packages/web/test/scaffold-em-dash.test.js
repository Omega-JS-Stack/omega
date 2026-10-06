/**
 * Every scaffold file is copied into a consumer's repo, whose own guard may
 * refuse an em dash (U+2014) at commit time. So no scaffold file carries one.
 */
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { dashedFiles } = require('@omega.js/devkit/test/dashed-files');

const SCAFFOLD = path.resolve(__dirname, '..', 'scaffold');

module.exports = defineCases({
  type: 'group',
  description: 'scaffold-em-dash',
  tests: [
    {
      name: 'no scaffold file carries an em dash',
      run: (ctx) => {
        ctx.expect(dashedFiles(SCAFFOLD)).toEqual([]);
      },
    },
  ],
});
