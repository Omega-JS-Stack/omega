/**
 * The layer registry: every framework's rows, in run order, and the default
 * row a suite with no `layer` runs on.
 */
const defineCases = require('../../src/test/define-cases.js');
const { LAYERS, layersFor, defaultLayer, needsDriver } = require('../../src/test/layers.js');

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
    {
      name: 'no framework defaults to the boot row, so a view on a suite with no layer is refused at normalize time',
      run(ctx) {
        for (const framework of Object.keys(LAYERS)) {
          ctx.expect(defaultLayer(framework), framework).not.toBe('boot');
        }
      },
    },
    {
      name: 'case-155 the extension boot row is an app row with the extension and page extras, and needs a driver',
      run(ctx) {
        const boot = LAYERS.extension.find((row) => row.name === 'boot');
        ctx.expect(boot).toHaveProperty('kind', 'app');
        ctx.expect(boot.extras).toEqual(['extension', 'page']);
        ctx.expect(needsDriver(boot)).toBe(true);
      },
    },
  ],
});
