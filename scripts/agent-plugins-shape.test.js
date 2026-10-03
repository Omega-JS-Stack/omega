/**
 * The shape hook (PreToolUse Write|Edit): the mirrored-suite-shape guard.
 * Run: node --test scripts/agent-plugins-shape.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { ROOT, readJson, project } = require('./agent-plugins-fixtures');

const SHAPE_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'shape', 'run.sh');

const shape = (filePath) => spawnSync(SHAPE_HOOK, {
  input: JSON.stringify({ tool_input: { file_path: filePath } }),
  encoding: 'utf8',
});

module.exports = defineCases({
  type: 'group',
  description: 'agent-plugins-shape',
  tests: [
    {
      name: 'shape: the three always-wrong test shapes bounce in an omega project',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
        for (const bad of ['__tests__/x.test.js', 'foo.spec.js', 'test/tests/x.test.js']) {
          const result = shape(path.join(dir, bad));
          ctx.expect(result.status, `${bad} did not bounce`).toBe(2);
          ctx.expect(result.stderr, `${bad} bounce lacks the hook name`).toMatch(/omega:shape/);
          ctx.expect(result.stderr, `${bad} bounce lacks the fix`).toMatch(/test\/<mirror>\/<name>\.test\.js/);
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'shape: the sanctioned shape passes untouched',
      run: (ctx) => {
        const dir = project({ name: 'a-brand', dependencies: { '@omega.js/desktop': '^1.0.0' } });
        for (const good of ['test/build/x.test.js', 'src/test/suites/main/x.test.js', 'src/lib/helper.js']) {
          ctx.expect(shape(path.join(dir, good)).status, `${good} was bounced`).toBe(0);
        }
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'shape: projects without @omega.js deps are never policed',
      run: (ctx) => {
        const dir = project({ name: 'somebody-else', dependencies: { react: '^19.0.0' } });
        ctx.expect(shape(path.join(dir, '__tests__/x.test.js')).status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'shape: hooks.json wires the guard as PreToolUse on Write|Edit',
      run: (ctx) => {
        const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
        const entry = hooks.PreToolUse.find((h) => h.matcher === 'Write|Edit');
        ctx.expect(entry, 'no PreToolUse Write|Edit entry').toBeTruthy();
        ctx.expect(entry.hooks[0].command).toMatch(/hooks\/shape\/run\.sh/);
      },
    },
  ],
});
