/**
 * The layer registry: every framework's rows, in run order, and the default
 * row a suite with no `layer` runs on.
 */
const defineCases = require('../../src/test/define-cases.js');
const { layersFor, defaultLayer } = require('../../src/test/layers.js');

const rowNames = (framework) => layersFor(framework).map((row) => row.name);

module.exports = defineCases({
  type: 'group',
  description: 'layers registry',
  tests: [
    {
      name: 'case-34 layersFor names every framework row in run order',
      run(ctx) {
        ctx.expect(rowNames('desktop')).toEqual(['build', 'main', 'renderer', 'boot']);
        ctx.expect(rowNames('extension')).toEqual(['build', 'background', 'view', 'boot']);
        ctx.expect(rowNames('web')).toEqual(['build']);
        ctx.expect(rowNames('backend')).toEqual(['emulator']);
        ctx.expect(rowNames('node')).toEqual(['node']);
      },
    },
    {
      name: 'case-35 layersFor throws naming an unknown framework',
      run(ctx) {
        ctx.expect(() => layersFor('nope')).toThrow('nope');
      },
    },
    {
      name: 'case-36 defaultLayer is each framework first row',
      run(ctx) {
        ctx.expect(defaultLayer('desktop')).toBe('build');
        ctx.expect(defaultLayer('extension')).toBe('build');
        ctx.expect(defaultLayer('web')).toBe('build');
        ctx.expect(defaultLayer('backend')).toBe('emulator');
        ctx.expect(defaultLayer('node')).toBe('node');
      },
    },
  ],
});
