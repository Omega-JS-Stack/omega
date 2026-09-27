// migrateTarget: the extension leg of the brand root's `omega migrate`. The one
// move it carries today puts flat legacy hook files into the nested layout the
// defaults scaffold writes; report mode names the moves and writes nothing.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');

const SRC = path.join(__dirname, '..', '..', '..');
const { migrateTarget } = require(path.join(SRC, 'commands', 'lib', 'migrate.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

// A consumer on a legacy spec, carrying two of the three flat hook files
function stageFlatHooks(spec = '^1.5.0') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-migrate-'));
  jetpack.write(path.join(tmp, 'package.json'), { name: 'staged-app', devDependencies: { '@omega.js/extension': spec } });
  jetpack.write(path.join(tmp, 'hooks', 'build:pre.js'), 'module.exports = async () => "pre";\n');
  jetpack.write(path.join(tmp, 'hooks', 'middleware:request.js'), 'module.exports = async () => "request";\n');
  return tmp;
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'migrateTarget: the flat hook files move into the nested layout',
  tests: [
    {
      name: 'report mode names every move and writes nothing',
      run: (ctx) => {
        const tmp = stageFlatHooks();

        const result = migrateTarget(tmp);

        ctx.expect(result.due).toEqual([
          'move hooks/build:pre.js to hooks/build/pre.js',
          'move hooks/middleware:request.js to hooks/middleware/request.js',
        ]);
        ctx.expect(result.changed).toEqual([]);
        ctx.expect(result.errors).toEqual([]);
        ctx.expect(jetpack.exists(path.join(tmp, 'hooks', 'build:pre.js'))).toBe('file');
        ctx.expect(jetpack.exists(path.join(tmp, 'hooks', 'build', 'pre.js'))).toBe(false);
      },
    },
    {
      name: 'execute moves each file, contents intact, and a second run finds nothing',
      run: (ctx) => {
        const tmp = stageFlatHooks();

        const first = migrateTarget(tmp, { execute: true });

        ctx.expect(first.changed).toEqual([
          'moved hooks/build:pre.js to hooks/build/pre.js',
          'moved hooks/middleware:request.js to hooks/middleware/request.js',
        ]);
        ctx.expect(first.due).toEqual([]);
        ctx.expect(jetpack.exists(path.join(tmp, 'hooks', 'build:pre.js'))).toBe(false);
        ctx.expect(jetpack.read(path.join(tmp, 'hooks', 'build', 'pre.js'))).toBe('module.exports = async () => "pre";\n');

        ctx.expect(migrateTarget(tmp, { execute: true })).toEqual({ due: [], changed: [], errors: [] });
        ctx.expect(migrateTarget(tmp)).toEqual({ due: [], changed: [], errors: [] });
      },
    },
    {
      name: 'a nested file already there is named in the move that overwrites it',
      run: (ctx) => {
        const tmp = stageFlatHooks();
        jetpack.write(path.join(tmp, 'hooks', 'build', 'pre.js'), 'module.exports = async () => "nested";\n');

        ctx.expect(migrateTarget(tmp).due[0]).toBe('move hooks/build:pre.js to hooks/build/pre.js, overwriting the file already there');
      },
    },
    {
      name: 'a `file:` install and a post-2.0.0 spec have nothing to migrate',
      run: (ctx) => {
        ctx.expect(migrateTarget(stageFlatHooks('file:../../packages/extension'))).toEqual({ due: [], changed: [], errors: [] });
        ctx.expect(migrateTarget(stageFlatHooks('2.1.0'))).toEqual({ due: [], changed: [], errors: [] });
      },
    },
  ],
});
